const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const backend = fs.readFileSync(path.join(__dirname, "../src/lib/storefront-presentation.ts"), "utf8")
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(backend, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, URL })
const { DEFAULT_PRESENTATION: defaults, readPresentation, validateFooterPresentation, validateDeliveryPresentation, safePresentationHref } = exportsObject
const plain = (value) => JSON.parse(JSON.stringify(value))

test("both apps share the same presentation contract", () => {
  assert.equal(backend, fs.readFileSync(path.join(__dirname, "../../storefront/src/lib/storefront-presentation.ts"), "utf8"))
})
test("old stores fall back safely while deliberate hidden sections and empty copy survive", () => {
  assert.deepEqual(plain(readPresentation(null)), plain(defaults))
  const saved = readPresentation({ footer: { tagline: "", note: "", social: [], support_label: "", support_href: "" }, delivery: { enabled: false, cards: [], heading: "" } })
  assert.equal(saved.footer.note, "")
  assert.equal(saved.footer.tagline, "")
  assert.deepEqual(plain(saved.footer.social), [])
  assert.equal(saved.delivery.enabled, false)
  assert.deepEqual(plain(saved.delivery.cards), [])
  assert.equal(saved.delivery.heading, "")
})
test("presentation links reject executable schemes, ambiguous hosts and control characters", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.test", "/\\evil.test", "https://user:pass@example.com", "https://example.com\n", ""]) assert.equal(safePresentationHref(href), false, href)
  for (const href of ["/contact/", "https://example.com/support", "mailto:help@example.com", "tel:+8801310007055"]) assert.equal(safePresentationHref(href), true, href)
  assert.throws(() => validateFooterPresentation({ ...defaults.footer, support_href: "//evil.test" }))
  assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, link_label: "", link_href: "/contact/" }))
})
test("card and social edits preserve order, validate limits and reject malformed settings", () => {
  const cards = [...defaults.delivery.cards].reverse()
  assert.deepEqual(plain(validateDeliveryPresentation({ ...defaults.delivery, cards }).cards), plain(cards))
  for (const patch of [{ cards: [{}] }, { enabled: "true" }, { cards: Array(7).fill(cards[0]) }, { cards: [{ ...cards[0], icon: "code" }] }, { cards: [{ ...cards[0], title: "" }] }]) assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, ...patch }))
  for (const patch of [{ brand: "" }, { note: "x".repeat(201) }, { social: Array(9).fill(defaults.footer.social[0]) }, { social: [{ label: "Unsafe", href: "javascript:alert(1)" }] }]) assert.throws(() => validateFooterPresentation({ ...defaults.footer, ...patch }))
  assert.deepEqual(plain(readPresentation({ footer: { social: "broken" }, delivery: { cards: "broken" } })), plain(defaults))
})
