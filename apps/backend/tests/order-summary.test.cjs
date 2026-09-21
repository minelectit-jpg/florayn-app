const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const utils = require("@medusajs/framework/utils")
// Exercise the installed Medusa status arithmetic without initializing every workflow.
const payment = require(path.join(path.dirname(require.resolve("@medusajs/core-flows")), "order/utils/aggregate-status.js"))

function load(file, dependencies) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const summary = load("lib/order-summary.ts", {
  "@medusajs/medusa/core-flows": payment, "@medusajs/framework/utils": utils,
})

function orderFixture() {
  const order = {
    id: "order_fixture", display_id: 123, status: "pending", currency_code: "bdt", created_at: "2026-09-21T00:00:00Z",
    metadata: { free_shipping: true, customer_phone: "01712345678", order_note: "Private instruction" },
    email: "private@example.invalid", shipping_address: { first_name: "Test", last_name: "Customer",
      address_1: "12 Fixture Road", address_2: "Fixture Area", province: "Gazipur", phone: "01712345678" },
    items: [{ id: "item_a", variant_id: "variant_a", title: "Stored case title", variant_title: "Signature / iPhone 17 Pro",
      quantity: 1, unit_price: 1400, thumbnail: "https://example.invalid/generic.webp", tax_lines: [], adjustments: [] },
    { id: "item_b", variant_id: "variant_b", title: "Stored accessory title", quantity: 1, unit_price: 350, tax_lines: [], adjustments: [] }],
    shipping_methods: [{ id: "ship_a", name: "Outside Dhaka", amount: 100, tax_lines: [], adjustments: [] }],
    payment_collections: [{ amount: 1850, captured_amount: 0, refunded_amount: 0, status: "authorized" }],
  }
  return utils.decorateCartTotals(order)
}

test("confirmation separates actual Medusa goods and delivery totals and masks private data", () => {
  const order = orderFixture()
  assert.equal(Number(order.subtotal), 1850, "Medusa subtotal includes delivery")
  const result = summary.projectOrderSummary(order, new Map())
  assert.equal(result.subtotal, 1750)
  assert.equal(result.shipping_total, 100)
  assert.equal(result.total, 1850)
  assert.equal(result.discount_total, 0)
  assert.equal(result.tax_total, 0)
  assert.equal(result.free_shipping, false, "Do not trust a stale metadata shipping flag")
  assert.equal(result.items[0].total, 1400)
  assert.equal(result.items[1].total, 350)
  assert.equal(result.payment_status, "authorized")
  assert.equal(result.delivery.phone, "017*****678")
  assert.ok(!("metadata" in result) && !("email" in result) && !("payment_collections" in result))
  assert.ok(!JSON.stringify(result).includes("Private instruction"))
  order.shipping_address.phone = "123"
  assert.equal(summary.projectOrderSummary(order, new Map()).delivery.phone, "***")
})

test("goods discounts and taxes reconcile without subtracting shipping savings or tax twice", () => {
  const order = orderFixture()
  order.items[0].quantity = 2
  order.items[0].tax_lines = [{ rate: 10 }]
  order.items[0].adjustments = [{ amount: 300, is_tax_inclusive: false }]
  order.shipping_methods[0].adjustments = [{ amount: 100, is_tax_inclusive: false }]
  utils.decorateCartTotals(order)
  const result = summary.projectOrderSummary(order, new Map())
  assert.equal(Number(order.discount_total), 430, "Medusa combines goods, discount tax and delivery savings")
  assert.equal(result.subtotal, 3150)
  assert.equal(result.discount_total, 300)
  assert.equal(result.tax_total, 250)
  assert.equal(result.shipping_total, 0)
  assert.equal(result.total, 3100)
  assert.equal(result.items[0].total, 2750)
  assert.equal(result.subtotal - result.discount_total + result.tax_total + result.shipping_total, result.total)
})

test("saved selected images survive catalog changes and legacy fallbacks never replace order data", () => {
  const order = orderFixture()
  order.metadata.checkout_item_images = { variant_a: "https://example.invalid/ordered-model.webp", variant_b: null }
  const catalog = new Map([["variant_a", "https://example.invalid/new-image.webp"], ["variant_b", "https://example.invalid/added-image.webp"]])
  const saved = summary.projectOrderSummary(order, catalog)
  assert.equal(saved.items[0].thumbnail, "https://example.invalid/ordered-model.webp")
  assert.equal(saved.items[1].thumbnail, null)
  assert.equal(saved.items[0].title, "Stored case title")
  delete order.metadata.checkout_item_images
  assert.equal(summary.projectOrderSummary(order, catalog).items[0].thumbnail, "https://example.invalid/new-image.webp")
  assert.equal(summary.projectOrderSummary(order, new Map()).items[0].thumbnail, "https://example.invalid/generic.webp")
})

test("native payment state distinguishes authorization, collection, partial collection and refunds", () => {
  const order = orderFixture()
  const payment = order.payment_collections[0]
  payment.captured_amount = 500
  assert.equal(summary.projectOrderSummary(order, new Map()).payment_status, "partially_captured")
  payment.captured_amount = 1850
  assert.equal(summary.projectOrderSummary(order, new Map()).payment_status, "captured")
  payment.refunded_amount = 500
  assert.equal(summary.projectOrderSummary(order, new Map()).payment_status, "partially_refunded")
  payment.refunded_amount = 1850
  order.status = "canceled"
  const result = summary.projectOrderSummary(order, new Map())
  assert.equal(result.payment_status, "refunded")
  assert.equal(result.status, "canceled")
  assert.equal(result.total, 1850)
})

test("summary reads only unresolved selected variants and uses opaque order ID", async () => {
  let step
  class Response { constructor(result) { this.result = result } }
  load("workflows/order-summary.ts", {
    "@medusajs/framework/utils": utils,
    "@medusajs/framework/workflows-sdk": {
      createStep: (_name, callback) => { step = callback; return () => {} },
      createWorkflow: () => {}, StepResponse: Response, WorkflowResponse: Response,
    }, "../lib/order-summary": summary,
  })
  const order = orderFixture(), calls = []
  order.metadata.checkout_item_images = { variant_a: "https://example.invalid/saved.webp" }
  const container = { resolve: () => ({ graph: async (request) => {
    calls.push(plain(request))
    return request.entity === "order" ? { data: [order] } : { data: [{ id: "variant_b", metadata: { images: ["https://example.invalid/accessory.webp"], private_extra: "not public" } }] }
  } }) }
  const result = (await step({ id: order.id }, { container })).result
  assert.deepEqual(calls[0].filters, { id: order.id })
  assert.ok(!calls[0].fields.some((field) => field.includes("*") || field === "email"))
  assert.deepEqual(calls[1], { entity: "product_variant", fields: ["id", "metadata"], filters: { id: ["variant_b"] } })
  assert.equal(result.items[1].thumbnail, "https://example.invalid/accessory.webp")
  assert.ok(!JSON.stringify(result).includes("private_extra"))
  calls.length = 0
  order.metadata.checkout_item_images.variant_b = null
  await step({ id: order.id }, { container })
  assert.equal(calls.length, 1, "Snapshot orders need no catalog read")
})

test("order confirmation responses are private and uncached including unknown orders", async () => {
  let next = { id: "order_fixture" }, observed
  const route = load("api/store/checkout/[id]/route.ts", {
    "../../../../workflows/order-summary": { orderSummaryWorkflow: () => ({ run: async ({ input }) => { observed = input; return { result: next } } }) },
  })
  const headers = {}, response = { statusCode: 200, setHeader: (name, value) => { headers[name] = value },
    status(code) { this.statusCode = code; return this }, json(body) { return body } }
  await route.GET({ scope: {}, params: { id: "order_fixture" } }, response)
  assert.equal(observed.id, "order_fixture")
  assert.equal(headers["Cache-Control"], "private, no-store")
  next = null
  assert.deepEqual(plain(await route.GET({ scope: {}, params: { id: "missing" } }, response)), { message: "Order not found" })
  assert.equal(response.statusCode, 404)
})
