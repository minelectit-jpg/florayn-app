const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(file, deps = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, URL, require: (name) => deps[name] ?? require(name) })
  return exports
}
const contract = load("lib/storefront-presentation.ts")
const link = { __esModule: true, default: ({ prefetch, ...props }) => React.createElement("a", props) }
const deps = { "@/lib/storefront-presentation": contract, "next/link": link, "@/components/audience-link": link }
const ShippingNote = load("components/shipping-note.tsx", deps).ShippingNote
const FooterLinks = load("components/footer-links.tsx", deps).default
const Footer = load("components/site-footer.tsx", { ...deps, "./footer-links": { __esModule: true, default: FooterLinks } }).default
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))

test("delivery settings render customized cards and links safely and can hide the section", () => {
  const settings = { ...contract.DEFAULT_PRESENTATION.delivery, heading: "Your delivery", cards: [{ icon: "truck", title: "Custom time", description: "<script>unsafe</script>" }], link_label: "Ask us", link_href: "/contact/" }
  const html = render(ShippingNote, { settings })
  assert.ok(html.includes("Your delivery") && html.includes("Custom time") && html.includes("Ask us"))
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"))
  assert.equal(render(ShippingNote, { settings: { ...settings, enabled: false } }), "")
  assert.equal(render(ShippingNote, { settings: { ...settings, cards: [] } }), "")
})
test("footer retains all managed links in server HTML with accessible mobile accordion controls", () => {
  const columns = ["Support", "Explore"].map((label, i) => ({ id: String(i), label, groups: [{ heading: null, links: [{ id: "good", label: "Contact us", href: "/contact/", badge: null }, { id: "bad", label: "Unsafe", href: "javascript:alert(1)" }] }] }))
  const html = render(Footer, { columns, note: "Custom copyright", social: [], appearance: { ...contract.DEFAULT_PRESENTATION.footer, tagline: "Custom tagline", support_label: "", support_href: "" } })
  assert.ok(html.includes("Custom copyright") && html.includes("Custom tagline"))
  assert.equal((html.match(/href="\/contact\/"/g) ?? []).length, 2)
  assert.ok(!html.includes("Unsafe") && !html.includes("javascript:"))
  assert.ok(html.includes('aria-expanded="true"') && html.includes('aria-expanded="false"'))
  assert.equal((html.match(/aria-controls=/g) ?? []).length, 2)
})

test("the lines under the buy buttons come from the delivery cards and the free-delivery rule, as plain text", () => {
  const { BuyAssurance } = load("components/shipping-note.tsx", deps)
  const html = render(BuyAssurance, { cards: contract.DEFAULT_PRESENTATION.delivery.cards, freeDelivery: "Free delivery on orders over 3,400.00৳" })
  const items = [...html.matchAll(/<li>[\s\S]*?<span>([^<]+)<\/span><\/li>/g)].map((m) => m[1])
  assert.deepEqual(items, ["Cash on delivery available", "Delivery 60৳ inside Dhaka · 100৳ outside", "Easy exchange within 3 days", "Free delivery on orders over 3,400.00৳"])
  assert.match(html, /aria-hidden="true"/)
  assert.doesNotMatch(html, /<a |<button/)
  assert.equal(render(BuyAssurance, { cards: contract.DEFAULT_PRESENTATION.delivery.cards.map((c) => ({ ...c, buy_line: "" })), freeDelivery: null }), "")
  const four = [...contract.DEFAULT_PRESENTATION.delivery.cards, { icon: "heart", title: "Gift", description: "", buy_line: "A fourth line" }]
  assert.doesNotMatch(render(BuyAssurance, { cards: four, freeDelivery: null }), /A fourth line/, "never more than three card lines")
})
