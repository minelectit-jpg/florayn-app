const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const path = require("node:path")
const test = require("node:test")

async function start(t) {
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
})
