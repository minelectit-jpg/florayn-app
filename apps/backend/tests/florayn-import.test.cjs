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

// This store's catalogue as Query returns it: a design with two case types, its
// AirPods product, and StickPad Pro with colours.
const PRODUCTS = [
  { id: "prod_moon", handle: "moon-drift", title: "Moon Drift", thumbnail: "https://r2/moon.webp", metadata: { design_name: "Moon Drift", form: "phone" }, variants: [
    { id: "var_moon_sig_17pm", metadata: { images: ["https://r2/moon-sig-17pm.webp"] }, options: [{ value: "Signature", option: { title: "Case Type" } }, { value: "iPhone 17 Pro Max", option: { title: "Device" } }] },
    { id: "var_moon_arm_17pm", metadata: { images: ["https://r2/moon-arm-17pm.webp"] }, options: [{ value: "Armor Black", option: { title: "Case Type" } }, { value: "iPhone 17 Pro Max", option: { title: "Device" } }] },
    { id: "var_moon_sig_s25u", metadata: { images: ["https://r2/moon-s25u.webp"] }, options: [{ value: "Signature", option: { title: "Case Type" } }, { value: "Samsung S25 Ultra", option: { title: "Device" } }] },
  ] },
  { id: "prod_moon_air", handle: "moon-drift-airpods", title: "Moon Drift - AirPods Case", thumbnail: "https://r2/moon-air.webp", metadata: { design_name: "Moon Drift", form: "airpods" }, variants: [
    { id: "var_moon_air_pro3", metadata: {}, options: [{ value: "Signature Earbuds", option: { title: "Case Type" } }, { value: "AirPods Pro 3", option: { title: "Device" } }] },
  ] },
  { id: "prod_stickpad", handle: "stickpad-pro", title: "StickPad Pro", thumbnail: "https://r2/stickpad.webp", metadata: { design_name: "StickPad Pro" }, variants: [
    { id: "var_stickpad_black", metadata: { images: ["https://r2/stickpad-black.webp"] }, options: [{ value: "Black", option: { title: "Color" } }] },
    { id: "var_stickpad_pink", metadata: {}, options: [{ value: "Pink", option: { title: "Color" } }] },
  ] },
  { id: "prod_charm", handle: "phone-charm", title: "Leather Chain Phone Charm", thumbnail: "https://r2/charm.webp", metadata: { design_name: "Leather Chain Phone Charm" }, variants: [
    { id: "var_charm_beige", metadata: {}, options: [{ value: "Beige", option: { title: "Color" } }] },
  ] },
]

test("florayn.com line names find this store's product, model and colour", () => {
  const { buildCatalog, matchLine, splitLineTitle } = loader()("lib/florayn-import-match.ts")
  const catalog = buildCatalog(PRODUCTS)
  const m = (title) => { const hit = matchLine(title, catalog); return hit && { product: hit.product.id, variant: hit.variant?.id ?? null, device: hit.device, image: hit.image } }
  assert.deepEqual(plain(splitLineTitle("Lime Sorbet - iPhone 16 Pro Max Case")), ["Lime Sorbet", "iPhone 16 Pro Max"])
  assert.deepEqual(plain(splitLineTitle("Blue Bloom –Samsung S23 Case")), ["Blue Bloom", "Samsung S23"])
  assert.deepEqual(plain(splitLineTitle("Ant-Man")), ["Ant-Man", ""], "a hyphen inside a name does not split")
  assert.deepEqual(m("Moon Drift - iPhone 17 Pro Max Case"), { product: "prod_moon", variant: null, device: "iPhone 17 Pro Max", image: "https://r2/moon-sig-17pm.webp" }, "two case types for that model: no variant guessed, Signature's picture")
  assert.deepEqual(m("Moon Drift – Samsung Galaxy S25 ULTRA Case"), { product: "prod_moon", variant: "var_moon_sig_s25u", device: "Samsung S25 Ultra", image: "https://r2/moon-s25u.webp" }, "Galaxy and capitals do not matter; one case type = the variant")
  assert.deepEqual(m("Moon Drift - AirPods Pro 3 Case"), { product: "prod_moon_air", variant: "var_moon_air_pro3", device: "AirPods Pro 3", image: "https://r2/moon-air.webp" }, "an AirPods model goes to the AirPods product")
  assert.deepEqual(m("Black - StickPad Pro"), { product: "prod_stickpad", variant: "var_stickpad_black", device: null, image: "https://r2/stickpad-black.webp" }, "colour first, accessory second")
  assert.deepEqual(m("Beige Leather Chain Phone Charm"), { product: "prod_charm", variant: "var_charm_beige", device: null, image: "https://r2/charm.webp" }, "no dash")
  assert.equal(m("Lavender Leather Chain Phone Charm").product, "prod_charm", "a colour no longer sold still links the product")
  assert.equal(m("Linea Mint – iPhone 16 Pro Max Case"), null, "a design this store does not sell stays unlinked")
})

const FULL = { ...WC_ORDER, meta_data: [] }
const lines = (...totals) => totals.map((t, i) => ({ id: i + 1, name: "Moon Drift - iPhone 17 Pro Max Case", product_id: 501, quantity: 1, subtotal: String(t), total: String(t) }))
const order = (lineTotals, shipping, total, meta = {}) => ({ ...FULL, fee_lines: [], coupon_lines: [], line_items: lines(...lineTotals), shipping_lines: [{ method_title: "Dhaka Shipping Cost", total: String(shipping) }], total: String(total), meta_data: Object.entries(meta).map(([key, value]) => ({ key, value })) })

test("an imported order's total is what the customer paid: the courier COD plus any bKash advance", () => {
  const { paidAmounts } = loader()("lib/florayn-import.ts")
  const paid = (wc, linesTotal) => plain(paidAmounts(wc, linesTotal))
  // The five shapes florayn.com's order manager left (real orders, 2026-09-25).
  assert.deepEqual(paid(order([1400], 60, 0, { _otm_advance_paid_amount: "1460", _otm_courier_cod_amount: "0" }), 1460), { paid: 1460, advance: 1460, cod: 0 }, "fully paid in advance: WooCommerce total 0")
  assert.deepEqual(paid(order([750, 750], 60, 60, { _florayn_qo_advance: "1500", _otm_courier_cod_amount: "60" }), 1560), { paid: 1560, advance: 1500, cod: 60 }, "advance, delivery collected")
  assert.deepEqual(paid(order([1400], 300, 1950, { _otm_advance_paid_amount: "1950", _otm_courier_cod_amount: "0" }), 1700), { paid: 1950, advance: 1950, cod: 0 }, "total left in place, all paid ahead")
  assert.deepEqual(paid(order([1400, 750], 115, 2000, { _otm_courier_cod_amount: "2000" }), 2265), { paid: 2000, advance: 0, cod: 2000 }, "a bundle price set by hand")
  assert.deepEqual(paid(order([1400], 60, 1515, { _otm_courier_cod_amount: "1515" }), 1460), { paid: 1515, advance: 0, cod: 1515 }, "delivery re-priced by hand")
  // No courier booking (not sent yet): the total, plus the advance only when the total is the remainder.
  assert.deepEqual(paid(order([1400], 60, 60, { _florayn_qo_advance: "1400" }), 1460), { paid: 1460, advance: 1400, cod: 60 })
  assert.deepEqual(paid(order([1400], 60, 1460, { _otm_advance_paid_amount: "200" }), 1460), { paid: 1460, advance: 200, cod: 1260 })
  assert.deepEqual(paid(order([1400], 60, 1460), 1460), { paid: 1460, advance: 0, cod: 1460 })
})

test("an order keeps its items, delivery and number, links its products, and adjusts to what was paid", () => {
  const load = loader()
  const { mapWcOrder, districtName, parseWcDate, ADJUSTMENT_TITLE } = load("lib/florayn-import.ts")
  const { buildCatalog, matchLine } = load("lib/florayn-import-match.ts")
  const catalog = buildCatalog(PRODUCTS)
  const match = (title) => matchLine(title, catalog)
  const m = mapWcOrder(WC_ORDER, { regionId: "reg_bd", salesChannelId: "sc_1", customerId: "cus_1", match })
  assert.deepEqual(plain(m.status), { workflow: "delivered", order: "completed" })
  assert.equal(m.input.email, "01712345678@no-email.florayn.local", "a phone-only order uses checkout's placeholder, so it joins that phone's customer")
  assert.equal(m.contact.phone, "01712345678")
  assert.deepEqual(plain(m.input.shipping_address), { first_name: "Ayesha", last_name: "Khan", phone: "01712345678", address_1: "House 4, Road 2", address_2: "", city: "Mirpur", province: "Dhaka", postal_code: "", country_code: "bd" }, "the empty shipping block falls back to billing")
  const [line, fee] = m.input.items
  assert.equal(line.quantity, 2)
  assert.equal(line.unit_price, 1272.5, "the price paid per case, after the coupon")
  assert.equal(line.product_id, "prod_moon")
  assert.equal(line.product_handle, "moon-drift")
  assert.equal(line.variant_id, undefined, "two case types for that model: none guessed")
  assert.equal(line.thumbnail, "https://r2/moon-sig-17pm.webp", "our own image, not florayn.com's")
  assert.equal(line.metadata.device, "iPhone 17 Pro Max")
  assert.equal(line.variant_title, "iPhone 17 Pro Max")
  assert.equal(fee.title, "Gift wrap")
  assert.deepEqual(plain(m.input.credit_lines), [{ amount: 50, reference: "florayn.com discount", reference_id: "9", metadata: { name: "bKash discount" } }])
  assert.deepEqual(plain(m.input.shipping_methods), [{ name: "Inside Dhaka", amount: 120, data: {} }])
  assert.equal(m.totals.paid, 2665)
  assert.equal(m.totals.adjusted, false)
  assert.deepEqual(plain(m.linked), { lines: 1, matched: 1 })
  assert.equal(m.input.metadata.wc_order_number, "1055357")
  assert.equal(m.input.metadata.import_version, 2)
  assert.equal(m.input.metadata.order_note, "Call before delivery")
  assert.equal(m.input.no_notification, true)
  assert.equal(m.createdAt.toISOString(), "2026-09-18T04:50:46.000Z")
  assert.equal(m.statusChangedAt.toISOString(), "2026-09-21T09:00:00.000Z")

  // florayn.com #1054491: a bundle price set by hand, 265 under the items + delivery.
  const bundle = mapWcOrder(order([1400, 750], 115, 2000, { _otm_courier_cod_amount: "2000", _otm_courier_tracking_code: "SFR1", _otm_courier_consignment_id: "288559475" }), { regionId: "r", customerId: "c", match })
  assert.deepEqual(plain(bundle.input.credit_lines), [{ amount: 265, reference: ADJUSTMENT_TITLE, reference_id: "1055357", metadata: { lines_total: 2265, paid: 2000 } }])
  assert.equal(bundle.totals.total, 2000, "the order now totals what was paid")
  assert.deepEqual(plain(bundle.input.metadata.total_adjusted), { lines: 2265, paid: 2000 })
  assert.equal(bundle.input.metadata.tracking_code, "SFR1")
  assert.equal(bundle.input.metadata.consignment_id, "288559475")
  // florayn.com #1052732: 250 more than the items + delivery, all paid by bKash ahead.
  const extra = mapWcOrder(order([1400], 300, 1950, { _otm_advance_paid_amount: "1950", _otm_courier_cod_amount: "0" }), { regionId: "r", customerId: "c", match })
  const added = extra.input.items.at(-1)
  assert.equal(added.title, ADJUSTMENT_TITLE)
  assert.equal(added.unit_price, 250)
  assert.equal(extra.totals.total, 1950)
  assert.equal(extra.input.metadata.advance_paid, 1950)
  assert.equal(extra.input.metadata.cod_amount, 0)
  assert.equal(extra.input.metadata.payment_method, "Paid in advance (bKash)")
  // florayn.com #1053614: WooCommerce says 0, the customer paid 1460 ahead: no adjustment at all.
  const ahead = mapWcOrder(order([1400], 60, 0, { _otm_advance_paid_amount: "1460", _otm_courier_cod_amount: "0" }), { regionId: "r", customerId: "c", match })
  assert.equal(ahead.totals.adjusted, false)
  assert.equal(ahead.totals.total, 1460)
  assert.equal(ahead.input.credit_lines, undefined)

  const rebuilt = mapWcOrder(WC_ORDER, { regionId: "r", customerId: "c", match, displayId: 469 })
  assert.equal(rebuilt.input.display_id, 469, "a rebuild keeps the order number")
  const unlinked = mapWcOrder({ ...WC_ORDER, line_items: [{ ...WC_ORDER.line_items[0], name: "Linea Mint - iPhone 16 Case" }] }, { regionId: "r", customerId: "c", match })
  assert.equal(unlinked.input.items[0].product_id, undefined)
  assert.equal(unlinked.input.items[0].thumbnail, "https://florayn.com/wp-content/uploads/moon.jpg")
  assert.equal(districtName("BD-60"), "Sylhet")
  assert.equal(districtName("Sylhet"), "Sylhet")
  assert.equal(parseWcDate("2026-01-02T03:04:05").toISOString(), "2026-01-02T03:04:05.000Z")
  assert.equal(parseWcDate(null), null)
})

test("an order's item opens the product it was bought from, with its model picked", () => {
  const load = (relative) => {
    const file = path.join(__dirname, "../src", relative)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { exports: module.exports, module, require: (name) => (name === "../modules/order-ops" ? { ORDER_OPS_MODULE: "order_ops" } : UTILS) })
    return module.exports
  }
  const { itemProductUrl } = load("lib/order-ops.ts")
  const shop = "https://new.florayn.com"
  assert.equal(itemProductUrl({ product_handle: "grape-goo", variant_id: "variant_01ABC" }, shop), "https://new.florayn.com/product/grape-goo/?variant=variant_01ABC")
  assert.equal(itemProductUrl({ product_handle: "moon-drift", metadata: { device: "iPhone 17 Pro Max" } }, shop), "https://new.florayn.com/product/moon-drift/?device=iPhone%2017%20Pro%20Max")
  assert.equal(itemProductUrl({ product_handle: "moon-drift" }, shop), "https://new.florayn.com/product/moon-drift/")
  assert.equal(itemProductUrl({ title: "Linea Mint" }, shop), null)
  assert.equal(itemProductUrl({ product_handle: "x", metadata: { wc_adjustment: true } }, shop), null)
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

function importHarness(pages, seed = {}) {
  const db = {
    imports: [{ id: "oimp_1", site_url: "https://florayn.com", consumer_key: "ck_x", consumer_secret: "cs_y", state: "idle" }],
    imported: seed.imported ?? [], ops: seed.ops ?? [], orders: seed.orders ?? [], deleted: [],
    customers: [{ id: "cus_account", email: "known@example.com", has_account: true }], dates: [], raw: [],
  }
  let nextOrder = db.orders.length
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
    query: { graph: async () => ({ data: PRODUCTS }) },
    customer: {
      listCustomers: async ({ email }) => db.customers.filter((c) => c.email === email),
      createCustomers: async (row) => { const c = { id: `cus_${db.customers.length}`, ...row }; db.customers.push(c); return c },
    },
    order: {
      createOrders: async (input) => { const o = { id: `order_new${nextOrder++}`, display_id: 5000 + nextOrder, ...plain(input) }; db.orders.push(o); return o },
      listOrders: async ({ id }) => db.orders.filter((o) => (Array.isArray(id) ? id.includes(o.id) : o.id === id)),
      updateOrders: async (id, patch) => Object.assign(db.orders.find((o) => o.id === id), plain(patch)),
      deleteOrders: async (ids) => { db.deleted.push(...ids); db.orders = db.orders.filter((o) => !ids.includes(o.id)) },
    },
    pg: Object.assign((table) => ({ where: ({ id }) => ({ update: async (values) => {
      db.dates.push({ table, id, ...plain(values) })
      const row = table === "order" ? db.orders.find((o) => o.id === id) : null
      if (row && values.display_id) row.display_id = values.display_id
    } }) }), { raw: async (sql) => { db.raw.push(sql) } }),
  }
  const fetch = async (url) => {
    const u = new URL(String(url))
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
  assert.equal(first.linked, 3, "every Moon Drift line linked")
  assert.equal(h.db.orders.length, 3)
  assert.equal(h.db.orders[0].customer_id, h.db.orders[2].customer_id, "one customer per phone number")
  assert.equal(h.db.orders[1].customer_id, "cus_account", "an existing account keeps its history")
  assert.ok(h.db.ops.every((op) => op.source === "florayn.com"))
  assert.equal(h.db.ops[1].workflow_status, "shipped")
  assert.ok(h.db.dates.some((d) => d.table === "order" && d.created_at === "2026-09-18T04:50:46.000Z"), "the order keeps its florayn.com date")
  assert.equal(h.db.imports[0].state, "done")
  assert.equal(h.db.raw.length, 0, "nothing rebuilt, the order number sequence is left alone")

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

test("an order imported by the first version is rebuilt under its own number, keeping its workflow row", async () => {
  const wc = order([1400, 750], 115, 2000, { _otm_courier_cod_amount: "2000" })
  const h = importHarness(() => [[{ ...wc, id: 7, number: "7" }]], {
    orders: [{ id: "order_old", display_id: 469, customer_id: "cus_old", metadata: { source: "florayn.com", wc_status: "completed" } }],
    ops: [{ id: "oop_old", order_id: "order_old", workflow_status: "delivered", note: "called the customer", source: "florayn.com" }],
    imported: [{ id: "impo_old", source: "florayn.com", source_id: "7", order_id: "order_old", source_status: "completed" }],
  })
  const run = await h.run()
  assert.equal(run.rebuilt, 1)
  assert.equal(run.adjusted, 1)
  assert.equal(run.created, 0)
  const [fresh] = h.db.orders
  assert.equal(h.db.orders.length, 1, "the old copy is gone")
  assert.deepEqual(h.db.deleted, ["order_old"])
  assert.equal(fresh.display_id, 469, "same order number")
  assert.equal(fresh.customer_id, "cus_old", "same customer")
  assert.equal(fresh.metadata.import_version, 2)
  assert.equal(h.db.ops[0].order_id, fresh.id, "the workflow row moved across")
  assert.equal(h.db.ops[0].note, "called the customer", "with the admin's note")
  assert.equal(h.db.imported[0].order_id, fresh.id)
  assert.match(h.db.raw[0], /setval\(pg_get_serial_sequence\('"order"', 'display_id'\)/, "new orders carry on after the highest number")

  const again = await h.run()
  assert.equal(again.rebuilt, 0)
  assert.equal(again.unchanged, 1, "a rebuilt order is left alone next time")
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
