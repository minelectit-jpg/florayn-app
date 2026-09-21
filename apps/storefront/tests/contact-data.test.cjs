const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))

function harness(response = {}, options = {}) {
  const filename = path.join(__dirname, "../src/lib/contact.ts")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const calls = []
  const exports = {}
  let cacheWrappers = 0
  vm.runInNewContext(code, {
    exports,
    process: { env: { NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://backend.invalid", NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_fixture_only" } },
    AbortSignal: { timeout: (milliseconds) => ({ timeout: milliseconds }) },
    fetch: async (url, init) => {
      calls.push({ url, ...plain(init) })
      if (options.networkFailure) throw new Error("offline")
      return { ok: options.status == null || options.status < 400, async json() {
        if (options.invalidJson) throw new Error("Invalid JSON")
        return response
      } }
    },
    require(name) {
      if (name === "react") return { cache: (fn) => {
        cacheWrappers++
        let result
        return () => result ??= fn()
      } }
      throw new Error(`Unexpected dependency ${name}: Contact must not load the catalog or SDK`)
    },
  }, { filename })
  return { ...exports, calls, cacheWrappers }
}

test("contact defaults preserve useful existing contact details during missing or malformed responses", async () => {
  for (const response of [null, {}, { settings: null }, { settings: [] }, { settings: "invalid" }]) {
    const h = harness(response)
    assert.deepEqual(plain(await h.getContactSettings()), plain(h.DEFAULT_CONTACT_SETTINGS))
  }
  const defaults = harness().DEFAULT_CONTACT_SETTINGS
  assert.equal(defaults.phone, "+8801310007055")
  assert.equal(defaults.email, "info@florayn.com")
  assert.match(defaults.address, /Aftabnagar/)
  assert.equal(defaults.faqs.length, 4)
})

test("explicit blank optional contact fields and an empty FAQ list remain empty", async () => {
  const h = harness()
  const required = new Set(["title", "faq_title", "phone_label", "email_label", "address_label"])
  const optional = Object.fromEntries(Object.keys(h.DEFAULT_CONTACT_SETTINGS)
    .filter((key) => key !== "faqs" && !required.has(key)).map((key) => [key, ""]))
  const actual = plain(h.normalizeContactSettings({ ...optional, title: "  ", faqs: [] }))
  for (const key of Object.keys(optional)) assert.equal(actual[key], "", key)
  assert.equal(actual.title, h.DEFAULT_CONTACT_SETTINGS.title)
  assert.deepEqual(actual.faqs, [])
})

test("runtime normalization drops malformed FAQ rows and projects only public fields", () => {
  const h = harness()
  const input = { title: "Updated contact", phone_label: null, email: 42, unknown_private_field: "must not escape",
    faqs: [null, "wrong", { id: "missing-answer", question: "Question?" },
      { id: "valid", question: "  A useful question?  ", answer: "  A useful answer.  ", internal: "hidden" }] }
  const result = plain(h.normalizeContactSettings(input))
  assert.equal(result.title, "Updated contact")
  assert.equal(result.phone_label, h.DEFAULT_CONTACT_SETTINGS.phone_label)
  assert.equal(result.email, h.DEFAULT_CONTACT_SETTINGS.email)
  assert.deepEqual(result.faqs, [{ id: "valid", question: "A useful question?", answer: "A useful answer." }])
  assert.ok(!Object.hasOwn(result, "unknown_private_field"))
  result.faqs[0].answer = "Changed copy"
  assert.equal(input.faqs[3].answer, "  A useful answer.  ")
  const fallback = h.normalizeContactSettings({})
  fallback.faqs[0].answer = "Changed fallback"
  assert.notEqual(fallback.faqs[0].answer, h.DEFAULT_CONTACT_SETTINGS.faqs[0].answer)
})

test("contact server reads use only the small scoped endpoint and share metadata/page work", async () => {
  const h = harness({ settings: { title: "Saved title", faqs: [] } })
  const [metadata, page] = await Promise.all([h.getContactSettings(), h.getContactSettings()])
  assert.equal(metadata, page)
  assert.equal(metadata.title, "Saved title")
  assert.equal(h.cacheWrappers, 1)
  assert.equal(h.calls.length, 1)
  const request = h.calls[0]
  assert.equal(request.url, "http://backend.invalid/store/contact-settings")
  assert.deepEqual(request.next, { revalidate: 60, tags: ["content", "content:contact"] })
  assert.equal(request.headers["x-publishable-api-key"], "pk_fixture_only")
  assert.ok(request.signal.timeout > 0 && request.signal.timeout <= 5000)
})

test("API absence, invalid JSON and bounded network failure preserve usable contact defaults", async () => {
  for (const options of [{ status: 404 }, { status: 503 }, { invalidJson: true }, { networkFailure: true }]) {
    const h = harness({}, options)
    assert.deepEqual(plain(await h.getContactSettings()), plain(h.DEFAULT_CONTACT_SETTINGS))
  }
})

test("storefront fallback defaults match the backend's published contact contract", () => {
  const filename = path.join(__dirname, "../../backend/src/modules/content/contact-settings.ts")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename })
  assert.deepEqual(plain(harness().DEFAULT_CONTACT_SETTINGS), plain(exports.DEFAULT_CONTACT_SETTINGS))
})

test("unsafe links, duplicate IDs and unbounded fields cannot leak through settings", () => {
  const h = harness()
  const result = h.normalizeContactSettings({ phone: "javascript:alert(1)", email: "a@example.com?subject=unexpected",
    title: "x".repeat(121), address: "<script>alert(1)</script>", faqs: [
      { id: "first", question: "One?", answer: "First answer" },
      { id: "first", question: "Duplicate?", answer: "Second answer" },
      { id: "invalid id", question: "Invalid?", answer: "Not rendered" },
    ] })
  for (const key of ["phone", "email", "title", "address"]) assert.equal(result[key], h.DEFAULT_CONTACT_SETTINGS[key])
  assert.deepEqual(plain(result.faqs), [{ id: "first", question: "One?", answer: "First answer" }])
  const normalized = h.normalizeContactSettings({ phone: "০১৭০০০০০০০০", email: " Support@Example.COM " })
  assert.equal(normalized.phone, "+8801700000000")
  assert.equal(normalized.email, "support@example.com")
})
