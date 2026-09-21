const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const path = require("node:path")
const test = require("node:test")

async function start(t, { withCart = true } = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, "fixtures/mock-store-api.cjs")], {
    env: { ...process.env, MOCK_STORE_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  })
  t.after(() => child.kill())
  const base = await new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("exit", (code) => reject(new Error(`Fixture exited (${code})`)))
    child.stdout.on("data", (chunk) => {
      const port = chunk.toString().match(/127\.0\.0\.1:(\d+)/)?.[1]
      if (port) resolve(`http://127.0.0.1:${port}`)
    })
  })
  const request = async (route, body, method = body ? "POST" : "GET") => {
    const res = await fetch(`${base}${route}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: res.status, ...await res.json() }
  }
  if (!withCart) return { request }
  const { cart } = await request("/store/carts", {})
  await request(`/store/carts/${cart.id}/line-items`, { variant_id: "variant_audit-bloom_signature_iphone-17-pro-max", quantity: 1 })
  return { request, cartId: cart.id }
}
const delivery = { full_name: "Fixture Customer", phone: "01700000000", address: "Test address 12", district: "Dhaka", area: "Test area" }

test("disposable checkout fixture quotes delivery, edits quantities and grants threshold shipping", { timeout: 10000 }, async (t) => {
  const { request, cartId } = await start(t)
  const settings = await request("/store/checkout-settings")
  assert.equal(settings.settings.heading, "Checkout")
  assert.ok((await request("/store/districts")).districts.includes("Dhaka"))
  const first = await request("/store/checkout/quote", { cart_id: cartId, district: "Dhaka" })
  assert.equal(first.quote.total, 1460)
  assert.equal(first.quote.shipping_total, 60)
  const outside = await request("/store/checkout/quote", { cart_id: cartId, district: "Gazipur" })
  assert.equal(outside.quote.total, 1500)
  assert.notEqual(first.quote.version, outside.quote.version)
  assert.equal((await request("/__test/status")).orderCount, 0)
  await request(`/store/carts/${cartId}/line-items/${first.quote.items[0].id}`, { quantity: 3 })
  const pack = await request("/store/checkout/quote", { cart_id: cartId, district: "Dhaka" })
  assert.equal(pack.quote.subtotal, 4200)
  assert.equal(pack.quote.discount_total, 200)
  assert.equal(pack.quote.shipping_total, 0)
  assert.equal(pack.quote.total, 4000)
  assert.equal(pack.quote.free_shipping, true)
  const cart = (await request(`/store/carts/${cartId}`)).cart
  assert.equal(cart.item_subtotal, 4200)
  assert.equal(cart.subtotal, 4260)
  await request(`/store/carts/${cartId}/line-items/${first.quote.items[0].id}`, undefined, "DELETE")
  assert.equal((await request(`/store/carts/${cartId}`)).cart.items.length, 0)
})

test("disposable checkout rejects stale quotes and recovers the same order after a lost response", { timeout: 10000 }, async (t) => {
  const { request, cartId } = await start(t)
  const { quote } = await request("/store/checkout/quote", { cart_id: cartId, district: "Dhaka" })
  await request("/__test/checkout", { price_delta: 100 })
  const changed = await request("/store/checkout", { ...delivery, cart_id: cartId, quote_version: quote.version })
  assert.equal(changed.status, 409)
  assert.equal(changed.quote.total, 1560)
  assert.equal((await request("/__test/status")).orderCount, 0)
  await request("/__test/checkout", { fail_complete_once: true })
  const input = { ...delivery, cart_id: cartId, quote_version: changed.quote.version }
  assert.equal((await request("/store/checkout", input)).status, 503)
  assert.equal((await request("/__test/status")).orderCount, 0)
  await request("/__test/checkout", { lose_complete_response_once: true })
  await assert.rejects(request("/store/checkout", input))
  assert.equal((await request("/__test/status")).orderCount, 1)
  const recovered = await request("/store/checkout", input)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.order.total, 1560)
  assert.equal((await request("/__test/status")).orderCount, 1)
  const confirmation = await request(`/store/checkout/${recovered.order.id}`)
  assert.equal(confirmation.order.delivery.name, "Fixture Customer")
  assert.equal(confirmation.order.delivery.phone, "017*****000")
  assert.equal(confirmation.order.status, "pending")
  assert.equal(confirmation.order.payment_status, "authorized")
  assert.equal(confirmation.order.subtotal - confirmation.order.discount_total + confirmation.order.tax_total + confirmation.order.shipping_total, confirmation.order.total)
})

test("confirmation previews expose masked narrow order data and consistent totals without creating orders", { timeout: 10000 }, async (t) => {
  const { request } = await start(t, { withCart: false })
  const fields = ["created_at", "currency_code", "delivery", "discount_total", "display_id", "free_shipping", "id", "items", "payment_method", "payment_status", "shipping_method", "shipping_subtotal", "shipping_total", "status", "subtotal", "tax_total", "total"].sort()
  const lineFields = ["discount_total", "id", "quantity", "sku", "subtotal", "tax_total", "thumbnail", "title", "total", "unit_price", "variant_title"].sort()
  const preview = (await request("/store/checkout/order_test_preview")).order
  assert.equal(preview.status, "pending")
  assert.equal(preview.payment_status, "authorized", "COD authorization must not be represented as payment captured")
  assert.equal(preview.items.length, 2)
  assert.equal(preview.subtotal, 1750)
  assert.equal(preview.shipping_subtotal, 100)
  assert.equal(preview.shipping_total, 100)
  assert.equal(preview.total, 1850)
  assert.notEqual(preview.items[0].thumbnail, preview.items[1].thumbnail, "Selected line images must be visually distinguishable")
  assert.ok(preview.items[0].variant_title.includes("iPhone 17 Pro Max"))
  assert.ok(preview.items.every((item) => item.thumbnail.startsWith("data:image/svg+xml,")), "Preview imagery must stay local")
  assert.deepEqual((await request("/store/checkout/order_test_preview")).order, preview, "GET preview is deterministic")
  const discount = (await request("/store/checkout/order_test_discount")).order
  assert.equal(discount.discount_total, 200)
  assert.equal(discount.free_shipping, true)
  assert.equal(discount.shipping_total, 0)
  assert.equal(discount.total, 4350)
  assert.equal(discount.items[0].quantity, 3)
  assert.ok(discount.items[0].total < discount.items[0].unit_price * discount.items[0].quantity, "Discounted line must exercise actual total instead of multiplying list price")
  const cancelled = (await request("/store/checkout/order_test_cancelled")).order
  assert.equal(cancelled.status, "canceled")
  assert.equal(cancelled.payment_status, "canceled")
  assert.equal(cancelled.total, 1850, "Cancellation preserves original order amount, not a claim of remaining payment due")
  for (const order of [preview, discount, cancelled]) {
    assert.deepEqual(Object.keys(order).sort(), fields)
    assert.deepEqual(Object.keys(order.delivery).sort(), ["address", "area", "district", "name", "phone"])
    assert.equal(order.delivery.phone, "017*****678")
    assert.equal(order.subtotal, order.items.reduce((sum, item) => sum + item.subtotal, 0))
    assert.equal(order.discount_total, order.items.reduce((sum, item) => sum + item.discount_total, 0))
    assert.equal(order.subtotal - order.discount_total + order.tax_total + order.shipping_total, order.total)
    assert.equal(order.items.reduce((sum, item) => sum + item.total, 0) + order.shipping_total, order.total)
    for (const item of order.items) {
      assert.deepEqual(Object.keys(item).sort(), lineFields)
      assert.equal(item.subtotal - item.discount_total + item.tax_total, item.total)
    }
  }
  assert.equal((await request("/store/checkout/order_test_missing")).status, 404)
  assert.equal((await request("/store/checkout/order_test_preview", {}, "POST")).status, 404)
  const finalStatus = await request("/__test/status")
  assert.equal(finalStatus.orderCount, 0)
  assert.equal(finalStatus.requests["/store/carts"], undefined, "Preview requires no cart creation")
  assert.equal(finalStatus.requests["/store/checkout"], undefined, "Preview requires no order placement")
})
