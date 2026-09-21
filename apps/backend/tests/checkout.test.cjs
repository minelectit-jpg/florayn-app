const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...globals, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const bd = load("modules/catalog/data/bangladesh.ts")
const validation = load("lib/checkout-validation.ts", { "../modules/catalog/data/bangladesh": bd })
const snapshots = load("lib/checkout-cart-snapshot.ts")
class MedusaError extends Error {
  static Types = { INVALID_DATA: "invalid_data" }
  constructor(type, message) { super(message); this.type = type }
}
const utils = { ContainerRegistrationKeys: { QUERY: "query", LOGGER: "logger" }, Modules: {
  LOCKING: "locking", CART: "cart", PROMOTION: "promotion",
}, PromotionActions: { REPLACE: "replace" }, RuleType: { RULES: "rules" }, MedusaError }
const input = { cart_id: "cart_test123", district: "Dhaka", full_name: "Test Customer", phone: "০১৭১২৩৪৫৬৭৮", email: "", address: "12 Test Road", area: "Test Area", note: "" }

function harness(options = {}) {
  const cart = { id: input.cart_id, currency_code: "bdt", completed_at: null, metadata: {},
    shipping_address: {}, items: [{ id: "item_a", variant_id: "variant_a", title: "Test design", variant_title: "Signature / iPhone 17 Pro", quantity: 1, unit_price: 1400, subtotal: 1400, total: 1400, discount_total: 0 }],
    item_subtotal: 1400, item_discount_total: 0, item_tax_total: 0,
    shipping_total: 0, shipping_subtotal: 0, total: 1400, shipping_methods: [],
  }
  const calls = [], orders = []
  let rate = 60, failNextComplete = options.failNextComplete, lateMutation = false, validateHook
  const totals = () => {
    cart.item_subtotal = cart.items.reduce((n, i) => n + i.unit_price * i.quantity, 0)
    for (const item of cart.items) { item.subtotal = item.unit_price * item.quantity; item.total = item.subtotal - (item.discount_total || 0) }
    cart.total = cart.item_subtotal - cart.item_discount_total + cart.shipping_total
  }
  const workflow = (name, fn) => () => ({ run: async ({ input: body }) => { calls.push(name); return { result: await fn(body) } } })
  const workflows = {
    updateCartWorkflow: workflow("update", async (body) => { Object.assign(cart, body); totals() }),
    listShippingOptionsForCartWithPricingWorkflow: workflow("options", async () => options.unavailable ? [] : [{ id: "so_dhaka", name: "Inside Dhaka", calculated_price: { calculated_amount: rate } }]),
    addShippingMethodToCartWorkflow: workflow("shipping", async () => { cart.shipping_total = rate; cart.shipping_subtotal = rate; cart.shipping_methods = [{ shipping_option_id: "so_dhaka", name: "Inside Dhaka" }]; totals() }),
    createPaymentCollectionForCartWorkflow: workflow("collection-create", async () => { if (cart.payment_collection) throw new Error("already has collection"); cart.payment_collection = { id: "pc_1", amount: cart.total, currency_code: cart.currency_code, payment_sessions: [] }; return cart.payment_collection }),
    refreshPaymentCollectionForCartWorkflow: workflow("collection-refresh", async () => { cart.payment_collection.amount = cart.total; cart.payment_collection.currency_code = cart.currency_code }),
    createPaymentSessionsWorkflow: workflow("session", async () => {
      cart.payment_collection.payment_sessions = [{ id: "ps_1", provider_id: "pp_system_default", status: "pending" }]
      if (options.changeDuringPayment) { options.changeDuringPayment = false; cart.items[0].quantity++; totals() }
    }),
    completeCartWorkflow: workflow("complete", async () => {
      if (lateMutation) { lateMutation = false; cart.items[0].quantity++; totals() }
      if (validateHook) await validateHook({ cart })
      if (failNextComplete) { failNextComplete = false; throw new Error("temporary connection failure") }
      const order = { id: "order_one", display_id: 100, total: cart.total, currency_code: cart.currency_code }
      orders.push(order); cart.completed_at = "now"
      if (options.loseCompleteResponse) throw new Error("response lost")
      return { id: order.id }
    }),
  }
  workflows.completeCartWorkflow.hooks = { validate: (hook) => { validateHook = hook } }
  const query = { graph: async ({ entity }) => {
    if (entity === "cart") return { data: [plain(cart)] }
    if (entity === "order_cart") return { data: orders.length ? [{ order_id: orders[0].id }] : [] }
    if (entity === "order") return { data: orders }
    throw new Error(entity)
  } }
  let tail = Promise.resolve()
  const dependencies = {
    "node:crypto": require("node:crypto"), "node:buffer": require("node:buffer"), "@medusajs/framework/utils": utils,
    "@medusajs/medusa/core-flows": workflows,
    "../lib/checkout-validation": validation,
    "../lib/checkout-cart-snapshot": snapshots,
    "../modules/catalog/data/bangladesh": bd,
    "../modules/bundles/apply": { applyBundleDiscount: async () => {
      const cartSnapshot = snapshots.checkoutCartSnapshot(cart)
      cart.item_discount_total = options.discountByQuantity?.[cart.items[0].quantity] ?? options.discount ?? 0
      cart.items[0].discount_total = cart.item_discount_total
      if (options.freeShipping) cart.shipping_total = 0
      if (options.changeDuringDiscount) cart.items[0].quantity++
      totals(); return { discount: cart.item_discount_total, freeShipping: !!options.freeShipping, cartSnapshot }
    } },
  }
  const api = load("workflows/checkout-service.ts", dependencies, { process: { env: { JWT_SECRET: options.noSigningSecret ? "" : "checkout-unit-test-secret" } } })
  const hook = load("workflows/hooks/checkout-quote.ts", { "@medusajs/framework/utils": utils, "@medusajs/medusa/core-flows": workflows, "../checkout-service": api })
  const services = { query, logger: { error() {} }, locking: { execute: (_key, fn) => {
    const next = tail.then(fn); tail = next.catch(() => {}); return next
  } }, cart: { updateCarts: async (_id, patch) => Object.assign(cart, patch) } }
  const scope = { resolve: (key) => services[key] }
  return { cart, calls, orders, hook, api, rate: (value) => { rate = value }, lateMutation: () => { lateMutation = true },
    quote: () => api.runCheckout(scope, input, false),
    complete: (version, patch = {}) => api.runCheckout(scope, { ...input, quote_version: version, ...patch }, true),
  }
}

test("checkout rejects malformed public fields and normalizes Bengali mobile digits", () => {
  const valid = validation.validateCheckoutBody({ ...input, quote_version: "a".repeat(64) }, true)
  assert.deepEqual(plain(valid.errors), {})
  assert.equal(valid.fields.phone, "01712345678")
  for (const field of ["cart_id", "full_name", "phone", "district", "address", "area", "email", "note"]) {
    const result = validation.validateCheckoutBody({ ...input, [field]: { bad: true }, quote_version: "a".repeat(64) }, true)
    assert.ok(Object.keys(result.errors).length, field)
  }
  assert.ok(validation.validateCheckoutBody({ ...input, note: "a".repeat(1001) }, true).errors.note)
  assert.ok(validation.validateCheckoutBody({ ...input, district: "Fake District" }, false).errors.district)
})

test("quote uses selected shipping and real item totals without placing an order", async () => {
  const h = harness({ discount: 200, freeShipping: true })
  const result = await h.quote()
  assert.equal(result.status, 200)
  const q = result.body.quote
  assert.equal(q.subtotal, 1400)
  assert.equal(q.shipping_subtotal, 60)
  assert.equal(q.shipping_total, 0)
  assert.equal(q.discount_total, 200)
  assert.equal(q.total, 1200)
  assert.equal(q.items[0].total, 1200)
  assert.equal(q.free_shipping, true)
  assert.ok(!h.calls.includes("session"))
  assert.ok(!h.calls.includes("complete"))
  assert.equal((await h.quote()).body.quote.version, q.version)
})

test("shipping and bag changes require reviewing a fresh quote", async () => {
  const h = harness()
  const q = (await h.quote()).body.quote
  h.rate(85)
  const changed = await h.complete(q.version)
  assert.equal(changed.status, 409)
  assert.equal(changed.body.quote.total, 1485)
  assert.equal(h.orders.length, 0)
  assert.ok(!h.calls.includes("session"))
  const confirmed = await h.complete(changed.body.quote.version)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.order.total, 1485)
})

test("unavailable shipping returns a clear field error without creating payment", async () => {
  const h = harness({ unavailable: true })
  const result = await h.quote()
  assert.equal(result.status, 422)
  assert.ok(result.body.errors.district)
  assert.equal(h.orders.length, 0)
})

test("double submission is serialized and recovers exactly the same order", async () => {
  const h = harness()
  const q = (await h.quote()).body.quote
  const [a, b] = await Promise.all([h.complete(q.version), h.complete(q.version)])
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.equal(a.body.order.id, b.body.order.id)
  assert.equal(h.orders.length, 1)
  assert.equal(h.calls.filter((name) => name === "collection-create").length, 1)
})

test("a failed completion reuses and refreshes its existing payment collection", async () => {
  const h = harness({ failNextComplete: true })
  const q = (await h.quote()).body.quote
  assert.equal((await h.complete(q.version)).status, 503)
  const retry = await h.complete(q.version)
  assert.equal(retry.status, 200)
  assert.equal(h.orders.length, 1)
  assert.equal(h.calls.filter((name) => name === "collection-create").length, 1)
  assert.ok(h.calls.includes("collection-refresh"))
})

test("lost success response retrieves the order instead of creating another", async () => {
  const h = harness({ loseCompleteResponse: true })
  const q = (await h.quote()).body.quote
  assert.equal((await h.complete(q.version)).body.order.id, "order_one")
  assert.equal(h.orders.length, 1)
})

test("core completion hook rejects a late cart change under its lock", async () => {
  const h = harness()
  const q = (await h.quote()).body.quote
  h.lateMutation()
  const changed = await h.complete(q.version)
  assert.equal(changed.status, 409)
  assert.equal(changed.body.quote.items[0].quantity, 2)
  assert.equal(h.orders.length, 0)
})

test("core completion hook validates payment collection amount", async () => {
  const h = harness()
  const q = (await h.quote()).body.quote
  h.cart.metadata.checkout_quote_version = q.version
  h.cart.payment_collection = { amount: q.total - 1, currency_code: q.currency_code }
  assert.throws(() => h.hook.validateAcceptedQuote(h.cart), /CHECKOUT_QUOTE_CHANGED/)
})

test("bundle sync recognizes compound variant names and replaces stale discounts and free shipping", async () => {
  const pricing = load("modules/bundles/pricing.ts")
  const settings = { is_active: true, scope: "cases", free_shipping_threshold: 3400, matching_set_enabled: false }
  const tiers = [{ quantity: 2, discount_amount: 300, min_pct: 8, max_pct: 12, is_enabled: true }, { quantity: 3, discount_amount: 800, min_pct: 12, max_pct: 20, is_enabled: true }]
  const records = new Map(), calls = []
  const cart = { currency_code: "bdt", item_subtotal: 4200, subtotal: 4273,
    items: [{ quantity: 3, unit_price: 1400, variant_title: "Signature / iPhone 17 Pro", product: { metadata: {} } }], promotions: [{ code: "OTHER-COUPON" }],
  }
  const create = () => ({ run: async ({ input }) => {
    for (const promotion of input.promotionsData) records.set(promotion.code, { ...plain(promotion), id: `promo_${records.size}` })
  } })
  const update = () => ({ run: async ({ input }) => {
    for (const promotion of input.promotionsData) records.set(promotion.code, { ...records.get(promotion.code), ...plain(promotion) })
  } })
  const apply = load("modules/bundles/apply.ts", {
    "@medusajs/medusa/core-flows": { createPromotionsWorkflow: create, updatePromotionsWorkflow: update,
      createPromotionRulesWorkflow: () => ({ run: async ({ input }) => {
        const record = [...records.values()].find((item) => item.id === input.data.id)
        record.rules = plain(input.data.rules)
      } }),
      updateCartPromotionsWorkflow: () => ({ run: async ({ input }) => { calls.push(plain(input)); cart.promotions = input.promo_codes.map((code) => ({ code })) } }),
    },
    "@medusajs/framework/utils": utils, ".": { BUNDLES_MODULE: "bundles" },
    "./config": { getBundleConfig: async () => ({ settings, tiers }), withMatchingSetDefaults: (s) => s },
    "./pricing": pricing, "../catalog/data/devices": { DEVICES: [{ name: "iPhone 17 Pro", family: "iphone" }, { name: "AirPods Pro 3", family: "airpods" }] },
    "../../lib/checkout-cart-snapshot": snapshots,
  })
  const scope = { resolve: (key) => key === "promotion" ? { listPromotions: async ({ code }) => records.has(code) ? [records.get(code)] : [] } : {} }
  const run = () => apply.applyBundleDiscount({ scope, query: { graph: async () => ({ data: [cart] }) }, cartId: "cart_test123", logger: { error() {}, info() {} } })
  const first = await run()
  assert.equal(first.discount, 800); assert.equal(first.freeShipping, true)
  assert.equal(records.get("BUNDLE-cart_test123").application_method.value, 800)
  assert.deepEqual(records.get("BUNDLE-cart_test123").rules, [{ attribute: "id", operator: "eq", values: ["cart_test123"] }])
  delete records.get("BUNDLE-cart_test123").rules // An older pre-fix cart promotion.
  cart.items[0].quantity = 2; cart.item_subtotal = 2800; cart.subtotal = 2873
  const second = await run()
  assert.equal(second.discount, 300); assert.equal(second.freeShipping, false)
  assert.equal(records.get("BUNDLE-cart_test123").application_method.value, 300)
  assert.deepEqual(records.get("BUNDLE-cart_test123").rules, [{ attribute: "id", operator: "eq", values: ["cart_test123"] }])
  assert.deepEqual(calls.at(-1).promo_codes, ["OTHER-COUPON", "BUNDLE-cart_test123"])
  settings.is_active = false
  await run()
  assert.deepEqual(calls.at(-1).promo_codes, ["OTHER-COUPON"])
  assert.equal(calls.at(-1).action, "replace")
  settings.is_active = true
  cart.items[0].quantity = 1; cart.items[0].unit_price = 3350
  cart.item_subtotal = 3350; cart.subtotal = 3423
  assert.equal((await run()).freeShipping, false, "Delivery charges cannot qualify goods for free shipping")
})

test("completion quote remains identical for the actual Medusa complete-cart field selection", async () => {
  const h = harness({ discount: 200 })
  const q = (await h.quote()).body.quote
  // Medusa's completion query requests item.*, not top-level item_discount_total.
  delete h.cart.item_discount_total
  h.cart.metadata.checkout_quote_version = q.version
  h.cart.payment_collection = { amount: q.total, currency_code: q.currency_code }
  assert.doesNotThrow(() => h.hook.validateAcceptedQuote(h.cart))
})

test("checkout migration preflight is read-only and application names exactly one migration", async () => {
  const migration = "Migration20260920194733"
  const updates = [], logs = []
  let recorded = false, tableExists = false, historyExists = true, connections = 0
  const columns = ["id", "heading", "description", "delivery_note", "support_phone", "support_label", "show_order_note", "created_at", "updated_at", "deleted_at"]
  const helper = {
    getAllColumns: async (_conn, tables) => {
      assert.deepEqual(plain(tables.get("public")).map((table) => table.table_name), ["mikro_orm_migrations", "checkout_setting"])
      return { "public.mikro_orm_migrations": historyExists ? [{ name: "name" }] : [],
        "public.checkout_setting": tableExists ? columns.map((name) => ({ name, type: "text", nullable: false })) : [] }
    },
    getAllIndexes: async (_conn, tables) => { assert.equal(tables[0].table_name, "checkout_setting"); return { "public.checkout_setting": [{ keyName: "IDX_checkout_setting_deleted_at" }] } },
  }
  const orm = { em: { getConnection: () => ({}), getDriver: () => ({ getPlatform: () => ({ getSchemaHelper: () => helper }) }) },
    getMigrator: () => ({ getExecutedMigrations: async () => { assert.ok(historyExists); return recorded ? [{ name: migration }] : [] },
      up: async (options) => { updates.push(plain(options)); recorded = true; tableExists = true; historyExists = true },
    }), close: async () => {},
  }
  const api = load("scripts/migrate-checkout-settings.ts", { "node:path": require("node:path"), "@medusajs/framework/utils": {
    ...utils, ContainerRegistrationKeys: { ...utils.ContainerRegistrationKeys, CONFIG_MODULE: "config", PG_CONNECTION: "pg" },
    ModulesSdkUtils: { loadDatabaseConfig: (_module, config) => config.database },
    mikroOrmCreateConnection: async (config) => { assert.ok(config.pool.max >= 2, "migration transaction and SET LOCAL need separate connections"); connections++; return orm },
  } }, { __dirname: path.join(__dirname, "../src/scripts"), URL })
  const services = { config: { projectConfig: { databaseUrl: "postgres://test:test@localhost/florayn_checkout_test_ci" } },
    pg: { client: { config: { connection: { ssl: false } } } }, logger: { info: (message) => logs.push(message) },
    locking: { execute: async (_key, fn) => fn() },
  }
  const container = { resolve: (key) => services[key] }
  await api.default({ container, args: [] })
  assert.equal(updates.length, 0)
  assert.match(logs[0], /CHECKOUT_MIGRATION_PREFLIGHT/)
  historyExists = false
  await api.default({ container, args: [] })
  assert.equal(updates.length, 0, "preflight must not initialize a missing migration history table")
  historyExists = true
  await api.default({ container, args: ["apply", migration] })
  assert.deepEqual(updates, [{ migrations: [migration] }])
  await api.default({ container, args: ["apply", migration] })
  assert.equal(updates.length, 1, "already recorded migration must not run twice")
  const priorConnections = connections
  await assert.rejects(api.default({ container, args: ["apply", "SomeOtherMigration"] }))
  services.config.projectConfig.databaseUrl = "postgres://test:test@localhost/unrelated_database"
  await assert.rejects(api.default({ container, args: ["apply", migration] }))
  assert.equal(connections, priorConnections, "invalid arguments or database must fail before any connection")
})

test("core completion rejects unsigned and forged cart metadata even through the standard Store flow", async () => {
  const h = harness()
  const quote = (await h.quote()).body.quote
  h.cart.payment_collection = { amount: quote.total, currency_code: quote.currency_code }
  assert.throws(() => h.hook.validateAcceptedQuote(h.cart), /CHECKOUT_QUOTE_REQUIRED/)
  h.cart.metadata.checkout_quote_version = "a".repeat(64)
  assert.throws(() => h.hook.validateAcceptedQuote(h.cart), /CHECKOUT_QUOTE_CHANGED/)
  h.cart.metadata.checkout_quote_version = quote.version
  assert.doesNotThrow(() => h.hook.validateAcceptedQuote(h.cart))
  h.cart.items[0].quantity = 2
  assert.throws(() => h.hook.validateAcceptedQuote(h.cart), /CHECKOUT_QUOTE_CHANGED/)
})

test("quote signing fails closed when the backend secret is missing", async () => {
  const h = harness({ noSigningSecret: true })
  const quote = await h.quote()
  assert.equal(quote.status, 503)
  assert.ok(quote.body.errors.form)
  assert.equal(h.orders.length, 0)
  assert.equal(h.api.quoteVersionsMatch("bad", "a".repeat(64)), false)
})

test("a standard cart mutation during discount application cannot receive a signed stale quote", async () => {
  const h = harness({ discount: 200, changeDuringDiscount: true })
  const response = await h.quote()
  assert.equal(response.status, 409)
  assert.match(response.body.errors.form, /bag changed/i)
  assert.equal(response.body.quote, undefined)
  assert.equal(h.orders.length, 0)
  assert.ok(!h.calls.includes("session"))
})

test("a payment-time cart mutation reprices bundle discounts before returning a replacement signature", async () => {
  const h = harness({ discountByQuantity: { 1: 200, 2: 300 }, changeDuringPayment: true })
  const quote = (await h.quote()).body.quote
  const response = await h.complete(quote.version)
  assert.equal(response.status, 409)
  assert.equal(response.body.quote.items[0].quantity, 2)
  assert.equal(response.body.quote.discount_total, 300)
  assert.equal(response.body.quote.total, 2560)
  assert.equal(h.orders.length, 0)
  assert.ok(!h.calls.includes("complete"))
  assert.equal((await h.quote()).body.quote.version, response.body.quote.version)
})

test("isolated bypass assertions match serialized workflow messages and reject unrelated failures", () => {
  const { isExpectedWorkflowFailure: matches } = load("scripts/verify-checkout-isolated.ts", {
    "node:assert/strict": require("node:assert/strict"), "@medusajs/framework/utils": utils,
    "@medusajs/medusa/core-flows": {}, "../workflows/checkout": {}, "../workflows/order-summary": {},
  })
  const expected = "CHECKOUT_QUOTE_REQUIRED"
  assert.equal(matches(new Error(expected), expected), true)
  assert.equal(matches({ message: expected, type: "invalid_data" }, expected), true)
  assert.equal(matches({ errors: [{ error: { message: expected } }] }, expected), true)
  assert.equal(matches({ cause: { message: expected } }, expected), true)
  assert.equal(matches({ message: "database unavailable" }, expected), false)
  assert.equal(matches({ message: "CHECKOUT_QUOTE_CHANGED" }, expected), false)
  const cyclic = {}; cyclic.cause = cyclic
  assert.equal(matches(cyclic, expected), false)
})

test("completion replaces public image metadata with a compact selected-variant snapshot", async () => {
  const h = harness()
  h.cart.metadata.checkout_item_images = { variant_a: "https://untrusted.invalid/wrong.webp", other: "not ordered" }
  h.cart.items[0].thumbnail = "https://example.invalid/generic.webp"
  h.cart.items[0].variant = { metadata: { images: ["https://example.invalid/selected.webp"], private: "omit" } }
  const q = (await h.quote()).body.quote
  assert.equal((await h.complete(q.version)).status, 200)
  assert.deepEqual(plain(h.cart.metadata.checkout_item_images), { variant_a: "https://example.invalid/selected.webp" })
  assert.equal((await h.complete(q.version)).body.order.id, "order_one")
  assert.equal(h.orders.length, 1)
})
