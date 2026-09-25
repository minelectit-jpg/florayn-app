const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const backend = fs.readFileSync(path.join(__dirname, "../src/lib/storefront-presentation.ts"), "utf8")
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(backend, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, URL })
const { DEFAULT_PRESENTATION: defaults, readPresentation, validateFooterPresentation, validateDeliveryPresentation, validateBuyBoxPresentation, safePresentationHref } = exportsObject
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
test("the delivery line under the price is Admin copy: defaulted, blankable and single-line", () => {
  // A store saved before the field existed gets the default wording.
  const legacy = readPresentation({ delivery: { enabled: true, heading: "Delivery", cards: defaults.delivery.cards, link_label: "", link_href: "" } })
  assert.equal(legacy.delivery.estimate, "Delivery in 1–3 business days")
  assert.equal(validateDeliveryPresentation({ ...defaults.delivery, estimate: "  Ships in 2 days  " }).estimate, "Ships in 2 days")
  // Blank deliberately hides it and survives a reload.
  assert.equal(readPresentation({ delivery: { ...defaults.delivery, estimate: "" } }).delivery.estimate, "")
  for (const estimate of ["x".repeat(61), 5, "a\nb", "tab\there"]) assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, estimate }), String(estimate))
})

test("the buy buttons settings default sensibly, survive deliberate blanks and reject bad values", () => {
  const b = defaults.buy_box
  assert.equal(b.buy_now_label, "Buy it now")
  assert.equal(b.add_to_cart_style, "outline")
  assert.equal(b.sticky_bar, true)
  assert.equal(b.free_delivery_line, "Free delivery on orders over {amount}")
  const legacy = readPresentation({ footer: defaults.footer, delivery: defaults.delivery })
  assert.deepEqual(plain(legacy.buy_box), plain(b), "a store saved before buy buttons existed gets the defaults")
  const blanks = readPresentation({ buy_box: { free_delivery_line: "", sold_out_label: "" } })
  assert.equal(blanks.buy_box.free_delivery_line, "")
  assert.equal(blanks.buy_box.sold_out_label, "")
  const valid = { ...b }
  assert.equal(validateBuyBoxPresentation({ ...valid, buy_now_label: "Order now" }).buy_now_label, "Order now")
  const bad = [
    [{ add_to_cart_label: "" }, /Add to cart label/],
    [{ add_to_cart_label: "x".repeat(17) }, /Add to cart label/],
    [{ buy_now_label: "x".repeat(21) }, /Buy it now label/],
    [{ buy_now_label: "Buy\nnow" }, /one line/],
    [{ add_to_cart_style: "green" }, /Outline or Filled/],
    [{ sticky_bar_action: "checkout" }, /quick-buy bar shows/],
    [{ sticky_bar: "true" }, /Choose whether to show the quick-buy bar/],
    [{ free_delivery_line: "Free delivery" }, /\{amount\}/],
    [{ free_delivery_line: "x".repeat(49) }, /Free-delivery line/],
  ]
  for (const [patch, message] of bad) assert.throws(() => validateBuyBoxPresentation({ ...valid, ...patch }), message, JSON.stringify(patch))
})

test("delivery cards carry a short line for under the buy buttons: defaulted for untouched cards, at most three", () => {
  const lines = defaults.delivery.cards.map((c) => c.buy_line)
  assert.deepEqual(plain(lines), ["", "Cash on delivery available", "Delivery 60৳ inside Dhaka · 100৳ outside", "Easy exchange within 3 days"])
  const legacyCards = defaults.delivery.cards.map(({ buy_line, ...card }) => card)
  const legacy = readPresentation({ delivery: { ...defaults.delivery, cards: legacyCards } })
  assert.deepEqual(plain(legacy.delivery.cards.map((c) => c.buy_line)), plain(lines), "a saved card that is still the default keeps its line")
  const edited = readPresentation({ delivery: { ...defaults.delivery, cards: [{ ...legacyCards[1], description: "Pay the rider in cash." }] } })
  assert.equal(edited.delivery.cards[0].buy_line, "", "an edited card never shows a line the owner did not write")
  const four = [...defaults.delivery.cards.slice(1), { icon: "heart", title: "Gift", description: "", buy_line: "Gift wrap on request" }, { icon: "truck", title: "Fast", description: "", buy_line: "Same-day in Dhaka" }]
  assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, cards: four }), /at most 3 lines under the buy buttons/)
  assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, cards: [{ ...defaults.delivery.cards[1], buy_line: "x".repeat(49) }] }), /Line under the buy buttons/)
  assert.throws(() => validateDeliveryPresentation({ ...defaults.delivery, cards: [{ ...defaults.delivery.cards[1], buy_line: "two\nlines" }] }), /on one line/)
})
