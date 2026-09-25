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
  assert.equal("free_delivery_line" in b, false, "no promise lines under the buttons")
  const legacy = readPresentation({ footer: defaults.footer, delivery: defaults.delivery })
  assert.deepEqual(plain(legacy.buy_box), plain(b), "a store saved before buy buttons existed gets the defaults")
  const blanks = readPresentation({ buy_box: { sold_out_label: "" } })
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
  ]
  for (const [patch, message] of bad) assert.throws(() => validateBuyBoxPresentation({ ...valid, ...patch }), message, JSON.stringify(patch))
})

test("delivery cards no longer carry lines for under the buy buttons; an old saved line is dropped", () => {
  assert.ok(defaults.delivery.cards.every((c) => !("buy_line" in c)))
  const saved = readPresentation({ delivery: { ...defaults.delivery, cards: defaults.delivery.cards.map((c) => ({ ...c, buy_line: "Cash on delivery available" })) }, buy_box: { ...defaults.buy_box, free_delivery_line: "Free delivery on orders over {amount}" } })
  assert.ok(saved.delivery.cards.every((c) => !("buy_line" in c)))
  assert.equal("free_delivery_line" in saved.buy_box, false)
})

test("Navigation and Search settings: an old store gets the defaults, and bad values are refused", () => {
  const { validateNavigationPresentation, validateSearchPresentation } = exportsObject
  const read = readPresentation(null)
  assert.deepEqual(plain(read.navigation), plain(defaults.navigation))
  assert.deepEqual(plain(read.search), plain(defaults.search))
  assert.equal(read.navigation.family_labels.samsung, "Samsung Galaxy")
  assert.deepEqual(plain(read.navigation.drawer_links), [{ label: "My account", href: "/account/" }, { label: "Help & contact", href: "/contact/" }])
  assert.equal(read.navigation.remember_device, true)
  assert.equal(read.search.placeholder, "Search")
  assert.deepEqual(plain(read.search.suggest_women), ["iPhone 17 Pro Max", "Samsung S26 Ultra", "AirPods Pro 3", "Alcantara"])
  assert.equal(read.search.help_href, "/contact/")
  assert.ok(read.search.synonyms.some((row) => row.means === "leopard" && row.words.includes("chita")))
  // Admin > Navigation and Admin > Search save through the same workflow.
  const workflow = fs.readFileSync(path.join(__dirname, "../src/workflows/save-storefront-presentation.ts"), "utf8")
  assert.match(workflow, /navigation: validateNavigationPresentation,/)
  assert.match(workflow, /search: validateSearchPresentation,/)

  const s = defaults.search
  assert.deepEqual(plain(validateSearchPresentation(s)), plain(s))
  assert.throws(() => validateSearchPresentation({ ...s, suggest_women: Array(9).fill("Leopard") }), /up to 8/)
  assert.throws(() => validateSearchPresentation({ ...s, suggest_men: Array(9).fill("Carbon") }), /up to 8/)
  assert.throws(() => validateSearchPresentation({ ...s, synonyms: Array(101).fill({ words: ["chita"], means: "leopard" }) }), /100 synonym rows/)
  assert.throws(() => validateSearchPresentation({ ...s, help_href: "javascript:alert(1)" }))
  assert.throws(() => validateSearchPresentation({ ...s, help_href: "//evil.test" }))
  assert.throws(() => validateSearchPresentation({ ...s, placeholder: "x".repeat(61) }))

  const n = defaults.navigation
  assert.deepEqual(plain(validateNavigationPresentation(n)), plain(n))
  assert.throws(() => validateNavigationPresentation({ ...n, drawer_links: Array(7).fill(n.drawer_links[0]) }), /6 menu bottom links/)
  assert.throws(() => validateNavigationPresentation({ ...n, drawer_links: [{ label: "Bad", href: "javascript:alert(1)" }] }))
  assert.throws(() => validateNavigationPresentation({ ...n, remember_device: "yes" }))
})
