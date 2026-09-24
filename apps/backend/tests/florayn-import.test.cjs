const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
const UTILS = {
  Modules: { STORE: "store", PRODUCT: "product", REGION: "region", ORDER: "order", CUSTOMER: "customer" },
  ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query", PG_CONNECTION: "pg" },
}

function loader(globals = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, Buffer, URL, AbortSignal, process: { env: {} }, ...globals,
      require(name) {
        if (name === "@medusajs/framework/utils") return UTILS
        if (name === "../modules/order-ops") return { ORDER_OPS_MODULE: "order_ops" }
        if (name.startsWith(".")) {
          const base = path.resolve(path.dirname(file), name)
          if (fs.existsSync(`${base}.ts`)) return load(`${base}.ts`)
        }
        throw new Error(`Unexpected dependency ${name} in ${path.basename(file)}`)
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  return (relative) => load(path.join(__dirname, "../src", relative))
}

const WC_ORDER = {
  id: 1055357, number: "1055357", status: "completed",
  date_created_gmt: "2026-09-18T04:50:46", date_modified_gmt: "2026-09-22T06:12:05", date_completed_gmt: "2026-09-21T09:00:00", date_paid_gmt: null,
  total: "2665.00", shipping_total: "120.00", discount_total: "255.00", customer_note: "Call <b>before</b> delivery", payment_method: "cod", payment_method_title: "Cash on delivery",
  billing: { first_name: "Ayesha", last_name: "Khan", address_1: "House 4, Road 2", city: "Mirpur", state: "BD-13", email: "", phone: "+880 1712-345678" },
  shipping: { first_name: "", last_name: "", address_1: "", city: "", state: "" },
  line_items: [
    { id: 1, name: "Moon Drift - iPhone 17 Pro Max Case", product_id: 501, variation_id: 0, quantity: 2, subtotal: "2800", total: "2545", sku: "",
      meta_data: [{ key: "pa_device", value: "iphone-17-pro-max", display_key: "Device", display_value: "iPhone 17 Pro Max" }, { key: "_reduced_stock", value: "2" }], image: { src: "https://florayn.com/wp-content/uploads/moon.jpg" } },
  ],
  shipping_lines: [{ method_title: "Inside Dhaka", total: "120.00" }],
  fee_lines: [{ id: 9, name: "bKash discount", total: "-50.00" }, { id: 10, name: "Gift wrap", total: "50.00" }],
  coupon_lines: [{ code: "EID10", discount: "255" }],
}

test("florayn.com statuses land on the right tab; drafts are not imported", () => {
  const { mapWcStatus } = loader()("lib/florayn-import.ts")
  const cases = {
    completed: ["delivered", "completed"], "otm-delivered": ["delivered", "completed"], processing: ["processing", "pending"],
    "otm-confirmed": ["confirmed", "pending"], "otm-in-transit": ["shipped", "pending"], "otm-returned": ["returned", "canceled"],
    refunded: ["refunded", "canceled"], cancelled: ["cancelled", "canceled"], "wc-completed": ["delivered", "completed"],
  }
  for (const [wc, [workflow, order]] of Object.entries(cases)) assert.deepEqual(plain(mapWcStatus(wc)), { workflow, order }, wc)
  for (const draft of ["checkout-draft", "auto-draft", "trash", "", "made-up"]) assert.equal(mapWcStatus(draft), null, draft)
})

test("an order keeps what the customer paid: line prices after coupons, delivery, fees, and its florayn.com number", () => {
  const { mapWcOrder, districtName, parseWcDate } = loader()("lib/florayn-import.ts")
  const products = new Map([[501, { id: "prod_moon", handle: "moon-drift-iphone-17-pro-max", title: "Moon Drift", thumbnail: "https://r2/moon.webp" }]])
  const m = mapWcOrder(WC_ORDER, { regionId: "reg_bd", salesChannelId: "sc_1", customerId: "cus_1", products })
  assert.deepEqual(plain(m.status), { workflow: "delivered", order: "completed" })
  assert.equal(m.input.email, "01712345678@no-email.florayn.local", "a phone-only order uses checkout's placeholder, so it joins that phone's customer")
  assert.equal(m.contact.email, null)
  assert.equal(m.contact.phone, "01712345678")
  assert.deepEqual(plain(m.input.shipping_address), { first_name: "Ayesha", last_name: "Khan", phone: "01712345678", address_1: "House 4, Road 2", address_2: "", city: "Mirpur", province: "Dhaka", postal_code: "", country_code: "bd" }, "the empty shipping block falls back to billing")
  const [line, fee] = m.input.items
  assert.equal(line.quantity, 2)
  assert.equal(line.unit_price, 1272.5, "the price paid per case, after the coupon")
  assert.equal(line.product_id, "prod_moon")
  assert.equal(line.thumbnail, "https://r2/moon.webp", "our own image, not florayn.com's")
  assert.equal(line.variant_title, "iPhone 17 Pro Max")
  assert.deepEqual(plain(line.metadata.options), [{ name: "Device", value: "iPhone 17 Pro Max" }], "hidden _ keys are dropped")
  assert.equal(fee.title, "Gift wrap")
  assert.deepEqual(plain(m.input.credit_lines), [{ amount: 50, reference: "florayn.com discount", reference_id: "9", metadata: { name: "bKash discount" } }])
  assert.deepEqual(plain(m.input.shipping_methods), [{ name: "Inside Dhaka", amount: 120, data: {} }])
  assert.deepEqual(plain(m.totals), { computed: 2665, wc: 2665, matches: true })
  assert.equal(m.input.metadata.source, "florayn.com")
  assert.equal(m.input.metadata.wc_order_number, "1055357")
  assert.equal(m.input.metadata.order_note, "Call before delivery")
  assert.deepEqual(plain(m.input.metadata.coupon_codes), ["EID10"])
  assert.equal(m.input.no_notification, true)
  assert.equal(m.createdAt.toISOString(), "2026-09-18T04:50:46.000Z")
  assert.equal(m.statusChangedAt.toISOString(), "2026-09-21T09:00:00.000Z")

  const unmatched = mapWcOrder({ ...WC_ORDER, total: "9999" }, { regionId: "r", customerId: "c", products: new Map() })
  assert.equal(unmatched.input.items[0].product_id, undefined)
  assert.equal(unmatched.input.items[0].thumbnail, "https://florayn.com/wp-content/uploads/moon.jpg")
  assert.equal(unmatched.totals.matches, false)
  assert.ok(unmatched.input.metadata.total_mismatch)
  const withEmail = mapWcOrder({ ...WC_ORDER, billing: { ...WC_ORDER.billing, email: "Ayesha@Example.com" } }, { regionId: "r", customerId: "c", products: new Map() })
  assert.equal(withEmail.input.email, "ayesha@example.com")
  assert.equal(districtName("Sylhet"), "Sylhet")
  assert.equal(districtName("BD-60"), "Sylhet")
  assert.equal(parseWcDate("2026-01-02T03:04:05").toISOString(), "2026-01-02T03:04:05.000Z")
  assert.equal(parseWcDate(null), null)
})

test("the WooCommerce key goes in the header, falls back to the query on hosts that strip it, and only over https", async () => {
  const calls = []
  let first = true
  const fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization })
    if (first) { first = false; return { ok: false, status: 401, headers: new Map(), json: async () => ({ message: "Sorry, you cannot list resources." }) } }
    return { ok: true, status: 200, headers: new Map([["x-wp-total", "1100"], ["x-wp-totalpages", "22"]]), json: async () => [] }
  }
  const { wcGet } = loader()("lib/florayn-import.ts")
  const key = { site_url: "https://florayn.com/", consumer_key: "ck_abc", consumer_secret: "cs_def" }
  const result = await wcGet(key, "orders", { per_page: 50, page: 1 }, fetch)
  assert.equal(result.total, 1100)
  assert.match(calls[0].url, /^https:\/\/florayn\.com\/wp-json\/wc\/v3\/orders\?per_page=50&page=1$/)
  assert.equal(calls[0].auth, `Basic ${Buffer.from("ck_abc:cs_def").toString("base64")}`)
  assert.match(calls[1].url, /consumer_key=ck_abc&consumer_secret=cs_def/)
  await assert.rejects(wcGet({ ...key, site_url: "http://florayn.com" }, "orders", {}, fetch), /https/)
  const refuse = async () => ({ ok: false, status: 401, headers: new Map(), json: async () => ({ message: "Invalid signature" }) })
  await assert.rejects(wcGet(key, "orders", {}, refuse), /refused the key \(Invalid signature\)/)
})

function importHarness(pages) {
  const db = { imports: [{ id: "oimp_1", site_url: "https://florayn.com", consumer_key: "ck_x", consumer_secret: "cs_y", state: "idle" }], imported: [], ops: [], orders: [], customers: [{ id: "cus_account", email: "known@example.com", has_account: true }], dates: [] }
  const svc = {
    listOrderImports: async () => db.imports,
    createOrderImports: async (row) => row,
    updateOrderImports: async (patch) => Object.assign(db.imports[0], plain(patch)),
    listImportedOrders: async ({ source_id }) => db.imported.filter((r) => source_id.includes(r.source_id)),
    createImportedOrders: async (row) => { db.imported.push({ id: `impo_${db.imported.length}`, ...row }) },
    updateImportedOrders: async (patch) => Object.assign(db.imported.find((r) => r.id === patch.id), patch),
    listOrderOps: async ({ order_id }) => db.ops.filter((o) => o.order_id === order_id),
    updateOrderOps: async (patch) => Object.assign(db.ops.find((o) => o.id === patch.id), patch),
    createOrderOps: async (row) => { const op = { id: `oop_${db.ops.length}`, ...row }; db.ops.push(op); return op },
  }
  const services = {
    logger: { info() {}, warn() {}, error() {} },
    order_ops: svc,
    region: { listRegions: async () => [{ id: "reg_bd" }] },
    store: { listStores: async () => [{ id: "s", default_sales_channel_id: "sc_1" }] },
    product: { listProducts: async () => [] },
    customer: {
      listCustomers: async ({ email }) => db.customers.filter((c) => c.email === email),
      createCustomers: async (row) => { const c = { id: `cus_${db.customers.length}`, ...row }; db.customers.push(c); return c },
    },
    order: {
      createOrders: async (input) => { const o = { id: `order_${db.orders.length}`, ...plain(input) }; db.orders.push(o); return o },
      listOrders: async ({ id }) => db.orders.filter((o) => o.id === id),
      updateOrders: async (id, patch) => Object.assign(db.orders.find((o) => o.id === id), plain(patch)),
    },
    pg: (table) => ({ where: ({ id }) => ({ update: async (values) => { db.dates.push({ table, id, ...plain(values) }) } }) }),
  }
  const fetch = async (url) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith("/products")) return { ok: true, status: 200, headers: new Map(), json: async () => [] }
    const page = Number(u.searchParams.get("page"))
    const body = pages()[page - 1] ?? []
    return { ok: true, status: 200, headers: new Map([["x-wp-total", String(pages().flat().length)]]), json: async () => body }
  }
  const { runFloraynImport } = loader({ fetch })("lib/florayn-import.ts")
  return { run: () => runFloraynImport({ resolve: (key) => services[key] }, fetch), db }
}

test("the import creates each order once on its customer, marks it as florayn.com's, and a second run only moves changed statuses", async () => {
  let orders = [
    { ...WC_ORDER, id: 1, number: "1" },
    { ...WC_ORDER, id: 2, number: "2", status: "otm-in-transit", billing: { ...WC_ORDER.billing, email: "known@example.com" } },
    { ...WC_ORDER, id: 3, number: "3", status: "checkout-draft" },
    { ...WC_ORDER, id: 4, number: "4", billing: { ...WC_ORDER.billing, phone: "01712345678" } },
  ]
  const h = importHarness(() => [orders])
  const first = await h.run()
  assert.equal(first.created, 3)
  assert.equal(first.skipped, 1, "the checkout draft")
  assert.equal(first.failed, 0)
  assert.equal(h.db.orders.length, 3)
  assert.equal(h.db.orders[0].customer_id, h.db.orders[2].customer_id, "one customer per phone number")
  assert.equal(h.db.orders[1].customer_id, "cus_account", "an existing account keeps its history")
  assert.ok(h.db.ops.every((op) => op.source === "florayn.com"))
  assert.equal(h.db.ops[1].workflow_status, "shipped")
  assert.ok(h.db.dates.some((d) => d.table === "order" && d.created_at === "2026-09-18T04:50:46.000Z"), "the order keeps its florayn.com date")
  assert.equal(h.db.imports[0].state, "done")

  orders = orders.map((o) => (o.id === 2 ? { ...o, status: "completed", date_modified_gmt: "2026-09-25T10:00:00" } : o))
  const second = await h.run()
  assert.equal(second.created, 0)
  assert.equal(second.updated, 1)
  assert.equal(second.unchanged, 2)
  assert.equal(h.db.orders.length, 3, "nothing duplicated")
  assert.equal(h.db.ops[1].workflow_status, "delivered")
  assert.equal(h.db.orders[1].status, "completed")
  assert.equal(h.db.orders[1].metadata.wc_status, "completed")
})

test("an imported order is never asked for a review automatically", () => {
  const load = (relative) => {
    const file = path.join(__dirname, "../src", relative)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { exports: module.exports, module, require: () => new Proxy({}, { get: () => () => ({}) }), process: { env: {} } })
    return module.exports
  }
  const { isDue } = load("lib/review-requests.ts")
  const settings = { requests: { enabled: true, delay_days: 0, statuses: ["delivered"], batch: 40, max_age_days: 120, started_at: null } }
  const op = { workflow_status: "delivered", status_changed_at: new Date(Date.now() - 86_400_000).toISOString() }
  assert.equal(isDue(op, settings), true)
  assert.equal(isDue({ ...op, source: "florayn.com" }, settings), false)
})
