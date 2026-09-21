const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const ts = require("typescript")

function load(relativePath, dependencies = {}) {
  const filename = path.join(__dirname, "../src", relativePath)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name)
    throw new Error(`Unexpected confirmation dependency ${name}`)
  } }, { filename })
  return exports
}
const money = load("lib/money.ts")
const baseOrder = {
  id: "order_private_fixture", display_id: 2048, created_at: "2026-09-21T20:30:00Z",
  status: "pending", payment_status: "authorized", currency_code: "bdt",
  subtotal: 2800, discount_total: 600, tax_total: 220, shipping_subtotal: 100, shipping_total: 110, total: 2530,
  payment_method: "Cash on Delivery", free_shipping: false, shipping_method: "Outside Dhaka",
  items: [{ id: "item_saved", title: "Saved design", variant_title: "Signature / iPhone 17 Pro Max", sku: "INTERNAL-SKU",
    quantity: 2, unit_price: 1400, subtotal: 2800, discount_total: 600, tax_total: 220, total: 2420,
    thumbnail: "/selected-model-snapshot.webp" }],
  delivery: { name: "Fixture Customer", address: "12 Test Road", area: "Test Area", district: "Gazipur", phone: "017*****678" },
}
const baseSettings = { heading: "Checkout", description: "", delivery_note: "", support_phone: "+8801310007055", support_label: "Need help?", show_order_note: true }

function confirmation(order = baseOrder, settings = baseSettings) {
  const calls = []
  const notFound = new Error("NEXT_NOT_FOUND_FIXTURE")
  const page = load("app/order/[id]/page.tsx", {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { notFound: () => { throw notFound } },
    "@/components/order-reference": { __esModule: true, default: ({ reference }) => React.createElement("button", { type: "button" }, reference) },
    "@/components/product-image": { __esModule: true, default: ({ src, alt }) => React.createElement("img", { src, alt }) },
    "@/lib/checkout": {
      getOrderSummary: async (id) => { calls.push(id); return order },
      getCheckoutSettings: async () => settings,
    },
    "@/lib/money": money,
    "./order.css": {},
  })
  const params = () => ({ params: Promise.resolve({ id: "order_private_fixture" }) })
  return { calls, notFound, page, render: async () => renderToStaticMarkup(await page.default(params())), metadata: () => page.generateMetadata(params()) }
}

test("pending authorized COD confirmation shows saved totals, selected items and an unpaid delivery instruction", async () => {
  const h = confirmation()
  const html = await h.render()
  assert.match(html, /To pay on delivery/)
  assert.match(html, /Pay the courier when your parcel arrives/)
  assert.match(html, /What happens next/)
  assert.match(html, /<strong>2,420\.00৳<\/strong>/, "Saved discounted and taxed line total must be displayed")
  assert.match(html, /<dt>Subtotal<\/dt><dd>2,800\.00৳<\/dd>/)
  assert.match(html, /Savings applied<\/dt><dd>−600\.00৳<\/dd>/)
  assert.match(html, /<dt>Tax<\/dt><dd>220\.00৳<\/dd>/)
  assert.match(html, /<dt>Delivery<\/dt><dd>110\.00৳<\/dd>/)
  assert.match(html, /To pay on delivery<\/dt><dd>2,530\.00৳<\/dd>/)
  assert.match(html, /src="\/selected-model-snapshot\.webp"/)
  assert.match(html, /Signature \/ iPhone 17 Pro Max/)
  assert.match(html, /Qty 2/)
  assert.match(html, /017\*\*\*\*\*678/)
  assert.match(html, /href="tel:\+8801310007055"/)
  const continueShopping = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []).find((anchor) => anchor.includes("Continue shopping"))
  assert.ok(continueShopping, "the order confirmation keeps a Continue shopping action")
  assert.match(continueShopping, /href="https:\/\/florayn\.com\/"/)
  assert.match(html, /Placed on 22 September 2026/, "Placed date uses Bangladesh time, not server time zone")
  assert.doesNotMatch(html, /Payment received|INTERNAL-SKU/)
  assert.deepEqual(h.calls, ["order_private_fixture"])
})

test("paid, refunded, canceled and closed confirmations do not request another COD payment", async () => {
  for (const patch of [
    { payment_status: "captured" }, { payment_status: "partially_captured" },
    { payment_status: "partially_refunded" }, { payment_status: "refunded" },
    { status: "canceled", payment_status: "canceled" },
    { status: "completed" }, { status: "archived" },
  ]) {
    const html = await confirmation({ ...baseOrder, ...patch }).render()
    assert.doesNotMatch(html, /To pay on delivery|Pay the courier|exact amount ready|No advance payment needed/, JSON.stringify(patch))
    assert.match(html, /<dt>Order total<\/dt><dd>2,530\.00৳<\/dd>/)
    if (patch.status === "canceled") {
      assert.match(html, /This order was cancelled/)
      assert.doesNotMatch(html, /Thank you|What happens next|Prepared with care|Delivered to your door/)
    }
    if (["completed", "archived"].includes(patch.status) || patch.payment_status === "refunded") {
      assert.doesNotMatch(html, /What happens next|Prepared with care|Delivered to your door/)
    }
    if (patch.payment_status === "captured") assert.match(html, /Payment received/)
    if (patch.payment_status === "partially_captured") assert.match(html, /Payment partially received/)
    if (patch.payment_status === "refunded") assert.match(html, /Payment refunded/)
  }
})

test("confirmation handles free delivery and optional content without inventing promises", async () => {
  const html = await confirmation({ ...baseOrder, shipping_total: 0, total: 2420, free_shipping: true },
    { ...baseSettings, support_phone: "", delivery_note: "Owner-provided delivery note." }).render()
  assert.match(html, />Free<\/span>/)
  assert.match(html, /Owner-provided delivery note\./)
  assert.doesNotMatch(html, /href="tel:|confirmation email|we will call|tracking number/i)
  const noTax = await confirmation({ ...baseOrder, tax_total: 0, discount_total: 0 }).render()
  assert.doesNotMatch(noTax, /<dt>Tax<\/dt>|Savings applied/)
})

test("order metadata remains nonindexable without referrer leakage and missing orders do not render success", async () => {
  const h = confirmation()
  const metadata = await h.metadata()
  assert.equal(h.page.dynamic, "force-dynamic")
  assert.equal(metadata.title, "Order #2048")
  assert.equal(metadata.robots.index, false)
  assert.equal(metadata.robots.follow, false)
  assert.equal(metadata.referrer, "no-referrer")
  const missing = confirmation(null)
  await assert.rejects(missing.render, (error) => error === missing.notFound)
  assert.equal((await missing.metadata()).title, "Your order")
})
