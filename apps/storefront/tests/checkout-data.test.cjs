const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src/lib", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const forms = load("checkout-form-data.ts")
const validFields = { full_name: "Fixture Customer", phone: "01700000000", email: "", address: "Test address 12", district: "Dhaka", area: "Test area", note: "" }

test("checkout accepts local, international, formatted and Bengali mobile numbers", () => {
  for (const phone of ["01700000000", "1700000000", "+8801700000000", "+880 1700-000000", "০১৭০০০০০০০০", "+৮৮০ ১৭০০-০০০০০০"]) {
    assert.equal(forms.normalizeCheckoutPhone(phone), "01700000000", phone)
    assert.deepEqual(plain(forms.validateCheckout({ ...validFields, phone }, ["Dhaka"])), {}, phone)
  }
  for (const phone of ["", "01200000000", "0170000000", "+441700000000", "not a number"]) {
    assert.ok(forms.validateCheckout({ ...validFields, phone }, ["Dhaka"]).phone, phone)
  }
})

test("checkout validates real districts, useful delivery details and optional field boundaries", () => {
  assert.deepEqual(plain(forms.validateCheckout(validFields, ["Dhaka", "Gazipur"])), {})
  for (const [field, value] of [
    ["full_name", "A"], ["full_name", "A".repeat(101)], ["district", "Unknown district"],
    ["area", " "], ["area", "x".repeat(101)], ["address", "abc"], ["address", "x".repeat(501)],
    ["email", "invalid@"], ["email", `${"x".repeat(250)}@example.invalid`], ["note", "x".repeat(501)],
  ]) assert.ok(forms.validateCheckout({ ...validFields, [field]: value }, ["Dhaka"])[field], field)
  assert.deepEqual(plain(forms.validateCheckout({ ...validFields, email: "test@example.invalid", note: "Ring the bell" }, ["Dhaka"])), {})
})

test("checkout DTO keeps selected images, model/case, quantity and prices without catalog matrices", () => {
  const source = {
    id: "line_test", title: "Fallback title", quantity: 2, unit_price: 750,
    thumbnail: "https://images.invalid/item.webp", subtitle: "Fallback variant",
    variant: { id: "variant_test", title: "Signature Earbuds / AirPods Pro 3", sku: "PRIVATE-SKU",
      metadata: { images: ["https://images.invalid/selected.webp"], ignored: "PRIVATE-VARIANT" },
      product: { title: "Audit Bloom", handle: "audit-bloom-airpods", thumbnail: "https://images.invalid/product.webp",
        metadata: { card: { pairs: Object.fromEntries(Array.from({ length: 156 }, (_, i) => [`model-${i}`, { image: `PRIVATE-MATRIX-${i}` }])) } } } },
  }
  const result = plain(forms.checkoutLines([source]))
  assert.deepEqual(result, [{ id: "line_test", title: "Audit Bloom", variant_title: "Signature Earbuds / AirPods Pro 3",
    quantity: 2, unit_price: 750, subtotal: 1500, thumbnail: "https://images.invalid/selected.webp" }])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|metadata|pairs|variant_test/)
  assert.ok(JSON.stringify(result).length < 500)
  assert.equal(forms.checkoutLines([{ ...source, variant: undefined }])[0].thumbnail, source.thumbnail)
  assert.equal(forms.checkoutLines([{ ...source, variant: undefined }])[0].variant_title, "Fallback variant")
  assert.equal(forms.checkoutLines([{ id: "no_image", title: "No image", quantity: 1, unit_price: 0 }])[0].thumbnail, null)
})

function apiHarness(response = {}, options = {}) {
  const calls = []
  const api = load("checkout.ts", { "./medusa": {
    MEDUSA_BACKEND_URL: "https://backend.invalid", MEDUSA_PUBLISHABLE_KEY: "pk_fixture_only",
  } }, { AbortSignal: { timeout: (milliseconds) => ({ timeout: milliseconds }) }, fetch: async (url, init) => {
    calls.push({ url, ...plain(init) })
    if (options.networkFailure) throw new Error("offline")
    return { ok: options.status == null || options.status < 400, status: options.status ?? 200,
      async json() { if (options.invalidJson) throw new Error("bad json"); return response } }
  } })
  return { ...api, calls }
}

function quote() {
  return { version: "a".repeat(64), currency_code: "bdt", subtotal: 1400, discount_total: 0,
    bundle_discount: 0, shipping_total: 60, shipping_subtotal: 60, tax_total: 0, total: 1460,
    free_shipping: false, shipping_option_id: "ship_fixture", shipping_label: "Inside Dhaka", district: "Dhaka",
    item_count: 1, payment_method: "cash_on_delivery", items: [
      { id: "line_test", title: "Audit case", variant_title: "iPhone 17 Pro Max / Signature", quantity: 1,
        unit_price: 1400, subtotal: 1400, total: 1400, thumbnail: null },
    ] }
}

test("checkout quote requests stay uncached and send only cart capability and district", async () => {
  const expected = quote()
  const h = apiHarness({ quote: expected })
  assert.deepEqual(plain(await h.fetchCheckoutQuote("cart_fixture", "Dhaka")), { ok: true, quote: expected })
  assert.equal(h.calls[0].url, "https://backend.invalid/store/checkout/quote")
  assert.equal(h.calls[0].cache, "no-store")
  assert.ok(h.calls[0].signal.timeout > 0 && h.calls[0].signal.timeout <= 15000, "quote reads need a bounded wait")
  assert.deepEqual(JSON.parse(h.calls[0].body), { cart_id: "cart_fixture", district: "Dhaka" })
  assert.equal(h.calls[0].headers["x-publishable-api-key"], "pk_fixture_only")
})

test("malformed backend errors and network failures always become visible form errors", async () => {
  for (const response of [null, {}, { errors: "broken" }, { errors: { form: { message: "wrong type" } } }, { errors: ["Unexpected array"] }]) {
    const result = await apiHarness(response, { status: 503 }).fetchCheckoutQuote("cart_fixture", "Dhaka")
    assert.equal(result.ok, false)
    assert.equal(typeof result.errors.form, "string")
    assert.ok(result.errors.form.length)
  }
  const h = apiHarness({}, { networkFailure: true })
  assert.equal((await h.fetchCheckoutQuote("cart_fixture", "Dhaka")).ok, false)
  assert.equal((await h.placeOrder({ ...validFields, cart_id: "cart_fixture", quote_version: "old" })).ok, false)
})

test("malformed or incomplete successful quotes never reach the checkout UI", async () => {
  for (const value of [null, {}, { version: "abc", total: 100 }, { ...quote(), items: null },
    { ...quote(), total: -1 }, { ...quote(), district: "" }, { ...quote(), version: 12 },
  ]) {
    const result = await apiHarness({ quote: value }).fetchCheckoutQuote("cart_fixture", "Dhaka")
    assert.equal(result.ok, false, JSON.stringify(value))
    assert.ok(result.errors.form)
  }
})

test("a changed quote is retained for review while failed completion never reports success", async () => {
  const expected = quote()
  const h = apiHarness({ errors: { form: "Review changed total" }, quote: expected }, { status: 409 })
  const result = await h.placeOrder({ ...validFields, cart_id: "cart_fixture", quote_version: "previous" })
  assert.equal(result.ok, false)
  assert.deepEqual(plain(result.quote), expected)
  assert.equal(h.calls[0].cache, "no-store")
  assert.ok(h.calls[0].signal.timeout > 0 && h.calls[0].signal.timeout <= 60000, "completion has a bounded wait and supports recovery")
  assert.equal(JSON.parse(h.calls[0].body).quote_version, "previous")
  for (const order of [undefined, {}, { id: {} }, { id: 123 }]) {
    const malformed = await apiHarness({ order }).placeOrder({ ...validFields, cart_id: "cart_fixture", quote_version: expected.version })
    assert.equal(malformed.ok, false)
  }
})

test("cart subtotal remains the goods subtotal after checkout attaches delivery", async () => {
  const retrieveCalls = []
  const deleted = []
  const serverCart = { id: "cart_fixture", currency_code: "bdt", subtotal: 1460, item_subtotal: 1400,
    shipping_total: 60, total: 1360, items: [{ id: "line_test", title: "Audit case", unit_price: 1400, quantity: 1 }] }
  const cart = load("cart.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "cart_fixture" }), delete: (name) => deleted.push(name) }) },
    "next/cache": { revalidatePath: () => {} },
    "./bundles": { cartDiscount: () => 100, getBundleConfig: async () => ({}) },
    "./checkout": { placeOrder: async () => ({ ok: false, errors: { form: "Try again" } }), fetchCheckoutQuote: async () => ({ ok: false, errors: { form: "Try again" } }) },
    "./medusa": { getRegionId: async () => "region_fixture", sdk: { store: { cart: { retrieve: async (id, options) => {
      retrieveCalls.push({ id, options: plain(options) })
      return { cart: structuredClone(serverCart) }
    } } } } },
  })
  const actual = await cart.getCart()
  assert.equal(actual.subtotal, 1400)
  assert.equal(actual.bundleDiscount, 100)
  assert.equal((await cart.getCartSummary()).subtotal, 1400)
  assert.match(retrieveCalls[0].options.fields, /item_subtotal/)
  await cart.submitOrder({ ...validFields, quote_version: "old" })
  assert.deepEqual(deleted, [], "failed completion must retain the cart for retry")
})

test("successful checkout retains recovery capability and the next add starts a fresh cart", async () => {
  let cookie = "cart_completed_fixture"
  const cookieWrites = []
  const completed = { id: cookie, completed_at: "2026-09-20T00:00:00.000Z", currency_code: "bdt",
    subtotal: 1400, item_subtotal: 1400, total: 1460,
    items: [{ id: "line_old", title: "Already ordered", unit_price: 1400, quantity: 1 }] }
  const fresh = { id: "cart_fresh_fixture", completed_at: null, currency_code: "bdt",
    subtotal: 0, item_subtotal: 0, total: 0, items: [] }
  const completionCalls = []
  const creationCalls = []
  const itemCalls = []
  const cart = load("cart.ts", {
    "next/headers": { cookies: async () => ({
      get: () => ({ value: cookie }),
      set: (name, value, options) => { cookieWrites.push({ name, value, options: plain(options) }); cookie = value },
      delete: () => assert.fail("Completion must retain the cart capability for response-loss recovery"),
    }) },
    "next/cache": { revalidatePath: () => {} },
    "./bundles": { cartDiscount: () => 0, getBundleConfig: async () => ({}) },
    "./checkout": {
      placeOrder: async (input) => { completionCalls.push(plain(input)); return { ok: true, order: { id: "order_same_fixture", total: 1460, currency_code: "bdt" } } },
      fetchCheckoutQuote: async () => assert.fail("Recovery must not depend on a quote for the completed cart"),
    },
    "./medusa": { getRegionId: async () => "region_fixture", sdk: { store: { cart: {
      retrieve: async (id) => ({ cart: structuredClone(id === completed.id ? completed : fresh) }),
      create: async (input) => { creationCalls.push(plain(input)); return { cart: fresh } },
      createLineItem: async (id, input) => {
        itemCalls.push({ id, input: plain(input) })
        fresh.items.push({ id: "line_fresh", title: "New selection", unit_price: 750, quantity: input.quantity,
          variant: { id: input.variant_id, title: "Signature Earbuds / AirPods Pro 3" } })
        fresh.subtotal = fresh.item_subtotal = fresh.total = 750 * input.quantity
      },
    } } } },
  })
  const input = { ...validFields, quote_version: "original_quote" }
  const first = await cart.submitOrder(input)
  const retry = await cart.submitOrder(input)
  assert.equal(first.order.id, retry.order.id)
  assert.deepEqual(completionCalls.map((call) => call.cart_id), [completed.id, completed.id])
  assert.equal(cookieWrites.length, 0)
  assert.equal(await cart.getCart(), null)
  assert.equal((await cart.getCartSummary()).itemCount, 0)
  const added = await cart.addToCart("variant_new_earbuds", 2)
  assert.deepEqual(creationCalls, [{ region_id: "region_fixture" }])
  assert.deepEqual(itemCalls, [{ id: fresh.id, input: { variant_id: "variant_new_earbuds", quantity: 2 } }])
  assert.equal(cookie, fresh.id)
  assert.equal(cookieWrites[0].options.httpOnly, true)
  assert.equal(cookieWrites[0].options.sameSite, "lax")
  assert.equal(added.summary.itemCount, 2)
  assert.equal(added.summary.subtotal, 1500)
  assert.equal(added.added.variantTitle, "Signature Earbuds / AirPods Pro 3")
  await cart.addToCart("variant_new_earbuds", 1)
  assert.equal(creationCalls.length, 1, "the new open cart is reused for later additions")
})
