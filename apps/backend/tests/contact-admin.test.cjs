const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function source(relative, dependencies, globals = {}) {
  const filename = path.join(__dirname, "../src", relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name === "react/jsx-runtime") return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return exports
}
const defaults = source("modules/content/contact-settings.ts", {}).DEFAULT_CONTACT_SETTINGS
const plain = (value) => JSON.parse(JSON.stringify(value))
const response = (body, status = 200) => ({ ok: status < 400, json: async () => body })
const settle = () => new Promise((resolve) => setImmediate(resolve))

// Run the actual route handlers with a minimal hook host. Network requests are
// intercepted; no admin credentials, browser session or external service is used.
function harness(fetchHandler) {
  const slots = [], pending = [], requests = [], messages = [], events = new Map()
  let cursor = 0, tree
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }
      return [slots[index].value, (next) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      slots[index] = { deps, cleanup: previous?.cleanup }
      pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect() })
    },
  }
  const route = source("admin/routes/contact/page.tsx", {
    react: hooks, "@medusajs/admin-sdk": { defineRouteConfig: (config) => config },
    "@medusajs/icons": { Envelope: "svg" },
    "@medusajs/ui": { Badge: "span", Button: "button", Container: "section", Heading: "h2", Input: "input", Label: "label", Text: "p", Textarea: "textarea", toast: { success: (value) => messages.push(value) } },
  }, {
    AbortController, AbortSignal: { timeout: (ms) => ({ timeout: ms }) },
    requestAnimationFrame: (callback) => callback(),
    window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name) },
    fetch: async (url, init) => { requests.push({ url, init }); return fetchHandler(url, init) },
  })
  function nodes(value) {
    if (arguments.length === 0) value = tree
    if (Array.isArray(value)) return value.flatMap((node) => nodes(node))
    if (!value || typeof value !== "object") return []
    if (typeof value.type === "function") return nodes(value.type(value.props))
    return [value, ...nodes(value.props?.children)]
  }
  const api = {
    requests, messages, events,
    render() { cursor = 0; tree = route.default(); for (const effect of pending.splice(0)) effect(); return tree },
    field(name) { return nodes().find((node) => node.props?.["data-contact-field"] === name) },
    button(label) { return nodes().find((node) => node.type === "button" && (node.props["aria-label"] === label || node.props.children === label)) },
    change(name, value) { api.field(name).props.onChange({ target: { value } }); api.render() },
    submit() { return tree.props.onSubmit({ preventDefault() {} }) },
    nodes,
    cleanup() { slots.forEach((slot) => slot.cleanup?.()) },
  }
  api.render()
  return api
}

test("Contact admin saves once at a time and preserves the draft after a rejected save", async (t) => {
  let finish
  const h = harness((_url, init) => init.method === "POST" ? new Promise((resolve) => { finish = resolve }) : response({ settings: defaults }))
  t.after(h.cleanup)
  await settle(); h.render()
  assert.equal(h.button("Save Contact page").props.disabled, true)
  h.change("title", "New contact title")
  assert.equal(h.events.has("beforeunload"), true)
  const saving = h.submit()
  await h.submit()
  assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1)
  h.render()
  assert.equal(h.button("Save Contact page").props.disabled, true)
  assert.equal(h.nodes().find((node) => node.type === "fieldset").props.disabled, true)
  finish(response({ errors: { title: "That title was rejected by the server." } }, 400))
  await saving; h.render()
  assert.equal(h.field("title").props.value, "New contact title")
  assert.equal(h.field("title").props["aria-invalid"], true)
  assert.equal(h.messages.length, 0)
  const retry = h.submit()
  const posted = h.requests.at(-1)
  assert.equal(posted.url, "/admin/contact-settings")
  assert.equal(posted.init.credentials, "include")
  assert.equal(posted.init.signal.timeout, 20000)
  assert.equal(JSON.parse(posted.init.body).title, "New contact title")
  finish(response({ settings: { ...defaults, title: "New contact title" } }))
  await retry; h.render()
  assert.equal(h.button("Save Contact page").props.disabled, true)
  assert.equal(h.events.has("beforeunload"), false)
  assert.deepEqual(h.messages, ["Contact page saved"])
  const preview = h.nodes().find((node) => node.type === "a")
  assert.equal(preview.props.href, "https://new.florayn.com/contact/")
  assert.equal(preview.props.rel, "noopener noreferrer")
})

test("FAQ edits and reordering preserve stable IDs and incomplete new FAQs never reach the server", async (t) => {
  const h = harness(() => response({ settings: defaults }))
  t.after(h.cleanup)
  await settle(); h.render()
  h.change("faqs.1.question", "Updated exchange question")
  h.button("Move question 2 up").props.onClick(); h.render()
  assert.equal(h.field("faqs.0.question").props.value, "Updated exchange question")
  assert.equal(h.field("faqs.0.question").props.id, "contact-exchanges-question")
  assert.equal(h.field("faqs.1.question").props.id, "contact-delivery-question")
  h.button("Add question").props.onClick(); h.render()
  const added = h.field("faqs.4.question")
  assert.match(added.props.id, /^contact-faq_[a-z0-9_-]+-question$/)
  await h.submit(); h.render()
  assert.equal(h.field("faqs.4.question").props["aria-invalid"], true)
  assert.equal(h.field("faqs.4.answer").props["aria-invalid"], true)
  assert.equal(h.requests.length, 1, "Draft-only actions and invalid FAQ do not write to the API")
  h.button("Remove question 5").props.onClick(); h.render()
  assert.equal(h.field("faqs.4.question"), undefined)
  assert.equal(h.field("faqs.0.question").props.value, "Updated exchange question")
  assert.equal(h.field("faqs.0.question").props.id, "contact-exchanges-question")
})

test("Contact admin recovers load failures and retains edits after malformed server errors", async (t) => {
  let loads = 0
  const h = harness((_url, init) => init.method === "POST" ? response({ errors: ["bad shape"] }, 500)
    : ++loads === 1 ? response({}, 503) : response({ settings: { ...plain(defaults), internal: "must not be sent" } }))
  t.after(h.cleanup)
  await settle(); h.render()
  assert.ok(h.button("Try again"))
  h.button("Try again").props.onClick(); h.render()
  await settle(); h.render()
  h.change("email", "invalid@")
  await h.submit(); h.render()
  assert.equal(h.field("email").props["aria-invalid"], true)
  assert.equal(h.requests.length, 2)
  h.change("email", "hello@example.invalid")
  await h.submit(); h.render()
  assert.equal(h.field("email").props.value, "hello@example.invalid")
  assert.ok(h.nodes().some((node) => node.props?.children === "Could not save contact settings. Your edits are still here; please try again."))
  assert.equal(h.messages.length, 0)
  assert.equal(JSON.parse(h.requests.at(-1).init.body).internal, undefined)
})
