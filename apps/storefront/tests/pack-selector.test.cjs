const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relative) {
  const filename = path.join(__dirname, "../src", relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, process: { env: {} }, require(name) {
    if (name === "@/components/cart-provider") return { useCart: () => ({ addMany: () => { throw new Error("SSR must not mutate a cart") } }) }
    if (["@/components/choose-design-modal", "@/components/model-drawer", "@/components/product-image"].includes(name)) return { __esModule: true, default: () => null }
    if (name === "@/components/ui/button") return { Spinner: () => null }
    if (name.startsWith("@/lib/")) return load(`${name.slice(2)}.ts`)
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name)
    throw new Error(name)
  } }, { filename })
  return exports
}
const Selector = load("components/pack-selector.tsx").default
const config = { settings: { is_active: true, heading: "Your custom pack heading", matching_set_enabled: true, matching_set_discount: 250 }, tiers: [{ id: "two", quantity: 2, discount_amount: 300, min_pct: 8, max_pct: 12, badge: "Owner's badge" }] }
const props = { config, unitPrice: 1950, baseItem: { handle: "design", variantId: "phone-id", designName: "Design", thumbnail: null }, designs: [], caseTypes: [], matchingProduct: { name: "Design AirPods", handle: "design-airpods", variants: { "AirPods Pro 3": { variantId: "airpods-id", price: 750, image: null } } }, device: "iPhone", caseType: "Armor", bundleMode: true, onModeChange: () => {}, soldOut: false }
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(Selector, { ...props, ...overrides }))

test("single purchase mode does not render bundle item requests or a competing bundle CTA", () => {
  const html = render({ bundleMode: false })
  assert.match(html, /Product only/)
  assert.match(html, /Bundle\/pack/)
  assert.doesNotMatch(html, /Choose item|Add bundle|Estimated total/)
})
test("unfilled packs label estimates and respect configured price clamps and badges", () => {
  const html = render()
  assert.match(html, /Your custom pack heading/)
  assert.match(html, /Owner&#x27;s badge/)
  assert.match(html, /Estimated total/)
  assert.match(html, /3,588\.00/)
  assert.match(html, /Choose 1 more item/)
  assert.doesNotMatch(html, /Best seller|20%/i)
})
test("matching set remains available with no quantity tiers and reconciles its total", () => {
  const html = render({ config: { ...config, tiers: [] } })
  assert.match(html, /The Matching Set/)
  assert.match(html, /2,450\.00/)
  assert.match(html, /Add bundle/)
  assert.doesNotMatch(html, /Estimated total|Choose item/)
})
test("sold-out base variants cannot be added through the bundle control", () => {
  const html = render({ soldOut: true })
  assert.match(html, /<button[^>]*disabled=""[^>]*class="fl-offers__cta"[^>]*>Selected case is sold out/)
})
test("disabled offers and empty offer configurations render no purchase switch", () => {
  assert.equal(render({ config: { ...config, settings: { ...config.settings, is_active: false } } }), "")
  assert.equal(render({ config: { ...config, tiers: [], settings: { ...config.settings, matching_set_enabled: false } } }), "")
})


test("AirPods matching set offers the configured phone model and totals one phone plus one AirPods case", () => {
  const html = render({ config: { ...config, tiers: [] }, unitPrice: 750,
    baseItem: { handle: "design-airpods", variantId: "max-id", designName: "Design", thumbnail: null },
    device: "AirPods Max", caseType: "Signature Earbuds",
    matchingProduct: { name: "Design", handle: "design", form: "phone", defaultDevice: "iPhone 17 Pro Max", variants: {
      "iPhone 12": { variantId: "old-id", price: 1400, image: null },
      "iPhone 17 Pro Max": { variantId: "latest-id", price: 1400, image: null },
    } },
  })
  assert.match(html, /Design phone case/)
  assert.match(html, /iPhone 17 Pro Max/)
  assert.match(html, /1,900\.00/)
  assert.doesNotMatch(html, /Design AirPods case|1,250\.00/)
})
