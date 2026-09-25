const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

const src = (relative) => path.join(__dirname, "../src", relative)
const modules = new Map()
/** Load a storefront file with its @/lib imports; components around the buy box are stand-ins. */
function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const filename = src(relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText
  const exports = {}
  modules.set(relative, exports)
  vm.runInNewContext(code, { exports, URL, process: { env: {} }, require(name) {
    if (name === "next/navigation") return { useRouter: () => ({ push() {}, prefetch() {} }) }
    if (name === "@/components/cart-provider") return { useCart: () => ({ add: () => { throw new Error("SSR must not touch the cart") }, items: null }) }
    if (name === "@/components/drag-scroll") return { __esModule: true, default: ({ className, children }) => React.createElement("ul", { className }, children) }
    if (name === "@/components/pack-selector") return { __esModule: true, default: () => React.createElement("div", { "data-pack": "" }) }
    if (name === "@/components/wishlist-button") return { __esModule: true, default: () => React.createElement("button", { type: "button", "aria-label": "Save" }) }
    if (["@/components/model-drawer", "@/components/product-image"].includes(name)) return { __esModule: true, default: () => null }
    if (name === "@/components/ui/button") return { Spinner: () => null }
    if (name === "@/components/product-buy-bar") return load("components/product-buy-bar.tsx")
    if (name.startsWith("@/lib/")) return load(`${name.slice(2)}.ts`)
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name)
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

const { buyNowQuantity, maxQuantity, soldOutAlternatives } = load("lib/buy-box.ts")
const { DEFAULT_PRESENTATION } = load("lib/storefront-presentation.ts")
const { pairKey } = load("lib/variant-matrix.ts")
const BuyBox = load("components/product-buy-box.tsx").default

const DEVICE = "iPhone 17 Pro Max"
const CASES = ["Signature", "Elite Clear", "Armor Black"]
const PRICES = { Signature: 1400, "Elite Clear": 1600, "Armor Black": 1950 }
const matrix = {
  caseTypes: CASES,
  devices: [DEVICE],
  variantIdByPair: Object.fromEntries(CASES.map((c) => [pairKey(c, DEVICE), `var_${c}`])),
  devicesByCaseType: Object.fromEntries(CASES.map((c) => [c, [DEVICE]])),
  caseTypesByDevice: { [DEVICE]: CASES },
}
function render({ stock = {}, buyBox = {}, caseType = "Signature", simple = false, bundleConfig = null } = {}) {
  const props = {
    matrix,
    selected: { id: `var_${caseType}`, calculated_price: { calculated_amount: PRICES[caseType] ?? 350, currency_code: "bdt" } },
    families: {}, stock, productHandle: "moon-drift", productTitle: "Moon Drift", designName: "Moon Drift",
    bundleConfig, packDesigns: [], caseTypeRecords: [], matchingProduct: null, thumbnail: null,
    caseType, device: simple ? "" : DEVICE, onSelectCaseType() {}, onSelectDevice() {},
    imageForCaseType: () => null, priceForCaseType: (ct) => PRICES[ct] ?? null,
    buyBox: { ...DEFAULT_PRESENTATION.buy_box, ...buyBox },
    deliveryEstimate: "Delivery in 1–3 business days", simple, optionLabel: simple ? "Color" : undefined,
  }
  return renderToStaticMarkup(React.createElement(BuyBox, props))
}
const buttonText = (html, cls) => (html.match(new RegExp(`<button[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</button>`)) ?? [])[1]?.replace(/<[^>]+>/g, "") ?? null

test("Buy it now adds only what is not in the bag yet when the case was added on this page", () => {
  assert.equal(buyNowQuantity(1, false, null), 1)
  assert.equal(buyNowQuantity(1, true, 1), 0, "Add to cart then Buy it now: straight to checkout, not 2 in the bag")
  assert.equal(buyNowQuantity(2, true, 1), 1)
  assert.equal(buyNowQuantity(1, true, 0), 1, "the line was removed in the drawer")
  assert.equal(buyNowQuantity(3, false, 5), 3, "a line from an earlier visit adds as before")
  assert.equal(buyNowQuantity(2, true, null), 2, "an unknown bag adds as before")
})

test("the quantity never passes live stock", () => {
  assert.equal(maxQuantity(Infinity), 99)
  assert.equal(maxQuantity(0), 1)
  assert.equal(maxQuantity(2.7), 2)
  assert.equal(maxQuantity(500), 99)
})

test("sold-out suggestions are in-stock case types made for this model, in order, at most three", () => {
  const stock = { Signature: 0, "Elite Clear": 4, "Armor Black": 0, Alcantara: Infinity, "Armor Clear": 2, Leather: 1 }
  const all = ["Signature", "Elite Clear", "Armor Black", "Alcantara", "Armor Clear", "Leather"]
  const fits = (ct) => ct !== "Armor Clear"
  assert.deepEqual(soldOutAlternatives({ caseTypes: all, current: "Signature", fits, available: (ct) => stock[ct] }), ["Elite Clear", "Alcantara", "Leather"])
  assert.deepEqual(soldOutAlternatives({ caseTypes: all, current: "Signature", fits, available: (ct) => stock[ct], limit: 1 }), ["Elite Clear"])
  assert.deepEqual(soldOutAlternatives({ caseTypes: ["Signature"], current: "Signature", fits, available: () => 5 }), [])
})

test("one purple button: Buy it now with the price, an outlined Add to cart, a 44px stepper", () => {
  const html = render()
  assert.equal(buttonText(html, "fl-buy-cta--primary"), "Buy it now·1,400.00৳")
  assert.equal(buttonText(html, "fl-buy-cta--outline"), "Add to cart")
  assert.doesNotMatch(html, /<button[^>]*fl-buy-cta--outline[^>]*bg-purple/)
  assert.doesNotMatch(html, /disabled:opacity-60/)
  assert.match(html, /role="group" aria-label="Quantity"/)
  assert.equal((html.match(/size-11/g) ?? []).length, 2, "both stepper buttons are 44px")
  assert.equal((html.match(/aria-live=/g) ?? []).length, 2, "only the quantity and the one status region are live")
  assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button/, "no button inside a link")
  assert.doesNotMatch(html, /Cash on delivery|Free delivery on orders/, "no promise lines under the buttons")
})

test("the admin's labels, filled style and price switch are honoured", () => {
  const html = render({ buyBox: { add_to_cart_style: "filled", show_price_in_buy_now: false, buy_now_label: "Order now", add_to_cart_label: "Add to bag" } })
  assert.equal(buttonText(html, "fl-buy-cta--ink"), "Add to bag")
  assert.equal(buttonText(html, "fl-buy-cta--primary"), "Order now")
  assert.doesNotMatch(html, /fl-buy-cta__price/)
})

test("the quick-buy bar is in the server HTML, hidden and inert until the buttons scroll away", () => {
  const html = render()
  assert.equal((html.match(/class="fl-buybar"/g) ?? []).length, 1)
  assert.match(html, /class="fl-buybar" data-visible="false" data-armed="true" inert="" aria-hidden="true" role="region" aria-label="Quick buy"/)
  assert.match(html, /iPhone 17 Pro Max · Signature/)
  assert.match(html, /fl-buybar__price">1,400\.00৳/)
  assert.match(html, /aria-label="Change model\. iPhone 17 Pro Max · Signature, 1,400\.00৳"/)
  assert.doesNotMatch(render({ buyBox: { sticky_bar: false } }), /fl-buybar/)
  const add = render({ buyBox: { sticky_bar_action: "add_to_cart" } })
  assert.match(add, /fl-buybar__cta fl-buy-cta--ink/)
  const simple = render({ simple: true, caseType: "Rose" })
  assert.match(simple, /<div class="fl-buybar__detail">/, "a colour has no model to change")
})

test("a sold-out case offers the in-stock case types for the same model instead of dead buttons", () => {
  const out = render({ stock: { "Signature|iPhone 17 Pro Max": 0, "Elite Clear|iPhone 17 Pro Max": 4, "Armor Black|iPhone 17 Pro Max": 0 } })
  assert.doesNotMatch(out, /Buy it now/)
  assert.match(out, /class="fl-soldout-alt" role="group" aria-label="Available in"/)
  assert.match(out, /<button type="button">Elite Clear · 1,600\.00৳<\/button>/)
  assert.doesNotMatch(out, /Armor Black · /, "no sold-out suggestion")
  const addButton = out.match(/<button[^>]*fl-buy-cta--outline[^>]*>/)[0]
  assert.match(addButton, /disabled=""/)
  const stockId = out.match(/<p id="([^"]+)" class="fl-pdp-stock is-out"/)[1]
  assert.match(addButton, new RegExp(`aria-describedby="${stockId}"`))
  assert.match(out, /Signature is sold out for iPhone 17 Pro Max/)
  assert.match(out, /fl-buybar__cta[^"]*"[^>]*disabled=""[^>]*>Sold out/)

  const none = render({ stock: Object.fromEntries(CASES.map((c) => [`${c}|${DEVICE}`, 0])) })
  assert.match(none, /<button type="button">Choose another model<\/button>/)
  const off = render({ stock: { "Signature|iPhone 17 Pro Max": 0 }, buyBox: { sold_out_suggestions: false } })
  assert.match(off, /<button type="button" disabled="" class="fl-buy-cta fl-buy-cta--primary[^"]*"[^>]*>Sold out/)
})

test("the page keeps room for the bar only while the bar can show", () => {
  const noVariant = renderToStaticMarkup(React.createElement(BuyBox, { matrix, selected: null, families: {}, stock: {}, productHandle: "x", productTitle: "X", designName: "X", bundleConfig: null, packDesigns: [], caseTypeRecords: [], matchingProduct: null, thumbnail: null, caseType: "Signature", device: DEVICE, onSelectCaseType() {}, onSelectDevice() {}, imageForCaseType: () => null, priceForCaseType: () => null, buyBox: DEFAULT_PRESENTATION.buy_box }))
  assert.match(noVariant, /class="fl-buybar" data-visible="false" data-armed="false"/)
  assert.match(render(), /data-armed="true"/)
})

test("guards: trailing-slash checkout, intent-only prefetch, no scroll listener, portal or client-only render", () => {
  const box = fs.readFileSync(src("components/product-buy-box.tsx"), "utf8")
  const bar = fs.readFileSync(src("components/product-buy-bar.tsx"), "utf8")
  const css = fs.readFileSync(src("app/product-content.css"), "utf8")
  const globals = fs.readFileSync(src("app/globals.css"), "utf8")
  assert.doesNotMatch(box, /push\("\/checkout"\)/)
  assert.doesNotMatch(box, /requestIdleCallback|ssr:\s*false/)
  assert.doesNotMatch(bar, /addEventListener\("scroll"|createPortal|dynamic\(/)
  assert.match(css, /@media \(min-width:1024px\) \{ \.fl-buybar \{ display:none; \} \}/)
  assert.doesNotMatch(css.slice(css.indexOf(".fl-buybar {")), /backdrop-filter/)
  assert.match(css, /@media \(max-width:1023px\) \{\s*body:has\(\.fl-buybar\[data-armed='true'\]\)/, "room for the bar only where it can show")
  assert.match(box, /addEventListener\("pageshow"/, "a Back from checkout never leaves the buttons frozen")
  assert.doesNotMatch(box, /onSelectDevice\(d\)\s*setOpenModel\(false\)\s*setState\("idle"\)/, "picking a model never cancels a running add")
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\) \{\s*\.fl-buy-cta:active/)
  assert.match(globals, /@media \(min-width:1024px\) \{[\s\S]{0,400}\.fl-product-details \{ position:sticky/, "the details panel is sticky only from 1024px, where the bar is hidden")
})
