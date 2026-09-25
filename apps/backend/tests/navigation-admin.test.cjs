// Admin > Navigation and Admin > Search: the pure checks the screens run before saving.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = process.env.BACKEND_SRC || path.join(__dirname, "../src")
function load(relative, deps = {}) {
  const filename = path.join(SRC, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, URL, require(name) {
    if (Object.hasOwn(deps, name)) return deps[name]
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return exports
}
const presentation = load("lib/storefront-presentation.ts")
const input = load("admin/components/navigation/section-input.ts", { "../../../lib/storefront-presentation": presentation })
const { sectionPayload, configPayload, readConfig, safeMenuHref, fitsEveryFamily, formsOf, guessFamilies, MESSAGES } = input
const drafts = load("admin/components/navigation/drafts.ts", { "./section-input": input })
const plain = (value) => JSON.parse(JSON.stringify(value))

const caseTypes = [
  { id: "1", slug: "alcantara", name: "Alcantara", is_active: true, image_url: null, devices: [{ family: "iphone" }] },
  { id: "2", slug: "signature", name: "Signature", is_active: true, image_url: null, devices: [{ family: "iphone" }, { family: "samsung" }, { family: "airpods" }] },
  { id: "3", slug: "armor-clear", name: "Armor Clear", is_active: true, image_url: null, devices: [{ family: "samsung" }] },
]
const base = { label: "Phone Case", href: "/shop/", image_url: null, badge: "", kind: "links", placement: "all", config: null }

test("the four types and three placements are accepted", () => {
  for (const placement of ["all", "drawer", "bar"]) assert.equal(sectionPayload({ ...base, placement }, caseTypes).placement, placement)
  assert.equal(sectionPayload(base, caseTypes).config, null)
  assert.deepEqual(plain(sectionPayload({ ...base, kind: "devices", config: { families: ["iphone", "samsung"], case_type: null } }, caseTypes).config), { families: ["iphone", "samsung"], case_type: null })
  assert.deepEqual(plain(sectionPayload({ ...base, kind: "case_types", config: { form: "phone", exclude: ["signature"], links: { alcantara: "/collection/alcantara/" } } }, caseTypes).config), { form: "phone", exclude: ["signature"], links: { alcantara: "/collection/alcantara/" } })
  assert.deepEqual(plain(sectionPayload({ ...base, kind: "collections", config: {} }, caseTypes).config), { title: "Collections", view_all_href: "/collections/", limit: 8 })
})

test("each mistake gives the server's message", () => {
  const fails = (patch, message) => assert.throws(() => sectionPayload({ ...base, ...patch }, caseTypes), { message })
  fails({ kind: "mega" }, MESSAGES.kind)
  fails({ badge: "x".repeat(13) }, "Badge must be 12 characters or fewer.")
  fails({ image_url: "http://example.com/a.webp" }, "Use an https image link (pick one from the media library).")
  fails({ kind: "devices", config: { families: [], case_type: null } }, "Pick at least one brand.")
  fails({ kind: "devices", config: { families: ["nokia"], case_type: null } }, "Pick at least one brand.")
  fails({ kind: "devices", config: { families: ["iphone"], case_type: "leather" } }, "That case type does not exist.")
  fails({ kind: "case_types", config: { form: "phone", exclude: [], links: { alcantara: "javascript:alert(1)" } } }, "Use a site path like /collection/leopard/ or a full https link.")
  fails({ kind: "collections", config: { limit: 0 } }, "Show between 1 and 12 collections.")
  fails({ kind: "collections", config: { limit: 13 } }, "Show between 1 and 12 collections.")
  fails({ kind: "collections", config: { limit: Number.NaN } }, "Show between 1 and 12 collections.")
  fails({ kind: "collections", config: { view_all_href: "//evil.test" } }, MESSAGES.href)
  fails({ label: "  " }, MESSAGES.label)
})

test("badge and image are tidied; blank clears", () => {
  const body = sectionPayload({ ...base, badge: "  New ", image_url: " https://pub.r2.dev/a.webp " }, caseTypes)
  assert.equal(body.badge, "New")
  assert.equal(body.image_url, "https://pub.r2.dev/a.webp")
  assert.equal(sectionPayload({ ...base, image_url: "  " }, caseTypes).image_url, null)
  assert.equal(sectionPayload({ ...base, badge: null }, caseTypes).badge, "")
})

test("case styles keep only the chosen product's case types and drop blank links", () => {
  const config = configPayload("case_types", { form: "airpods", exclude: ["alcantara", "signature"], links: { alcantara: "/x/", signature: " ", "armor-clear": "/y/" } }, caseTypes)
  assert.deepEqual(plain(config), { form: "airpods", exclude: ["signature"], links: {} })
  // Without the catalogue the slugs pass through; the server checks them.
  assert.deepEqual(plain(configPayload("case_types", { form: "phone", exclude: ["gone"], links: { gone: "/g/" } }, null)), { form: "phone", exclude: ["gone"], links: { gone: "/g/" } })
})

test("case styles keep the hidden state and links of case types that are switched off or have no models yet", () => {
  const armorBlack = { id: "4", slug: "armor-black", name: "Armor Black", is_active: false, image_url: null, devices: [{ family: "iphone" }] }
  const fresh = { id: "5", slug: "leather", name: "Leather", is_active: true, image_url: null, devices: [] }
  const watch = { id: "6", slug: "watch-band", name: "Watch Band", is_active: false, image_url: null, devices: [{ family: "watch" }] }
  const active = [...caseTypes, fresh]
  const all = [...active, armorBlack, watch]
  const saved = {
    form: "phone",
    exclude: ["armor-black", "leather", "watch-band"],
    links: { "armor-black": "/collection/armor/", alcantara: "/collection/alcantara/", leather: "/l/", "watch-band": "/w/" },
  }
  const expected = { form: "phone", exclude: ["armor-black", "leather"], links: { "armor-black": "/collection/armor/", alcantara: "/collection/alcantara/", leather: "/l/" } }
  assert.deepEqual(plain(configPayload("case_types", saved, active, all)), expected, "only the watch band's settings belong to another product")
  assert.deepEqual(plain(sectionPayload({ ...base, kind: "case_types", config: saved }, active, all).config), expected)
  // Given only the active list, a switched-off case type is unknown, so it is kept too.
  assert.deepEqual(plain(configPayload("case_types", saved, active).exclude), ["armor-black", "leather", "watch-band"])
  // Switching the product still clears what belongs to the old one.
  assert.deepEqual(plain(configPayload("case_types", { ...saved, form: "watch" }, active, all)), { form: "watch", exclude: ["leather", "watch-band"], links: { leather: "/l/", "watch-band": "/w/" } })
})

test("unsaved: compared by value, not by the key order Postgres returns", () => {
  const { sameSectionDraft, sectionDraftKey, stableJson } = drafts
  assert.equal(stableJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), stableJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }))
  assert.notEqual(stableJson({ a: [1, 2] }), stableJson({ a: [2, 1] }), "list order still counts")
  const saved = { label: "Styles", href: null, image_url: null, badge: null, kind: "case_types", placement: "all", config: { form: "phone", links: { alcantara: "/collection/alcantara/" }, exclude: ["signature", "armor-clear"] } }
  const same = (patch) => sameSectionDraft(saved, { ...saved, ...patch })
  assert.ok(same({ config: { form: "phone", exclude: ["armor-clear", "signature"], links: { alcantara: "/collection/alcantara/" } } }), "rebuilt by the settings editor")
  assert.ok(same({ config: { form: "phone", exclude: ["signature", "armor-clear"], links: { alcantara: "/collection/alcantara/", signature: "" } } }), "a style link typed and cleared")
  assert.ok(same({ label: "Styles ", href: "", badge: "" }), "the save trims and blanks these")
  assert.ok(!same({ config: { form: "phone", exclude: ["signature"], links: { alcantara: "/collection/alcantara/" } } }))
  assert.ok(!same({ badge: "New" }))
  assert.ok(!same({ placement: "drawer" }))
  const collections = { ...saved, kind: "collections", config: { limit: 8, title: "Collections", view_all_href: "/collections/" } }
  assert.ok(sameSectionDraft(collections, { ...collections, config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }))
  assert.ok(!sameSectionDraft(collections, { ...collections, config: { title: "Collections", view_all_href: "/collections/", limit: Number.NaN } }), "a field the save rejects is a change")
  const devices = { ...saved, kind: "devices", config: { families: ["iphone", "samsung"], case_type: "signature" } }
  assert.ok(!sameSectionDraft(devices, { ...devices, config: { families: [], case_type: "signature" } }))
  assert.ok(!sameSectionDraft(devices, { ...devices, config: { families: ["samsung", "iphone"], case_type: "signature" } }), "brand order is shown order")
  assert.equal(typeof sectionDraftKey(saved), "string")
})

test("unsaved links and drafts edited while their save ran", () => {
  const { sameLink, linkBody, linkFields, settleDraft } = drafts
  const item = { id: "l1", section_id: "s1", group: null, label: "iPhone 17", href: "/shop/iphone-17/signature/", badge: null, position: 0, is_visible: true }
  assert.deepEqual(plain(linkFields(item)), { group: null, label: "iPhone 17", href: "/shop/iphone-17/signature/", badge: null })
  assert.deepEqual(plain(linkBody(linkFields(item))), { label: "iPhone 17", href: "/shop/iphone-17/signature/", group: "", badge: "" })
  assert.ok(sameLink(linkFields(item), { ...linkFields(item), group: "", badge: " ", label: "iPhone 17 " }))
  assert.ok(!sameLink(linkFields(item), { ...linkFields(item), badge: "New" }))

  const same = (a, b) => a.v === b.v
  const sent = { v: 1 }
  assert.deepEqual(plain(settleDraft({ a: sent, b: { v: 9 } }, "a", sent, same)), { b: { v: 9 } }, "saved as it was: the draft goes")
  assert.deepEqual(plain(settleDraft({ a: { v: 1 } }, "a", sent, same)), {}, "typed and typed back")
  const later = { a: { v: 2 } }
  assert.equal(settleDraft(later, "a", sent, same), later, "typed while saving: kept")
  const none = {}
  assert.equal(settleDraft(none, "a", sent, same), none)
})

/*
 * The real MenuEditor, run on a minimal hook harness (no DOM): state, effects
 * and the element tree it returns, whose handlers the tests call like a user.
 * The fake server stores configs the way Postgres jsonb does (keys by length).
 */
function jsonb(value) {
  if (Array.isArray(value)) return value.map(jsonb)
  if (!value || typeof value !== "object") return value
  const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(keys.map((k) => [k, jsonb(value[k])]))
}

function fakeServer(sections, items) {
  const server = { sections: plain(sections), items: plain(items), requests: [], held: [], hold: false }
  const body = () => plain({ menuSections: server.sections.map((s) => ({ ...s, config: jsonb(s.config) })), items: server.items })
  server.fetch = (url, init = {}) => {
    const request = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined }
    server.requests.push(request)
    const respond = () => {
      const [, kind, id] = url.match(/^\/admin\/content\/(menu-sections|menu-items)\/([^/]+)$/) ?? []
      const row = kind === "menu-sections" ? server.sections.find((s) => s.id === id) : kind === "menu-items" ? server.items.find((i) => i.id === id) : null
      if (row && request.method === "POST") {
        const b = request.body
        if (kind === "menu-items") {
          if (typeof b.label === "string" && b.label.trim()) row.label = b.label.trim()
          if (typeof b.href === "string" && b.href.trim()) row.href = b.href.trim()
          for (const key of ["group", "badge"]) if (typeof b[key] === "string") row[key] = b[key].trim() || null
          if (typeof b.is_visible === "boolean") row.is_visible = b.is_visible
        } else {
          for (const [key, value] of Object.entries(b)) row[key] = key === "badge" || key === "href" ? (value || null) : value
        }
      }
      return { ok: true, status: 200, json: async () => body() }
    }
    return new Promise((resolve) => (server.hold ? server.held.push(() => resolve(respond())) : resolve(respond())))
  }
  server.release = () => { const held = server.held; server.held = []; server.hold = false; held.forEach((go) => go()) }
  return server
}

function mountMenuEditor({ server, catalog = null, typed = true, menu = "primary" }) {
  const hooks = []
  let index = 0
  let effects = []
  let stale = false
  const h = { tree: null, dirty: [], unsaved: false, toasts: [] }
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in hooks)) hooks[i] = { value: typeof initial === "function" ? initial() : initial }
      const slot = hooks[i]
      return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; stale = true }]
    },
    useEffect(fn, deps) {
      const i = index++
      const prev = hooks[i]
      if (!prev || !deps || deps.length !== prev.length || deps.some((d, k) => !Object.is(d, prev[k]))) {
        hooks[i] = deps
        effects.push(fn)
      }
    },
    useId() { index++; return "uid" },
  }
  const element = (type, props, key) => ({ type, props: props ?? {}, key })
  const names = ["Badge", "Button", "Container", "Heading", "Input", "Label", "Switch", "Text"]
  const deps = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "@medusajs/ui": { ...Object.fromEntries(names.map((n) => [n, n])), toast: { success: (m) => h.toasts.push(["success", m]), error: (m) => h.toasts.push(["error", m]) } },
    "./content-editors": { ImageField: "ImageField" },
    "./navigation/drafts": drafts,
    "./navigation/section-input": input,
    "./navigation/section-settings": {
      CaseStylesSettings: "CaseStylesSettings", CollectionsRowSettings: "CollectionsRowSettings", DeviceModelsSettings: "DeviceModelsSettings",
      useNavigationCatalog: () => ({ catalog, error: "" }),
    },
    "./product-manager/shared": { ManagerSelect: "ManagerSelect", useUnsaved: (dirty) => { h.unsaved = dirty } },
  }
  const filename = path.join(SRC, "admin/components/menu-editor.tsx")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, fetch: server.fetch, confirm: () => true,
    require(name) { if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(`Unexpected dependency ${name}`) },
  }, { filename })
  const MenuEditor = exports.default
  const props = { menu, title: "Navigation", description: "", useGroups: true, typed, onDirtyChange: (dirty) => h.dirty.push(dirty) }

  h.render = () => {
    for (let pass = 0; pass < 20; pass++) {
      index = 0
      effects = []
      stale = false
      h.tree = MenuEditor(props)
      for (const fn of effects) fn()
      if (!stale) return h.tree
    }
    throw new Error("render loop")
  }
  function* walk(node) {
    if (Array.isArray(node)) { for (const n of node) yield* walk(n); return }
    if (!node || typeof node !== "object") return
    yield node
    yield* walk(node.props.children)
  }
  const textOf = (node) => [...walk(node)].flatMap((n) => [].concat(n.props.children ?? []).filter((c) => typeof c === "string" || typeof c === "number")).join("")
  h.all = (predicate) => [...walk(h.tree)].filter(predicate)
  h.one = (predicate, what) => {
    const found = h.all(predicate)
    assert.equal(found.length, 1, `exactly one ${what}`)
    return found[0]
  }
  h.button = (text) => h.one((n) => n.type === "Button" && textOf(n).trim() === text, `"${text}" button`)
  h.input = (id) => h.one((n) => n.type === "Input" && (n.props.id === id || n.props["aria-label"] === id), `input ${id}`)
  h.type = (id, value) => { h.input(id).props.onChange({ target: { value } }); h.render() }
  h.unsavedBadge = () => h.all((n) => n.type === "Badge" && textOf(n) === "Unsaved").length > 0
  /** The Edit (or Close) button of the section card with this id. */
  h.cardToggle = (id) => {
    const card = h.one((n) => n.type === "Container" && n.key === id, `card ${id}`)
    return [...walk(card)].find((n) => n.type === "Button" && "aria-expanded" in n.props)
  }
  h.settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); h.render() }
  h.render()
  return h
}

const menuSection = (patch) => ({ id: "sec", menu: "primary", label: "Phone Case", href: "/shop/", position: 0, is_visible: true, kind: "links", image_url: null, badge: null, placement: "all", config: null, ...patch })

test("editor: a section edit typed while its save runs is kept as unsaved", async () => {
  const server = fakeServer([menuSection({})], [])
  const h = mountMenuEditor({ server })
  await h.settle()
  h.button("Edit").props.onClick()
  h.render()
  h.type("uid-sec-badge", "New")
  assert.ok(h.unsavedBadge())

  server.hold = true
  const saving = h.button("Save changes").props.onClick()
  h.render()
  h.type("uid-sec-badge", "Hot")
  server.release()
  await saving
  await h.settle()

  assert.equal(server.requests.at(-1).body.badge, "New", "what was sent")
  assert.equal(server.sections[0].badge, "New")
  assert.equal(h.input("uid-sec-badge").props.value, "Hot", "the later edit is still there")
  assert.ok(h.unsavedBadge(), "and still unsaved")
  assert.equal(h.dirty.at(-1), true)
  assert.equal(h.unsaved, true)

  await h.button("Save changes").props.onClick()
  await h.settle()
  assert.equal(server.sections[0].badge, "Hot")
  assert.ok(!h.unsavedBadge())
  assert.equal(h.dirty.at(-1), false)
})

test("editor: link edits are tracked, survive other saves, and the card's Save changes saves them", async () => {
  const links = [
    { id: "l1", section_id: "sec", group: "iPhone", label: "iPhone 17", href: "/shop/iphone-17/signature/", badge: null, position: 0, is_visible: true },
    { id: "l2", section_id: "sec", group: "iPhone", label: "iPhone 16", href: "/shop/iphone-16/signature/", badge: null, position: 1, is_visible: true },
  ]
  const server = fakeServer([menuSection({})], links)
  const h = mountMenuEditor({ server })
  await h.settle()
  h.button("Edit").props.onClick()
  h.render()
  const label = () => h.all((n) => n.type === "Input" && n.props["aria-label"] === "Link label")[0]
  label().props.onChange({ target: { value: "iPhone 17 Pro" } })
  h.render()
  assert.ok(h.unsavedBadge(), "a link edit marks the card")
  assert.equal(h.dirty.at(-1), true, "and the page (Women/Men switch, leaving)")
  assert.equal(h.unsaved, true)

  // Another write reloads the rows: the link edit stays.
  await h.one((n) => n.type === "Switch" && n.props.id === "uid-sec-shown", "Shown switch").props.onCheckedChange(false)
  await h.settle()
  assert.equal(label().props.value, "iPhone 17 Pro")
  assert.ok(h.unsavedBadge())

  // The section's own save leaves nothing behind either: it saves both.
  h.type("uid-sec-badge", "New")
  await h.button("Save changes").props.onClick()
  await h.settle()
  assert.equal(server.sections[0].badge, "New")
  assert.equal(server.items[0].label, "iPhone 17 Pro")
  assert.equal(server.items[1].label, "iPhone 16", "an untouched link is not sent")
  assert.deepEqual(server.requests.filter((r) => r.url.startsWith("/admin/content/menu-items/")).map((r) => r.url), ["/admin/content/menu-items/l1"])
  assert.equal(label().props.value, "iPhone 17 Pro")
  assert.ok(!h.unsavedBadge())
  assert.equal(h.dirty.at(-1), false)

  // A link's own Save, with an edit typed while it runs.
  label().props.onChange({ target: { value: "iPhone 17 Air" } })
  h.render()
  server.hold = true
  const saving = h.all((n) => n.type === "Button" && n.props.variant === "primary" && n.props.children === "Save")[0].props.onClick()
  label().props.onChange({ target: { value: "iPhone 17e" } })
  h.render()
  server.release()
  await saving
  await h.settle()
  assert.equal(server.items[0].label, "iPhone 17 Air")
  assert.equal(label().props.value, "iPhone 17e")
  assert.ok(h.unsavedBadge())

  // Discard drops the card's link edits too.
  h.button("Discard").props.onClick()
  h.render()
  assert.equal(label().props.value, "iPhone 17 Air")
  assert.ok(!h.unsavedBadge())
})

test("editor: settings rebuilt in another key order, or changed and changed back, are not unsaved", async () => {
  const styles = menuSection({ id: "sty", label: "Styles", href: null, kind: "case_types", config: { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/" } } })
  const row = menuSection({ id: "col", label: "Collections", href: null, kind: "collections", placement: "drawer", position: -1, config: { title: "Collections", view_all_href: "/collections/", limit: 8 } })
  const server = fakeServer([styles, row], [])
  const catalog = { caseTypes: caseTypes, allCaseTypes: caseTypes, devices: [] }
  const h = mountMenuEditor({ server, catalog })
  await h.settle()
  assert.deepEqual(Object.keys(jsonb({ form: "phone", exclude: [], links: {} })), ["form", "links", "exclude"], "saved configs come back reordered")

  for (const [id, settings, change, back] of [
    ["sty", "CaseStylesSettings", (c) => ({ ...c, exclude: [...c.exclude, "signature"] }), (c) => ({ ...c, exclude: c.exclude.filter((s) => s !== "signature") })],
    ["col", "CollectionsRowSettings", (c) => ({ ...c, title: "Shop collections" }), (c) => ({ ...c, title: "Collections" })],
  ]) {
    h.cardToggle(id).props.onClick()
    h.render()
    const editor = () => h.one((n) => n.type === settings, settings)
    editor().props.onChange(change(editor().props.config))
    h.render()
    assert.ok(h.unsavedBadge(), `${id}: a real change`)
    editor().props.onChange(back(editor().props.config))
    h.render()
    assert.ok(!h.unsavedBadge(), `${id}: changed back`)
    assert.equal(h.dirty.at(-1), false)
    assert.equal(h.unsaved, false)
    assert.equal(h.button("Save changes").props.disabled, true)
    h.cardToggle(id).props.onClick()
    h.render()
  }
})

test("safe links, forms and brand fit", () => {
  for (const href of ["/collection/leopard/", "https://new.florayn.com/shop/"]) assert.equal(safeMenuHref(href), true, href)
  for (const href of ["", "//evil.test", "/\\evil", "javascript:alert(1)", "http://example.com/", "https://u:p@example.com/", "/a b/"]) assert.equal(safeMenuHref(href), false, href)
  assert.deepEqual(plain(formsOf(caseTypes[1])), ["phone", "airpods"])
  assert.equal(fitsEveryFamily(caseTypes[1], ["iphone", "samsung"]), true)
  assert.equal(fitsEveryFamily(caseTypes[0], ["iphone", "samsung"]), false)
  assert.equal(fitsEveryFamily(caseTypes[0], []), true)
})

test("defaults are read off the section and saved settings survive", () => {
  assert.deepEqual(plain(guessFamilies("Earbuds /shop/airpods-pro-3/")), ["airpods"])
  assert.deepEqual(plain(guessFamilies("Phone Case /shop/iphone-17/ Samsung S26")), ["iphone", "samsung"])
  assert.deepEqual(plain(guessFamilies("Accessories")), ["iphone", "samsung"])
  assert.deepEqual(plain(readConfig("devices", { families: ["samsung", "iphone", "samsung", "nokia"], case_type: "signature" })), { families: ["samsung", "iphone"], case_type: "signature" })
  assert.deepEqual(plain(readConfig("case_types", null)), { form: "phone", exclude: [], links: {} })
  assert.equal(readConfig("links", { anything: 1 }), null)
})

test("search synonyms: blank rows drop, mistakes name their row, the result passes the shared validator", () => {
  const filename = path.join(SRC, "admin/components/storefront-presentation-editor.tsx")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  const deps = { "../../lib/storefront-presentation": presentation, "@medusajs/ui": {}, react: {}, "react/jsx-runtime": {}, "./menu-editor": {}, "./product-manager/shared": {} }
  vm.runInNewContext(code, { exports, require: (name) => { if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(name) } }, { filename })
  const { tidySearch } = exports
  const defaults = presentation.DEFAULT_PRESENTATION.search
  const tidy = tidySearch({ ...defaults, synonyms: [{ words: [" chita ", "cheetah"], means: " leopard " }, { words: [], means: "" }] })
  assert.deepEqual(plain(tidy.synonyms), [{ words: ["chita", "cheetah"], means: "leopard" }])
  assert.deepEqual(plain(presentation.validateSearchPresentation(tidy).synonyms), plain(tidy.synonyms))
  assert.throws(() => tidySearch({ ...defaults, synonyms: [{ words: [], means: "" }, { words: [], means: "case" }] }), { message: "Synonym row 2: add the words shoppers type." })
  assert.throws(() => tidySearch({ ...defaults, synonyms: [{ words: Array(11).fill("a"), means: "b" }] }), { message: "Synonym row 1: use up to 10 words." })
  assert.throws(() => tidySearch({ ...defaults, synonyms: [{ words: ["cover"], means: " " }] }), { message: "Synonym row 1: add what to search for." })
  assert.deepEqual(plain(presentation.validateSearchPresentation(tidySearch(defaults))), plain(defaults))
})
