const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// The variant index (TRACKING.md 8.1): rebuild from fixture products, the
// sellable rules, stale-row deletion, the variant_index state and the
// lookupVariants cache that reloads only when built_at changes.

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, Buffer, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name.startsWith("node:")) return require(name)
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))

function clock(start = Date.UTC(2026, 8, 27, 6, 0, 0)) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, advance(ms) { now += ms }, now: () => now }
}

/** tracking_variant and tracking_state in memory, answering exactly the statements variant-index.ts sends. */
function fakeDb() {
  const db = {
    variants: new Map(), state: new Map(), sql: [], transactions: 0, rewritten: 0, tableReads: 0, stateReads: 0,
    async raw(sql, bindings = []) {
      const s = sql.replace(/\s+/g, " ").trim()
      db.sql.push(s)
      if (s.startsWith("insert into tracking_variant")) {
        assert.match(s, /jsonb_to_recordset\(\?::jsonb\)/)
        assert.match(s, /is distinct from/, "unchanged rows are not rewritten")
        let changed = 0
        for (const row of JSON.parse(bindings[0])) {
          const before = db.variants.get(row.variant_id)
          const next = { ...row, price: row.price === null ? null : String(row.price) }
          const same = before && ["product_id", "handle", "sku", "case_type", "device", "price", "in_stock", "sellable"]
            .every((key) => before[key] === next[key])
          if (!same) { db.variants.set(row.variant_id, next); changed += 1 }
        }
        db.rewritten += changed
        return { rowCount: changed }
      }
      if (s.startsWith("delete from tracking_variant")) {
        const seen = new Set(JSON.parse(bindings[0]))
        let removed = 0
        for (const id of [...db.variants.keys()]) if (!seen.has(id)) { db.variants.delete(id); removed += 1 }
        return { rowCount: removed }
      }
      if (s.startsWith("select variant_id, handle, case_type, device, price, sellable from tracking_variant")) {
        db.tableReads += 1
        return { rows: [...db.variants.values()].map((row) => ({ ...row })) }
      }
      throw new Error(`Unexpected SQL: ${s}`)
    },
  }
  return db
}

const dbModule = {
  trackingDb: (container) => container.db,
  withTransaction: async (container, fn) => { container.db.transactions += 1; return fn(container.db) },
  getState: async (db, key) => { db.stateReads += 1; return db.state.has(key) ? plain(db.state.get(key)) : null },
  setState: async (db, key, value) => { db.state.set(key, plain(value)) },
}

const utils = { ContainerRegistrationKeys: { QUERY: "query", PG_CONNECTION: "pg" } }

function loadIndex(time) {
  return load("lib/tracking/variant-index.ts", {
    "@medusajs/framework/utils": utils,
    "../../modules/catalog": { CATALOG_MODULE: "catalog" },
    "../../modules/catalog/data/case-types": load("modules/catalog/data/case-types.ts"),
    "../stock-availability": load("lib/stock-availability.ts"),
    "./db": dbModule,
  }, time ? { Date: time.Date } : {})
}

const OPTIONS = [{ id: "opt_case", title: "Case Type" }, { id: "opt_device", title: "Device" }]
const bdt = (amount, extra = {}) => [{ amount, currency_code: "bdt", rules_count: 0, price_list_id: null, min_quantity: null, max_quantity: null, ...extra }]
const caseVariant = (id, caseType, device, prices) => ({
  id, sku: `SKU-${id}`, options: [{ option_id: "opt_case", value: caseType }, { option_id: "opt_device", value: device }], prices,
})

function world() {
  const caseTypes = [
    { slug: "signature", name: "Signature", description: "Full-wrap print.", price: 1400, price_groups: null, is_active: true },
    { slug: "essentials", name: "Essentials", description: "Slim.", price: 1400, price_groups: null, is_active: true },
    { slug: "alcantara", name: "Alcantara", description: "Soft.", price: 3800, price_groups: null, is_active: true },
    { slug: "old-finish", name: "Old Finish", description: null, price: 1000, price_groups: null, is_active: false },
  ]
  const devices = [
    { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", is_active: true },
    { slug: "iphone-16", name: "iPhone 16", family: "iphone", is_active: true },
    { slug: "iphone-11", name: "iPhone 11", family: "iphone", is_active: false },
  ]
  const products = [
    { id: "prod_a", handle: "zebra-stark", status: "published", options: OPTIONS, variants: [
      caseVariant("variant_sig17", "Signature", "iPhone 17 Pro Max", bdt(1400)),
      caseVariant("variant_alc17", "Alcantara", "iPhone 17 Pro Max", bdt(3800)),
      caseVariant("variant_ess16", "Essentials", "iPhone 16", bdt(1400)),
      caseVariant("variant_sig11", "Signature", "iPhone 11", bdt(1400)),
      caseVariant("variant_old16", "Old Finish", "iPhone 16", bdt(1000)),
      caseVariant("variant_listonly", "Signature", "iPhone 16", bdt(1200, { price_list_id: "plist_sale" })),
      caseVariant("variant_usd", "Essentials", "iPhone 17 Pro Max", [{ amount: 20, currency_code: "usd" }]),
    ] },
    { id: "prod_b", handle: "draft-design", status: "draft", options: OPTIONS, variants: [
      caseVariant("variant_draft", "Signature", "iPhone 16", bdt(1400)),
    ] },
    { id: "prod_c", handle: "stickpad-pro", status: "published", options: [{ id: "opt_color", title: "Color" }], variants: [
      { id: "variant_black", sku: "SP-B", options: [{ option_id: "opt_color", value: "Black" }], prices: bdt(500),
        manage_inventory: true, inventory_items: [{ required_quantity: 1, inventory: { location_levels: [{ stocked_quantity: 3, reserved_quantity: 1 }] } }] },
      { id: "variant_pink", sku: "SP-P", options: [{ option_id: "opt_color", value: "Pink" }], prices: bdt(600),
        manage_inventory: true, inventory_items: [{ required_quantity: 1, inventory: { location_levels: [{ stocked_quantity: 1, reserved_quantity: 1 }] } }] },
    ] },
  ]
  const blanks = [
    { metadata: { case_type_name: "Signature", device_name: "iPhone 17 Pro Max" }, location_levels: [{ stocked_quantity: 5, reserved_quantity: 1 }] },
    { metadata: { case_type_name: "Essentials", device_name: "iPhone 16" }, location_levels: [{ stocked_quantity: 2, reserved_quantity: 2 }] },
  ]
  return { caseTypes, devices, products, blanks }
}

function containerFor(w, db = fakeDb()) {
  const graphs = []
  const query = {
    async graph(q) {
      graphs.push(plain(q))
      if (q.entity === "inventory_item") return { data: w.blanks }
      assert.equal(q.entity, "product")
      if (q.filters?.handle) {
        return { data: w.products.filter((p) => p.handle === q.filters.handle && p.status === q.filters.status) }
      }
      let list = [...w.products].sort((a, b) => a.id.localeCompare(b.id))
      if (q.filters?.status) list = list.filter((p) => p.status === q.filters.status)
      return { data: list.slice(q.pagination.skip, q.pagination.skip + q.pagination.take) }
    },
  }
  const catalog = {
    listCaseTypes: async () => w.caseTypes,
    listDevices: async () => w.devices,
  }
  return { db, graphs, resolve(name) {
    if (name === "query") return query
    if (name === "catalog") return catalog
    throw new Error(`Unexpected resolve ${name}`)
  } }
}

test("rebuild upserts every variant with its price, case type, device, stock and sellable flag", async () => {
  const time = clock()
  const index = loadIndex(time)
  const w = world()
  const container = containerFor(w)
  container.db.variants.set("variant_gone", { variant_id: "variant_gone", product_id: "prod_x", handle: "gone", sku: null,
    case_type: null, device: null, price: "900", in_stock: true, sellable: true })

  const state = await index.rebuildVariantIndex(container)
  const rows = Object.fromEntries([...container.db.variants.entries()].map(([id, row]) => [id, row]))

  assert.equal(rows.variant_gone, undefined, "ids no longer present are deleted")
  assert.deepEqual(rows.variant_sig17, { variant_id: "variant_sig17", product_id: "prod_a", handle: "zebra-stark",
    sku: "SKU-variant_sig17", case_type: "Signature", device: "iPhone 17 Pro Max", price: "1400", in_stock: true, sellable: true })
  assert.equal(rows.variant_alc17.sellable, true, "Alcantara is a real, sellable variant; only the feed leaves it out")
  assert.equal(rows.variant_ess16.in_stock, false, "an empty blank is out of stock")
  assert.equal(rows.variant_ess16.sellable, true, "stock does not decide sellable")
  assert.equal(rows.variant_sig11.sellable, false, "an inactive device is not sellable")
  assert.equal(rows.variant_old16.sellable, false, "an inactive case type is not sellable")
  assert.equal(rows.variant_listonly.price, null, "a price-list price is not the base price")
  assert.equal(rows.variant_listonly.sellable, false)
  assert.equal(rows.variant_usd.sellable, false, "no BDT price, not sellable")
  assert.equal(rows.variant_draft.sellable, false, "a draft product is not sellable")
  assert.equal(rows.variant_draft.in_stock, false)
  assert.deepEqual(plain(rows.variant_black), { variant_id: "variant_black", product_id: "prod_c", handle: "stickpad-pro",
    sku: "SP-B", case_type: null, device: null, price: "500", in_stock: true, sellable: true })
  assert.equal(rows.variant_pink.in_stock, false, "a regular variant with nothing left is out of stock")
  assert.equal(rows.variant_pink.sellable, true)

  assert.deepEqual(plain(state), { built_at: new time.Date(time.now()).toISOString(), count: 10, sellable: 5 })
  assert.deepEqual(container.db.state.get("variant_index"), plain(state))
  assert.equal(container.db.transactions, 1, "upserts, deletes and the state are one transaction")
  const reads = container.graphs.filter((q) => q.entity === "product" && !q.filters?.handle)
  assert.deepEqual(reads.map((q) => q.pagination), [{ take: 25, skip: 0, order: { id: "ASC" } }])
  assert.ok(reads[0].fields.includes("variants.prices.amount") && reads[0].fields.includes("variants.options.value"))
  assert.deepEqual(container.graphs.filter((q) => q.filters?.handle).map((q) => q.filters), [{ handle: "stickpad-pro", status: "published" }],
    "regular stock is read like /store/stock?handle= for published regular products only")
})

test("a second rebuild of the same catalog rewrites nothing and pages through 25-product batches", async () => {
  const index = loadIndex(clock())
  const w = world()
  for (let i = 0; i < 30; i++) {
    w.products.push({ id: `prod_z${String(i).padStart(2, "0")}`, handle: `bulk-${i}`, status: "published", options: OPTIONS,
      variants: [caseVariant(`variant_bulk${i}`, "Signature", "iPhone 16", bdt(1400))] })
  }
  const container = containerFor(w)
  await index.rebuildVariantIndex(container)
  const first = container.db.rewritten
  assert.equal(first, 40)
  await index.rebuildVariantIndex(container)
  assert.equal(container.db.rewritten, first, "unchanged rows are left alone")
  const pages = container.graphs.filter((q) => q.entity === "product" && !q.filters?.handle).map((q) => q.pagination.skip)
  assert.deepEqual(pages, [0, 25, 0, 25])
  w.products = w.products.filter((p) => p.id !== "prod_b")
  const state = await index.rebuildVariantIndex(container)
  assert.equal(container.db.variants.has("variant_draft"), false)
  assert.equal(state.count, 39)
})

test("lookupVariants serves a cached copy and reloads only when variant_index.built_at changes", async () => {
  const time = clock()
  const index = loadIndex(time)
  const container = containerFor(world())
  const empty = await index.lookupVariants(container, ["variant_sig17"])
  assert.equal(empty.size, 0, "before the first build every id is unknown")
  assert.equal(container.db.tableReads, 1)

  time.advance(61_000)
  await index.rebuildVariantIndex(container)
  const found = await index.lookupVariants(container, ["variant_sig17", "variant_unknown", "variant_black"])
  assert.equal(container.db.tableReads, 2, "a new built_at reloads the table")
  assert.deepEqual(plain(Object.fromEntries(found)), {
    variant_sig17: { price: 1400, sellable: true, handle: "zebra-stark", case_type: "Signature", device: "iPhone 17 Pro Max" },
    variant_black: { price: 500, sellable: true, handle: "stickpad-pro", case_type: null, device: null },
  })

  const stateReads = container.db.stateReads
  await index.lookupVariants(container, ["variant_sig17"])
  time.advance(30_000)
  await index.lookupVariants(container, ["variant_sig17"])
  assert.equal(container.db.stateReads, stateReads, "within 60 s nothing is read")
  assert.equal(container.db.tableReads, 2)

  time.advance(31_000)
  await index.lookupVariants(container, ["variant_sig17"])
  assert.equal(container.db.stateReads, stateReads + 1, "after 60 s built_at is checked")
  assert.equal(container.db.tableReads, 2, "an unchanged built_at keeps the copy")

  container.db.state.set("variant_index", { built_at: "2026-09-27T07:00:00.000Z", count: 1, sellable: 1 })
  container.db.variants.get("variant_sig17").price = "1450"
  time.advance(61_000)
  const changed = await index.lookupVariants(container, ["variant_sig17"])
  assert.equal(container.db.tableReads, 3)
  assert.equal(changed.get("variant_sig17").price, 1450)
})

test("lookupVariants keeps answering from its copy while the database is down", async () => {
  const time = clock()
  const index = loadIndex(time)
  const container = containerFor(world())
  await index.rebuildVariantIndex(container)
  assert.equal((await index.lookupVariants(container, ["variant_sig17"])).size, 1)
  container.db.raw = async () => { throw new Error("db down") }
  const brokenState = dbModule.getState
  dbModule.getState = async () => { throw new Error("db down") }
  try {
    time.advance(61_000)
    assert.equal((await index.lookupVariants(container, ["variant_sig17"])).size, 1)
  } finally {
    dbModule.getState = brokenState
  }
  const cold = loadIndex(time)
  dbModule.getState = async () => { throw new Error("db down") }
  try {
    await assert.rejects(cold.lookupVariants(container, ["variant_sig17"]), /db down/)
  } finally {
    dbModule.getState = brokenState
  }
})

test("feed scope: Alcantara out by default, include lists narrow case types, regular products stay in", () => {
  const index = loadIndex()
  const settings = load("lib/tracking/settings.ts", {
    "@medusajs/framework/utils": utils, "../../modules/tracking": { TRACKING_MODULE: "tracking" },
  })
  const catalog = settings.DEFAULT_CONFIG.catalog
  const resolved = (kind, slug, sellable = true) => ({ kind, sellable, caseType: slug ? { slug } : null })
  assert.equal(index.inFeedScope(resolved("case", "alcantara"), catalog), false)
  assert.equal(index.inFeedScope(resolved("case", "signature"), catalog), true)
  assert.equal(index.inFeedScope(resolved("case", "signature", false), catalog), false)
  const only = { ...catalog, include_case_types: ["essentials"] }
  assert.equal(index.inFeedScope(resolved("case", "signature"), only), false)
  assert.equal(index.inFeedScope(resolved("case", "essentials"), only), true)
  assert.equal(index.inFeedScope(resolved("regular", null), only), true)
  assert.equal(index.expectedCasePrice({ price: 3800, price_groups: [{ price: 2100, devices: ["airpods-pro-3"] }] }, "airpods-pro-3"), 2100)
  assert.equal(index.expectedCasePrice({ price: 3800, price_groups: null }, "iphone-16"), 3800)
})
