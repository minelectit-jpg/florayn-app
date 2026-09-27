const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const zlib = require("node:zlib")
const ts = require("typescript")

// The catalog feed (TRACKING.md 8.2-8.5): rows from fixture products, root
// links whose device slugs equal the storefront's helpers, availability equal
// to /store/stock, the Alcantara and price guards, image readiness, TSV and
// TikTok columns, the content-hash / shrink-guard publish rules, the feed
// route, JPEG copies (with and without sharp), the catalog job and the admin.

const SRC = path.join(__dirname, "../src")
const STOREFRONT = path.join(__dirname, "../../storefront/src")

function load(filename, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, Buffer, URL, AbortSignal, structuredClone, process: { env: {} }, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name.startsWith("node:")) return require(name)
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}
const backend = (file, deps, globals) => load(path.join(SRC, file), deps, globals)

const plain = (value) => JSON.parse(JSON.stringify(value))
const tick = async (times = 5) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)) }
const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex")

const utils = { ContainerRegistrationKeys: { QUERY: "query", PG_CONNECTION: "pg" } }
const settingsModule = backend("lib/tracking/settings.ts", {
  "@medusajs/framework/utils": utils, "../../modules/tracking": { TRACKING_MODULE: "tracking" },
})
const stockModule = backend("lib/stock-availability.ts")

function config(catalog = {}) {
  const base = settingsModule.parseTrackingConfig({})
  return plain({ ...base, catalog: { ...base.catalog, ...catalog } })
}

// ---------------------------------------------------------------- fake database

function fakeDb() {
  const db = {
    state: new Map(), images: new Map(), feeds: new Map(), fetches: [], dayDim: [], sql: [], failAll: false,
    async raw(sql, bindings = []) {
      if (db.failAll) throw new Error("db down")
      const s = sql.replace(/\s+/g, " ").trim()
      db.sql.push(s)
      if (s.startsWith("select source_url from catalog_image where jpg_url is not null")) {
        return { rows: [...db.images.values()].filter((row) => row.jpg_url).map((row) => ({ source_url: row.source_url })) }
      }
      if (s.startsWith("select source_url, jpg_url is not null as ready, created_at from catalog_image")) {
        return { rows: [...db.images.values()].map((row) => ({ source_url: row.source_url, ready: Boolean(row.jpg_url), created_at: row.created_at })) }
      }
      if (s.startsWith("insert into catalog_image")) {
        const [source_url, jpg_url, bytes, error] = bindings
        db.images.set(source_url, { source_url, jpg_url, bytes, error, created_at: new Date().toISOString() })
        return { rowCount: 1 }
      }
      if (s.startsWith("select count(*) filter (where jpg_url is not null)")) {
        const rows = [...db.images.values()]
        return { rows: [{ ready: rows.filter((row) => row.jpg_url).length, failed: rows.filter((row) => !row.jpg_url).length }] }
      }
      if (s.startsWith("select key, coalesce(sum(count) filter")) {
        const [since30, since7] = bindings
        const byKey = new Map()
        for (const row of db.dayDim.filter((r) => r.dim === "product")) {
          const entry = byKey.get(row.key) ?? { key: row.key, purchases: 0, adds: 0, first_day: row.day }
          if (row.event_name === "Purchase" && row.day >= since30) entry.purchases += row.count
          if (row.event_name === "AddToCart" && row.day >= since7) entry.adds += row.count
          if (row.day < entry.first_day) entry.first_day = row.day
          byKey.set(row.key, entry)
        }
        return { rows: [...byKey.values()] }
      }
      if (s.startsWith("insert into catalog_feed (platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings) values")) {
        const [platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings] = bindings
        db.feeds.set(`${platform}|${kind}`, { platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings: JSON.parse(warnings) })
        return { rowCount: 1 }
      }
      if (s.startsWith("insert into catalog_feed (platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings) select")) {
        for (const row of [...db.feeds.values()].filter((r) => r.kind === "candidate" && r.status === "held")) {
          db.feeds.set(`${row.platform}|published`, { ...row, kind: "published", status: "published", published_at: new Date().toISOString() })
        }
        return { rowCount: 2 }
      }
      if (s.startsWith("update catalog_feed set status = ?, built_at = ?, warnings = ?::jsonb where kind = 'candidate' and content_hash = ?")) {
        const [status, built_at, warnings, hash, only] = bindings
        let n = 0
        for (const row of db.feeds.values()) {
          if (row.kind !== "candidate" || row.content_hash !== hash || (only && row.status !== only)) continue
          Object.assign(row, { status, built_at, warnings: JSON.parse(warnings) })
          n += 1
        }
        return { rowCount: n }
      }
      if (s.startsWith("select platform, item_count from catalog_feed where kind = 'candidate' and status = 'held'")) {
        return { rows: [...db.feeds.values()].filter((r) => r.kind === "candidate" && r.status === "held") }
      }
      if (s.startsWith("update catalog_feed set status = 'published', published_at = now() where kind = 'candidate' and status = 'held'")) {
        for (const row of db.feeds.values()) if (row.kind === "candidate" && row.status === "held") Object.assign(row, { status: "published", published_at: new Date().toISOString() })
        return { rowCount: 2 }
      }
      if (s.startsWith("select platform, kind, etag, content_hash, item_count, built_at, published_at, status, warnings, octet_length(body_gzip)::int as bytes from catalog_feed")) {
        return { rows: [...db.feeds.values()].map((row) => ({ ...row, bytes: row.body_gzip.length })) }
      }
      if (s.startsWith("select etag from catalog_feed where platform = ? and kind = 'published'")) {
        const row = db.feeds.get(`${bindings[0]}|published`)
        return { rows: row ? [{ etag: row.etag }] : [] }
      }
      if (s.startsWith("select etag, body_gzip from catalog_feed where platform = ? and kind = 'published'")) {
        const row = db.feeds.get(`${bindings[0]}|published`)
        return { rows: row ? [{ etag: row.etag, body_gzip: row.body_gzip }] : [] }
      }
      if (s.startsWith("insert into catalog_feed_fetch")) {
        const [platform, user_agent, status, bytes] = bindings
        db.fetches.push({ platform, user_agent, status, bytes, fetched_at: new Date().toISOString() })
        return { rowCount: 1 }
      }
      if (s.startsWith("select distinct on (platform)")) {
        const last = new Map()
        for (const row of db.fetches) last.set(row.platform, row)
        return { rows: [...last.values()] }
      }
      throw new Error(`Unexpected SQL: ${s}`)
    },
  }
  return db
}

const dbModule = {
  trackingDb: (container) => container.db,
  withTransaction: async (container, fn) => fn(container.db),
  getState: async (db, key) => {
    if (db.failAll) throw new Error("db down")
    return db.state.has(key) ? plain(db.state.get(key)) : null
  },
  setState: async (db, key, value) => {
    if (db.failAll) throw new Error("db down")
    db.state.set(key, plain(value))
  },
}

// ---------------------------------------------------------------- fixtures

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"
const BASE = "https://new.florayn.com"
const IMG = "https://img.florayn.com"
const render = (design, ct, device, n) => `${R2}/${design}/${ct}/${device}/${n}.webp`
const renders = (design, ct, device) => [1, 2, 3].map((n) => render(design, ct, device, n))
const OPTIONS = [{ id: "opt_case", title: "Case Type" }, { id: "opt_device", title: "Device" }]
const bdt = (amount) => [{ amount, currency_code: "bdt", rules_count: 0, price_list_id: null, min_quantity: null, max_quantity: null }]
const caseVariant = (id, caseType, device, amount, images) => ({
  id, title: `${caseType} / ${device}`, sku: `SKU-${id}`, prices: bdt(amount), metadata: images ? { images } : {},
  options: [{ option_id: "opt_case", value: caseType }, { option_id: "opt_device", value: device }],
})

const CASE_TYPES = [
  { slug: "essentials", name: "Essentials", description: "A slim flexible shell.", price: 1400, price_groups: null, is_active: true },
  { slug: "signature", name: "Signature", description: "Our full-wrap print finish.", price: 1400, price_groups: null, is_active: true },
  { slug: "signature-earbuds", name: "Signature Earbuds", description: "Full-wrap print for AirPods.", price: 750, price_groups: null, is_active: true },
  { slug: "alcantara", name: "Alcantara", description: "Italian Alcantara.", price: 3800, price_groups: null, is_active: true },
]
const DEVICES = [
  { id: "dev_1", slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", brand: "Apple", is_active: true },
  { id: "dev_2", slug: "iphone-15-pro-max", name: "iPhone 15 Pro Max", family: "iphone", brand: "Apple", is_active: true },
  { id: "dev_3", slug: "iphone-15", name: "iPhone 15", family: "iphone", brand: "Apple", is_active: true },
  { id: "dev_4", slug: "airpods-pro-3", name: "AirPods Pro 3", family: "airpods", brand: "Apple", is_active: true },
  { id: "dev_5", slug: "apple-watch-band", name: "Apple Watch Band", family: "watch", brand: "Apple", is_active: true },
  { id: "dev_6", slug: "card-wallet", name: "Card Wallet", family: "wallet", brand: "Florayn", is_active: true },
  { id: "dev_7", slug: "samsung-s24-ultra", name: "Samsung S24 Ultra", family: "samsung", brand: "Samsung", is_active: true },
  { id: "dev_8", slug: "iphone-11", name: "iPhone 11", family: "iphone", brand: "Apple", is_active: false },
]

function fixtureProducts() {
  return [
    { id: "prod_a", handle: "zebra-stark", title: "Zebra Stark", status: "published", options: OPTIONS,
      description: "<p>A zebra &amp; its\tstripes.</p>\n<p>Printed in Dhaka.</p>",
      metadata: { design_name: "Zebra Stark", audience: "women", form: "phone" }, collection: { title: "Animal Prints" },
      thumbnail: `${R2}/zebra-stark/cover.webp`,
      variants: [
        caseVariant("variant_a1", "Signature", "iPhone 17 Pro Max", 1400, renders("zebra-stark", "signature", "iphone-17-pro-max")),
        caseVariant("variant_a2", "Essentials", "iPhone 15", 1400, renders("zebra-stark", "essentials", "iphone-15")),
        caseVariant("variant_a3", "Alcantara", "iPhone 15 Pro Max", 3800, renders("zebra-stark", "alcantara", "iphone-15-pro-max")),
        caseVariant("variant_a4", "Signature", "iPhone 15 Pro Max", 1500, renders("zebra-stark", "signature", "iphone-15-pro-max")),
        caseVariant("variant_a5", "Signature", "iPhone 15", 1400, renders("zebra-stark", "signature", "iphone-15")),
        caseVariant("variant_a6", "Signature", "Samsung S24 Ultra", 1400, renders("zebra-stark", "signature", "samsung-s24-ultra")),
      ] },
    { id: "prod_b", handle: "tiger-roar", title: "Tiger Roar - AirPods Case", status: "published", options: OPTIONS, description: null,
      metadata: { design_name: "Tiger Roar", audience: "men", form: "airpods" }, collection: null,
      variants: [caseVariant("variant_b1", "Signature Earbuds", "AirPods Pro 3", 750, renders("tiger-roar", "signature-earbuds", "airpods-pro-3"))] },
    { id: "prod_c", handle: "neon-card-wallet", title: "Neon - Card Wallet", status: "published", options: OPTIONS, description: "",
      metadata: { design_name: "Neon", form: "wallet" },
      variants: [caseVariant("variant_c1", "Signature", "Card Wallet", 1400, renders("neon", "signature", "card-wallet"))] },
    { id: "prod_d", handle: "neon-watch-band", title: "Neon - Watch Band", status: "published", options: OPTIONS,
      metadata: { design_name: "Neon", form: "watch" },
      variants: [caseVariant("variant_d1", "Signature", "Apple Watch Band", 1400, renders("neon", "signature", "apple-watch-band"))] },
    { id: "prod_e", handle: "stickpad-pro", title: "StickPad Pro", status: "published", options: [{ id: "opt_color", title: "Color" }],
      description: "Sticks to any phone.", metadata: {},
      variants: [
        { id: "variant_e1", title: "Black", sku: "SP-B", prices: bdt(500), metadata: { images: [`${R2}/site/stickpad/black.webp`] },
          options: [{ option_id: "opt_color", value: "Black" }], manage_inventory: true,
          inventory_items: [{ required_quantity: 1, inventory: { location_levels: [{ stocked_quantity: 3, reserved_quantity: 1 }] } }] },
        { id: "variant_e2", title: "Pink", sku: "SP-P", prices: bdt(600), metadata: { audience: "women", images: [`${R2}/site/stickpad/pink.webp`] },
          options: [{ option_id: "opt_color", value: "Pink" }], manage_inventory: true,
          inventory_items: [{ required_quantity: 1, inventory: { location_levels: [{ stocked_quantity: 1, reserved_quantity: 1 }] } }] },
      ] },
    { id: "prod_f", handle: "draft-design", title: "Draft", status: "draft", options: OPTIONS, metadata: {},
      variants: [caseVariant("variant_f1", "Signature", "iPhone 15", 1400, renders("draft", "signature", "iphone-15"))] },
  ]
}

const BLANKS = [
  { metadata: { case_type_name: "Signature", device_name: "iPhone 17 Pro Max" }, location_levels: [{ stocked_quantity: 5, reserved_quantity: 1 }] },
  { metadata: { case_type_name: "Essentials", device_name: "iPhone 15" }, location_levels: [{ stocked_quantity: 1, reserved_quantity: 1 }] },
  { metadata: { case_type_name: "Signature", device_name: "Card Wallet" }, location_levels: [{ stocked_quantity: 0, reserved_quantity: 0 }] },
]

/** Every image of the fixture is converted except variant_a5's (it is left out and counted). */
function readyAllBut(db, products, skip = ["variant_a5"]) {
  for (const product of products) {
    for (const variant of product.variants) {
      if (skip.includes(variant.id)) continue
      for (const url of variant.metadata?.images ?? []) {
        db.images.set(url, { source_url: url, jpg_url: `${IMG}/feed-jpg/${sha1(url)}.jpg`, bytes: 10, error: null, created_at: new Date().toISOString() })
      }
    }
  }
}

function world(options = {}) {
  const db = options.db ?? fakeDb()
  const products = options.products ?? fixtureProducts()
  const graphs = []
  const container = {
    db, products, graphs, blanks: options.blanks ?? BLANKS, config: options.config ?? config(), feedToken: "feed-token-abcdefghijklmnopqrstuv",
    failQuery: false,
    resolve(name) {
      if (name === "query") return query
      if (name === "catalog") return catalog
      throw new Error(`Unexpected resolve ${name}`)
    },
  }
  const query = {
    async graph(q) {
      if (container.failQuery) throw new Error("query failed")
      graphs.push(plain(q))
      if (q.entity === "inventory_item") return { data: container.blanks }
      if (q.filters?.handle) return { data: container.products.filter((p) => p.handle === q.filters.handle && p.status === q.filters.status) }
      let list = [...container.products].sort((a, b) => a.id.localeCompare(b.id))
      if (q.filters?.status) list = list.filter((p) => p.status === q.filters.status)
      return { data: list.slice(q.pagination.skip, q.pagination.skip + q.pagination.take) }
    },
  }
  const catalog = {
    listCaseTypes: async () => CASE_TYPES,
    listDevices: async () => DEVICES,
  }
  return container
}

function loadModules({ sharp, s3, fetchImpl, env = {} } = {}) {
  const settings = {
    loadTrackingSettings: async (container) => ({ config: container.config, tokenSet: {}, feedToken: container.feedToken }),
  }
  const variantIndex = backend("lib/tracking/variant-index.ts", {
    "@medusajs/framework/utils": utils,
    "../../modules/catalog": { CATALOG_MODULE: "catalog" },
    "../../modules/catalog/data/case-types": backend("modules/catalog/data/case-types.ts"),
    "../stock-availability": stockModule,
    "./db": dbModule,
  })
  const s3calls = []
  const client = { async send(command) {
    s3calls.push(command)
    return s3 ? s3(command) : {}
  } }
  const images = backend("lib/tracking/catalog-images.ts", {
    "@aws-sdk/client-s3": {
      GetObjectCommand: class { constructor(input) { this.type = "get"; this.input = input } },
      PutObjectCommand: class { constructor(input) { this.type = "put"; this.input = input } },
    },
    "../r2": { r2Client: () => client, r2Bucket: () => "florayn-images" },
    "./db": dbModule,
    "./settings": settings,
    "./variant-index": variantIndex,
    ...(sharp ? { sharp } : {}),
  }, { process: { env }, fetch: fetchImpl ?? (async () => { throw new Error("no network in tests") }) })
  const feed = backend("lib/tracking/catalog-feed.ts", {
    "@medusajs/framework/utils": utils,
    "../audience": backend("lib/audience.ts"),
    "../stock-availability": stockModule,
    "./catalog-images": images,
    "./db": dbModule,
    "./settings": settings,
    "./variant-index": variantIndex,
  })
  return { variantIndex, images, feed, settings, s3calls }
}

// ---------------------------------------------------------------- rows

test("one row per sellable variant: ids, groups, root links, prices, availability, titles and labels", async () => {
  const { feed } = loadModules()
  const container = world()
  readyAllBut(container.db, container.products)
  const build = await feed.buildFeedRows(container, container.config)
  const rows = Object.fromEntries(build.rows.map((row) => [row.id, row]))

  assert.deepEqual(Object.keys(rows).sort(), ["variant_a1", "variant_a2", "variant_a6", "variant_b1", "variant_c1", "variant_d1", "variant_e1", "variant_e2"])
  assert.equal(rows.variant_a3, undefined, "Alcantara is left out by default")
  assert.equal(rows.variant_f1, undefined, "drafts are never listed")
  assert.deepEqual(plain(build.counts), { in_scope: 10, items: 8, no_image: 1, price_mismatch: 1 })

  const a1 = rows.variant_a1
  assert.equal(a1.item_group_id, "prod_a")
  assert.equal(a1.link, `${BASE}/product/zebra-stark-iphone-17-pro-max/?case=signature`)
  assert.equal(a1.price, "1400.00 BDT")
  assert.equal(a1.availability, "in stock")
  assert.equal(a1.condition, "new")
  assert.equal(a1.brand, "Florayn")
  assert.equal(a1.title, "Zebra Stark - iPhone 17 Pro Max Signature Case")
  assert.equal(a1.description, "A zebra & its stripes. Printed in Dhaka. Our full-wrap print finish.")
  assert.equal(a1.image_link, `${IMG}/feed-jpg/${sha1(render("zebra-stark", "signature", "iphone-17-pro-max", 1))}.jpg`)
  assert.deepEqual(a1.additional_image_link.split(","), [2, 3].map((n) => `${IMG}/feed-jpg/${sha1(render("zebra-stark", "signature", "iphone-17-pro-max", n))}.jpg`))
  assert.equal(a1.gender, "female")
  assert.equal(a1.product_type, "Phone Case > Signature")
  assert.equal(a1.google_product_category, "Electronics > Communications > Telephony > Mobile Phone Accessories > Mobile Phone Cases")
  assert.equal(a1.internal_label, "sku:SKU-variant_a1")
  assert.deepEqual([a1.custom_label_0, a1.custom_label_1, a1.custom_label_2, a1.custom_label_3, a1.custom_label_4],
    ["signature", "iPhone 17", "Animal Prints", "women", ""])
  assert.equal(rows.variant_a6.custom_label_1, "Samsung S24")

  assert.equal(rows.variant_a2.availability, "out of stock", "an empty blank is listed as out of stock")
  const b1 = rows.variant_b1
  assert.equal(b1.link, `${BASE}/product/tiger-roar-airpods-pro-3/?case=signature-earbuds`, "men's designs link to the root product page")
  assert.equal(b1.price, "750.00 BDT")
  assert.equal(b1.gender, "male")
  assert.equal(b1.title, "Tiger Roar - AirPods Pro 3 Signature Earbuds Case")
  assert.equal(b1.product_type, "AirPods Case > Signature Earbuds")
  assert.equal(b1.custom_label_1, "AirPods")
  assert.equal(b1.availability, "in stock", "a blank missing from /store/stock is available, as in the buy box")
  assert.equal(rows.variant_c1.title, "Neon - Signature Card Wallet")
  assert.equal(rows.variant_c1.availability, "out of stock")
  assert.equal(rows.variant_c1.gender, "unisex")
  assert.equal(rows.variant_d1.title, "Neon - Signature Apple Watch Band")
  assert.equal(rows.variant_d1.product_type, "Watch Band > Signature")

  const e1 = rows.variant_e1
  assert.equal(e1.link, `${BASE}/product/stickpad-pro/?variant=variant_e1`)
  assert.equal(e1.title, "StickPad Pro - Black")
  assert.equal(e1.price, "500.00 BDT")
  assert.equal(e1.availability, "in stock")
  assert.equal(e1.custom_label_0, "")
  assert.equal(e1.product_type, "Accessories")
  assert.equal(rows.variant_e2.availability, "out of stock")
  assert.equal(rows.variant_e2.gender, "female", "a simple product's colour uses its own audience")

  const mismatch = build.warnings.find((w) => w.kind === "price_mismatch")
  assert.equal(mismatch.count, 1)
  assert.match(mismatch.examples[0], /variant_a4.*1500.*1400/)
  assert.equal(build.warnings.find((w) => w.kind === "no_image").count, 1)
  assert.match(build.warnings.find((w) => w.kind === "no_image").examples[0], /variant_a5/)
})

test("include lists, a changed base URL and Cloudflare image mode", async () => {
  const { feed } = loadModules()
  const container = world({ config: config({ include_case_types: ["essentials", "alcantara"], exclude_case_types: [],
    base_url: "https://florayn.com", image_mode: "cf_transform" }) })
  const build = await feed.buildFeedRows(container, container.config)
  const ids = plain(build.rows.map((row) => row.id).sort())
  assert.deepEqual(ids, ["variant_a2", "variant_a3", "variant_e1", "variant_e2"], "include narrows case types; regular products stay")
  const a3 = build.rows.find((row) => row.id === "variant_a3")
  assert.equal(a3.price, "3800.00 BDT", "Alcantara passes the price guard through the seed's price groups")
  assert.equal(a3.link, "https://florayn.com/product/zebra-stark-iphone-15-pro-max/?case=alcantara")
  assert.equal(a3.image_link, `${IMG}/cdn-cgi/image/format=jpeg,width=1200,quality=82/zebra-stark/alcantara/iphone-15-pro-max/1.webp`)
})

test("device slugs and links equal the storefront's sitemap and device-page helpers", async () => {
  const { feed } = loadModules()
  const container = world()
  readyAllBut(container.db, container.products, [])
  const build = await feed.buildFeedRows(container, container.config)
  const active = DEVICES.filter((d) => d.is_active)
  const published = container.products.filter((p) => p.status === "published")

  const sitemap = load(path.join(STOREFRONT, "lib/sitemap-urls.ts"), {
    react: { cache: (fn) => fn },
    "@/lib/catalog": { getDeviceCatalog: async () => active },
    "@/lib/medusa": { listProducts: async () => ({ products: [], count: 0 }) },
  })
  const urls = new Set(sitemap.buildSitemapUrls(published, active))
  const devicePage = load(path.join(STOREFRONT, "lib/device-page.ts"), {
    react: { cache: (fn) => fn },
    "@/lib/catalog": { getDeviceCatalog: async () => active },
    "@/lib/medusa": {
      PRODUCT_PAGE_FIELDS: "*",
      listProducts: async ({ handle }) => ({ products: published.filter((p) => [].concat(handle).includes(p.handle)) }),
    },
  })

  const caseRows = build.rows.filter((row) => row.custom_label_0)
  assert.ok(caseRows.length >= 6)
  for (const row of caseRows) {
    const url = new URL(row.link)
    assert.equal(url.origin, BASE)
    assert.ok(urls.has(url.pathname), `${url.pathname} is a storefront device page`)
    const slug = url.pathname.slice("/product/".length, -1)
    const resolved = await devicePage.resolveProductPage(slug)
    assert.ok(resolved, `${slug} resolves on the storefront`)
    const product = published.find((p) => p.id === row.item_group_id)
    const variant = product.variants.find((v) => v.id === row.id)
    const deviceName = variant.options.find((o) => o.option_id === "opt_device").value
    assert.equal(resolved.baseHandle, product.handle)
    assert.equal(resolved.device.name, deviceName)
    assert.equal(devicePage.devicePageHref(resolved.baseHandle, resolved.device.slug), url.pathname)
    assert.equal(url.searchParams.get("case"), CASE_TYPES.find((c) => c.name === variant.options[0].value).slug)
  }
  const zebra15 = caseRows.find((row) => row.id === "variant_a5")
  assert.equal(new URL(zebra15.link).pathname, "/product/zebra-stark-iphone-15/", "iPhone 15 is not mistaken for iPhone 15 Pro Max")
})

test("availability equals what /store/stock reports for the same blanks and variants", async () => {
  const { feed } = loadModules()
  const container = world()
  readyAllBut(container.db, container.products, [])
  const build = await feed.buildFeedRows(container, container.config)
  const { GET } = backend("api/store/stock/route.ts", {
    "@medusajs/framework/utils": utils, "../../../lib/stock-availability": stockModule,
  })
  const call = async (queryString) => {
    let body
    await GET({ query: queryString, scope: container }, { json: (value) => { body = value }, status() { return this } })
    return body.stock
  }
  const blanks = await call({})
  const regular = await call({ handle: "stickpad-pro" })
  assert.deepEqual(plain(regular), { "variant:variant_e1": 2, "variant:variant_e2": 0 })
  for (const row of build.rows) {
    const product = container.products.find((p) => p.id === row.item_group_id)
    const variant = product.variants.find((v) => v.id === row.id)
    const key = row.custom_label_0
      ? `${variant.options[0].value}|${variant.options[1].value}`
      : `variant:${variant.id}`
    const stock = row.custom_label_0 ? blanks : regular
    assert.equal(row.availability === "in stock", (stock[key] ?? Infinity) > 0, row.id)
  }
})

test("TSV escaping, the TikTok column map and the content hash", async () => {
  const { feed } = loadModules()
  const row = Object.fromEntries(feed.META_COLUMNS.map((column) => [column, `${column}-value`]))
  row.id = "variant_x"
  row.title = "Tab\there\r\nand a new\nline"
  const meta = feed.serializeTsv([row], "meta")
  const lines = meta.split("\n")
  assert.equal(lines.length, 3, "header, one item, trailing newline")
  assert.equal(lines[0], feed.META_COLUMNS.join("\t"))
  assert.equal(lines[1].split("\t").length, feed.META_COLUMNS.length)
  assert.equal(lines[1].split("\t")[1], "Tab here  and a new line")
  assert.ok(!/\r/.test(meta))

  const tiktok = feed.serializeTsv([row], "tiktok").split("\n")
  const header = tiktok[0].split("\t")
  assert.equal(header[0], "sku_id")
  assert.ok(!header.includes("internal_label") && !header.includes("id"))
  assert.deepEqual(header.slice(1, 7), ["title", "description", "availability", "condition", "price", "link"])
  assert.ok(header.includes("item_group_id") && header.includes("custom_label_4") && header.includes("additional_image_link"))
  assert.equal(tiktok[1].split("\t")[0], "variant_x", "sku_id carries the variant id")

  const hash = feed.contentHash([row])
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(feed.contentHash([{ ...row }]), hash)
  assert.notEqual(feed.contentHash([{ ...row, availability: "out of stock" }]), hash)
})

test("custom_label_4 comes from the per-product day table only once it has data", async () => {
  const { feed } = loadModules()
  const container = world()
  readyAllBut(container.db, container.products, [])
  const empty = await feed.buildFeedRows(container, container.config)
  assert.ok(empty.rows.every((row) => row.custom_label_4 === ""))
  const day = (offset) => new Date(Date.now() + 6 * 3600_000 - offset * 86400_000).toISOString().slice(0, 10)
  container.db.dayDim.push(
    { day: day(3), dim: "product", key: "zebra-stark", event_name: "Purchase", count: 4 },
    { day: day(2), dim: "product", key: "tiger-roar", event_name: "AddToCart", count: 5 },
    { day: day(60), dim: "product", key: "old-design", event_name: "PageView", count: 1 },
    { day: day(5), dim: "product", key: "neon-card-wallet", event_name: "ViewContent", count: 2 },
  )
  const build = await feed.buildFeedRows(container, container.config)
  const label = (id) => build.rows.find((row) => row.id === id).custom_label_4
  assert.equal(label("variant_a1"), "top-sellers-30d")
  assert.equal(label("variant_b1"), "trending-7d")
  assert.equal(label("variant_c1"), "new-30d")
  assert.equal(label("variant_d1"), "")
})

// ---------------------------------------------------------------- publish

test("publish: first build publishes, an unchanged hash publishes nothing, a >20% drop is held with an alert", async () => {
  const { feed } = loadModules()
  const container = world({ config: config({ enabled: true }) })
  readyAllBut(container.db, container.products, [])

  const first = await feed.publishFeed(container)
  assert.equal(first.status, "published")
  assert.equal(first.items, 9)
  const published = container.db.feeds.get("meta|published")
  assert.equal(published.item_count, 9)
  assert.equal(published.status, "published")
  assert.equal(published.etag, `"${first.content_hash.slice(0, 32)}-meta"`)
  const metaTsv = zlib.gunzipSync(published.body_gzip).toString("utf8")
  assert.ok(metaTsv.startsWith("id\ttitle\t"))
  assert.equal(metaTsv.trim().split("\n").length, 10)
  assert.ok(zlib.gunzipSync(container.db.feeds.get("tiktok|published").body_gzip).toString("utf8").startsWith("sku_id\t"))
  assert.equal(container.db.state.get("catalog:build").status, "published")

  const publishedAt = published.published_at
  const second = await feed.publishFeed(container)
  assert.equal(second.status, "unchanged")
  assert.equal(container.db.feeds.get("meta|published").published_at, publishedAt, "nothing is published again")
  assert.equal(container.db.feeds.get("meta|candidate").status, "unchanged")
  assert.equal(container.db.state.get("catalog:alert"), undefined)

  // Three of nine items disappear: a 33% drop against the 20% guard.
  container.products = container.products.filter((p) => !["prod_c", "prod_d"].includes(p.id))
  container.products[0].variants = container.products[0].variants.filter((v) => v.id !== "variant_a6")
  const third = await feed.publishFeed(container)
  assert.equal(third.status, "held")
  assert.equal(container.db.feeds.get("meta|published").item_count, 9, "the published feed stays")
  assert.equal(container.db.feeds.get("meta|candidate").status, "held")
  assert.equal(container.db.feeds.get("meta|candidate").item_count, 6)
  const alert = container.db.state.get("catalog:alert")
  assert.equal(alert.kind, "feed_guard")
  assert.match(alert.detail, /9 to 6/)

  container.db.state.delete("catalog:alert")
  assert.equal((await feed.publishFeed(container)).status, "held")
  assert.equal(container.db.state.get("catalog:alert"), undefined, "the same held build alerts once")

  const anyway = await feed.publishAnyway(container)
  assert.deepEqual(plain(anyway), { ok: true, items: 6 })
  assert.equal(container.db.feeds.get("meta|published").item_count, 6)
  assert.equal(container.db.feeds.get("tiktok|published").item_count, 6)
  assert.equal(container.db.feeds.get("meta|candidate").status, "published")
  assert.deepEqual(plain(await feed.publishAnyway(container)), { ok: false, items: 0 })
})

test("a small drop publishes, an empty first build is held quietly, a failure writes feed_error", async () => {
  const { feed } = loadModules()
  const container = world({ config: config({ enabled: true }) })
  const empty = await feed.publishFeed(container)
  assert.equal(empty.status, "held", "no images ready: nothing to publish yet")
  assert.equal(empty.items, 0)
  assert.equal(container.db.state.get("catalog:alert"), undefined)
  assert.equal(container.db.feeds.get("meta|published"), undefined)

  readyAllBut(container.db, container.products, [])
  assert.equal((await feed.publishFeed(container)).status, "published")
  container.products = container.products.filter((p) => p.id !== "prod_d")
  const smaller = await feed.publishFeed(container)
  assert.equal(smaller.status, "published", "an 11% drop is within the guard")
  assert.equal(container.db.feeds.get("meta|published").item_count, 8)

  container.failQuery = true
  await assert.rejects(feed.publishFeed(container), /query failed/)
  const alert = container.db.state.get("catalog:alert")
  assert.equal(alert.kind, "feed_error")
  assert.match(alert.detail, /query failed/)
})

test("markCatalogStale records the change and never throws", async () => {
  const { feed } = loadModules()
  const container = world()
  await feed.markCatalogStale(container)
  assert.match(container.db.state.get("catalog:stale").at, /^\d{4}-\d{2}-\d{2}T/)
  container.db.failAll = true
  await feed.markCatalogStale(container)
  await feed.markCatalogStale({ resolve() { throw new Error("no container") } })
})

test("job timing: index when empty, stale or a day old; feed when stale, settings changed, images converted or at 03:30 Dhaka", () => {
  const { feed } = loadModules()
  const now = new Date("2026-09-27T06:00:00.000Z") // 12:00 Dhaka
  const index = { built_at: "2026-09-27T05:00:00.000Z", count: 10, sellable: 8 }
  assert.equal(feed.variantIndexDue(null, null, now), true)
  assert.equal(feed.variantIndexDue({ ...index, count: 0 }, null, now), true)
  assert.equal(feed.variantIndexDue(index, null, now), false)
  assert.equal(feed.variantIndexDue(index, "2026-09-27T05:30:00.000Z", now), true)
  assert.equal(feed.variantIndexDue(index, "2026-09-27T04:30:00.000Z", now), false)
  assert.equal(feed.variantIndexDue(index, null, new Date("2026-09-28T05:00:00.000Z")), true)

  assert.equal(feed.lastDailyRebuild(now).toISOString(), "2026-09-26T21:30:00.000Z")
  assert.equal(feed.lastDailyRebuild(new Date("2026-09-26T21:00:00.000Z")).toISOString(), "2026-09-25T21:30:00.000Z")
  const catalog = config().catalog
  const fp = feed.catalogFingerprint(catalog)
  const build = { at: "2026-09-26T22:00:00.000Z", status: "published", items: 10, content_hash: "x", config_fp: fp }
  const due = (overrides) => feed.feedDue({ now, build, staleAt: null, configFp: fp, imagesConverted: 0, ...overrides })
  assert.equal(due({}), false)
  assert.equal(due({ build: null }), true)
  assert.equal(due({ staleAt: "2026-09-27T01:00:00.000Z" }), true)
  assert.equal(due({ configFp: feed.catalogFingerprint({ ...catalog, base_url: "https://florayn.com" }) }), true)
  assert.equal(feed.catalogFingerprint({ ...catalog, shrink_guard_pct: 30, enabled: true }), fp, "the guard and switch do not change rows")
  assert.equal(due({ imagesConverted: 3 }), true)
  assert.equal(due({ build: { ...build, at: "2026-09-26T21:00:00.000Z" } }), true, "built before today's 03:30 Dhaka")
})

// ---------------------------------------------------------------- images

test("with sharp absent, convertPending records sharp_missing and returns without throwing", async () => {
  const { images, s3calls } = loadModules()
  const container = world({ config: config({ enabled: true }) })
  const result = await images.convertPending(container, { limit: 150, concurrency: 2 })
  assert.equal(result.sharp_missing, true)
  assert.equal(container.db.state.get("catalog:images").sharp_missing, true)
  assert.equal(s3calls.length, 0)
  assert.equal((await images.imageProgress(container)).sharp_installed, false)
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"))
  assert.equal(pkg.dependencies.sharp, "0.34.5", "the declared sharp dependency is untouched")
})

test("convertPending makes paced 1200 px JPEG copies in R2 and records them; image links follow the mode", async () => {
  const operations = []
  let inFlight = 0
  let most = 0
  const sharp = (input) => {
    const chain = {
      resize(width, height, options) { operations.push(["resize", width, height, plain(options)]); return chain },
      jpeg(options) { operations.push(["jpeg", plain(options)]); return chain },
      async toBuffer() {
        most = Math.max(most, ++inFlight)
        await tick(1)
        inFlight -= 1
        return Buffer.from(`jpg:${input.toString()}`)
      },
    }
    return chain
  }
  sharp.concurrency = (threads) => { operations.push(["concurrency", threads]); return threads }
  const { images, s3calls } = loadModules({
    sharp,
    s3: (command) => command.type === "get"
      ? { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(`webp:${command.input.Key}`)) } }
      : {},
  })
  const container = world({ config: config({ enabled: true }) })
  const catalog = container.config.catalog
  const first = await images.convertPending(container, { limit: 2, concurrency: 2 })
  assert.equal(first.sharp_missing, false)
  assert.equal(first.converted, 2)
  assert.equal(first.failed, 0)
  const needed = await images.neededImageSources(container, catalog)
  assert.equal(first.needed, needed.length)
  assert.equal(first.pending, needed.length - 2)
  const puts = s3calls.filter((c) => c.type === "put")
  assert.equal(puts.length, 2)
  const firstUrl = render("tiger-roar", "signature-earbuds", "airpods-pro-3", 1)
  assert.ok(needed.indexOf(firstUrl) < needed.indexOf(render("tiger-roar", "signature-earbuds", "airpods-pro-3", 2)), "first images first")
  assert.ok(!needed.some((url) => url.includes("/alcantara/")), "no copies for items outside the feed")
  const put = puts.find((c) => c.input.Key === `feed-jpg/${sha1(needed[0])}.jpg`)
  assert.ok(put, "keys are feed-jpg/<sha1(source_url)>.jpg")
  assert.equal(put.input.Bucket, "florayn-images")
  assert.equal(put.input.ContentType, "image/jpeg")
  assert.equal(put.input.CacheControl, "public, max-age=31536000, immutable")
  const get = s3calls.find((c) => c.type === "get")
  assert.match(get.input.Key, /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/\d\.webp$|^site\//, "sources are read from the bucket by key")
  assert.deepEqual(operations.slice(0, 3), [["concurrency", 1], ["resize", 1200, 1200, { fit: "inside" }], ["jpeg", { quality: 82 }]],
    "libvips gets one thread and the JPEG is plain quality 82 (no mozjpeg)")
  assert.equal(operations.filter(([name]) => name === "concurrency").length, 1, "set once per process")
  assert.equal(most, 1, "one image at a time even when a caller asks for 2")
  const row = container.db.images.get(needed[0])
  assert.equal(row.jpg_url, `${IMG}/feed-jpg/${sha1(needed[0])}.jpg`)

  const ready = new Set([needed[0]])
  assert.equal(images.imageLinkFor(needed[0], catalog, ready), `${IMG}/feed-jpg/${sha1(needed[0])}.jpg`)
  assert.equal(images.imageLinkFor(needed[1], catalog, ready), null, "not ready yet")
  assert.equal(images.imageLinkFor(`${R2}/a%20b/1.webp`, { ...catalog, image_mode: "cf_transform" }, new Set()),
    `${IMG}/cdn-cgi/image/format=jpeg,width=1200,quality=82/a%20b/1.webp`)
  assert.equal(images.imageLinkFor("https://elsewhere.example/x.webp", { ...catalog, image_mode: "cf_transform" }, new Set()), null)

  const second = await images.convertPending(container, { limit: 1000, concurrency: 2 })
  assert.equal(second.converted, needed.length - 2)
  assert.equal(second.pending, 0)
  const again = await images.convertPending(container, { limit: 1000, concurrency: 2 })
  assert.equal(again.converted, 0, "ready copies are not made twice")
})

test("a run stops at its time budget and the next run carries on; the budget is larger at night", async () => {
  const { images, s3calls } = loadModules({
    sharp: () => ({ resize() { return this }, jpeg() { return this }, async toBuffer() {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return Buffer.from("x")
    } }),
    s3: (command) => command.type === "get" ? { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from("webp")) } } : {},
  })
  const container = world({ config: config({ enabled: true }) })
  const needed = (await images.neededImageSources(container, container.config.catalog)).length
  const spent = await images.convertPending(container, { limit: 1000, budget: { convertMs: 1, runMs: 60_000 } })
  assert.equal(spent.converted, 1, "the first conversion used up the sharp budget")
  assert.equal(spent.budget_hit, true)
  assert.equal(spent.pending, needed - 1)
  assert.equal(container.db.state.get("catalog:images").budget_hit, true)
  const none = await images.convertPending(container, { limit: 1000, budget: { convertMs: 60_000, runMs: 0 } })
  assert.equal(none.converted, 0, "no time left for the run")
  assert.equal(s3calls.filter((c) => c.type === "put").length, 1)
  const rest = await images.convertPending(container, { limit: 1000, budget: { convertMs: 60_000, runMs: 60_000 } })
  assert.equal(rest.converted, needed - 1)
  assert.equal(rest.budget_hit, undefined)
  assert.equal(rest.pending, 0)

  assert.deepEqual(plain(images.imageRunBudget(new Date("2026-09-27T06:00:00Z"))), { convertMs: 20_000, runMs: 120_000 }, "12:00 Dhaka")
  assert.deepEqual(plain(images.imageRunBudget(new Date("2026-09-26T20:00:00Z"))), { convertMs: 120_000, runMs: 600_000 }, "02:00 Dhaka")
})

test("a failed source is recorded and retried only after a day; the batch size is paced by Dhaka time", async () => {
  const { images } = loadModules({
    sharp: () => ({ resize() { return this }, jpeg() { return this }, async toBuffer() { return Buffer.from("x") } }),
    s3: (command) => { if (command.type === "get") throw new Error("NoSuchKey"); return {} },
    fetchImpl: async () => ({ ok: false, status: 404 }),
  })
  const container = world({ config: config({ enabled: true }), products: [fixtureProducts()[1]] })
  const result = await images.convertPending(container, { limit: 10 })
  assert.equal(result.failed, 3)
  assert.match(result.last_error, /HTTP 404/)
  assert.equal([...container.db.images.values()].every((row) => row.jpg_url === null && /404/.test(row.error)), true)
  const retry = await images.convertPending(container, { limit: 10 })
  assert.equal(retry.failed, 0, "failures wait a day")
  assert.equal(retry.pending, 0)

  assert.equal(images.imageBatchLimit(new Date("2026-09-27T06:00:00Z")), 150, "12:00 Dhaka")
  assert.equal(images.imageBatchLimit(new Date("2026-09-26T20:00:00Z")), 600, "02:00 Dhaka")
  assert.equal(images.imageBatchLimit(new Date("2026-09-26T19:00:00Z")), 600, "01:00 Dhaka")
  assert.equal(images.imageBatchLimit(new Date("2026-09-27T01:00:00Z")), 150, "07:00 Dhaka")
})

// ---------------------------------------------------------------- feed route

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    json(value) { this.body = value; return this },
    end(value) { this.body = value; return this },
  }
}

test("feed route: bad token or file 404 unlogged, ETag and 304, raw .gz, gzip or inflated .tsv, valid fetches logged", async () => {
  const { feed, settings } = loadModules()
  const container = world({ config: config({ enabled: true }) })
  readyAllBut(container.db, container.products, [])
  const { GET } = backend("api/feeds/[token]/[file]/route.ts", {
    "../../../../lib/tracking/catalog-feed": feed,
    "../../../../lib/tracking/settings": settings,
  })
  const get = async (token, file, headers = {}) => {
    const res = fakeRes()
    await GET({ params: { token, file }, headers: { "user-agent": "facebookexternalhit/1.1", ...headers }, scope: container }, res)
    await tick()
    return res
  }

  assert.equal((await get("wrong-token-abcdefghijklmnopqrst", "meta.tsv")).statusCode, 404)
  assert.equal((await get(container.feedToken, "meta.csv")).statusCode, 404)
  assert.equal((await get(container.feedToken, "../meta.tsv")).statusCode, 404)
  assert.equal(container.db.fetches.length, 0, "bad tokens and files are never logged")

  const none = await get(container.feedToken, "meta.tsv")
  assert.equal(none.statusCode, 404, "nothing published yet")
  assert.equal(container.db.fetches.length, 1)

  await feed.publishFeed(container)
  const graphsBefore = container.graphs.length
  const gzipped = await get(container.feedToken, "meta.tsv", { "accept-encoding": "gzip, deflate, br" })
  assert.equal(gzipped.statusCode, 200)
  assert.equal(gzipped.headers["content-encoding"], "gzip")
  assert.equal(gzipped.headers["content-type"], "text/tab-separated-values; charset=utf-8")
  assert.equal(gzipped.headers.vary, "Accept-Encoding")
  const etag = gzipped.headers.etag
  assert.equal(etag, container.db.feeds.get("meta|published").etag)
  assert.ok(zlib.gunzipSync(gzipped.body).toString("utf8").startsWith("id\ttitle"))

  const inflated = await get(container.feedToken, "meta.tsv")
  assert.equal(inflated.headers["content-encoding"], undefined)
  assert.ok(inflated.body.toString("utf8").startsWith("id\ttitle"))
  assert.equal(inflated.headers["content-length"], String(inflated.body.length))

  const refused = await get(container.feedToken, "meta.tsv", { "accept-encoding": "gzip;q=0, identity" })
  assert.equal(refused.headers["content-encoding"], undefined)

  const raw = await get(container.feedToken, "tiktok.tsv.gz", { "accept-encoding": "gzip" })
  assert.equal(raw.statusCode, 200)
  assert.equal(raw.headers["content-type"], "application/gzip")
  assert.equal(raw.headers["content-encoding"], undefined, "the .gz file is served as the gzip bytes themselves")
  assert.equal(raw.body[0], 0x1f)
  assert.ok(zlib.gunzipSync(raw.body).toString("utf8").startsWith("sku_id\t"))

  const notModified = await get(container.feedToken, "meta.tsv.gz", { "if-none-match": etag })
  assert.equal(notModified.statusCode, 304)
  assert.equal(notModified.body, undefined)

  assert.equal(container.graphs.length, graphsBefore, "the route never builds")
  const logged = container.db.fetches.map((row) => [row.platform, row.status, row.user_agent])
  assert.deepEqual(logged.slice(1), [
    ["meta", 200, "facebookexternalhit/1.1"], ["meta", 200, "facebookexternalhit/1.1"], ["meta", 200, "facebookexternalhit/1.1"],
    ["tiktok", 200, "facebookexternalhit/1.1"], ["meta", 304, "facebookexternalhit/1.1"],
  ])
  assert.equal(container.db.fetches[1].bytes, gzipped.body.length)
})

// ---------------------------------------------------------------- job and admin

test("the catalog job registers itself and keeps the variant index fresh even while the feed is off", async () => {
  const { feed, images } = loadModules()
  const registered = []
  const calls = []
  const container = world({ config: config({ enabled: false }) })
  const job = backend("jobs/catalog-feed.ts", {
    "../lib/tracking/catalog-feed": { ...feed, publishFeed: async () => { calls.push("publish") } },
    "../lib/tracking/catalog-images": { ...images, convertPending: async (_, options) => { calls.push(["convert", plain(options)]); return { converted: container.converted ?? 0 } } },
    "../lib/tracking/db": dbModule,
    "../lib/tracking/jobs": {
      registerTrackingJob: (name, spec) => registered.push([name, spec.staleAfterMs, spec.run]),
      runTrackingJob: async (scope, name, run) => { calls.push(["job", name]); await run(scope) },
    },
    "../lib/tracking/settings": { loadTrackingSettings: async (scope) => ({ config: scope.config }) },
    "../lib/tracking/variant-index": {
      rebuildVariantIndex: async (scope) => {
        calls.push("index")
        scope.db.state.set("variant_index", { built_at: new Date().toISOString(), count: 5, sellable: 5 })
      },
    },
  })
  assert.deepEqual(registered.map(([name, stale]) => [name, stale]), [["catalog", 2_700_000]])
  assert.equal(registered[0][2], job.runCatalogJob)
  assert.deepEqual(plain(job.config), { name: "catalog-feed", schedule: { interval: 900_000 } })

  await job.default(container)
  assert.deepEqual(calls, [["job", "catalog"], "index"], "an empty index is built with the feed off; nothing else runs")

  calls.length = 0
  container.config = config({ enabled: true })
  await job.runCatalogJob(container)
  assert.equal(calls[0][0], "convert")
  assert.ok([150, 600].includes(calls[0][1].limit))
  assert.equal(calls[0][1].concurrency, undefined, "one image at a time (sharp.concurrency(1)); no worker count is passed")
  assert.equal(calls[1], "publish", "no build yet, so the feed is built")

  calls.length = 0
  container.db.state.set("catalog:build", { at: new Date().toISOString(), status: "published", items: 5, content_hash: "h",
    config_fp: feed.catalogFingerprint(container.config.catalog) })
  await job.runCatalogJob(container)
  assert.deepEqual(calls.map((c) => Array.isArray(c) ? c[0] : c), ["convert"], "nothing changed: no rebuild")

  calls.length = 0
  container.converted = 4
  await job.runCatalogJob(container)
  assert.deepEqual(calls.map((c) => Array.isArray(c) ? c[0] : c), ["convert", "publish"], "new images rebuild the feed")

  calls.length = 0
  container.converted = 0
  container.db.state.set("catalog:stale", { at: new Date(Date.now() + 1000).toISOString() })
  await job.runCatalogJob(container)
  assert.deepEqual(calls.map((c) => Array.isArray(c) ? c[0] : c), ["index", "convert", "publish"], "a product change rebuilds both")

  calls.length = 0
  container.db.state.delete("catalog:stale")
  container.config = config({ enabled: true, image_mode: "cf_transform" })
  container.db.state.set("catalog:build", { at: new Date(Date.now() + 2000).toISOString(), status: "published", items: 5,
    content_hash: "h", config_fp: feed.catalogFingerprint(container.config.catalog) })
  await job.runCatalogJob(container)
  assert.deepEqual(calls, [], "Cloudflare mode makes no copies")
})

test("the Catalog admin page is a sub-page without a config export", () => {
  const source = fs.readFileSync(path.join(SRC, "admin/routes/tracking/catalog/page.tsx"), "utf8")
  assert.ok(!/export\s+const\s+config/.test(source))
  assert.ok(!/defineRouteConfig/.test(source))
  assert.match(source, /\/admin\/tracking\/settings/)
  assert.match(source, /JSON\.stringify\(\{ catalog: /, "only the catalog section is posted to the settings route")
  for (const action of ["rebuild", "publish_anyway", "rotate_token", "convert_images"]) assert.match(source, new RegExp(`"${action}"`))
})

test("the Catalog admin route lists feed URLs and runs its actions", async () => {
  const { feed, images, variantIndex } = loadModules()
  const container = world({ config: config({ enabled: true }) })
  const rotated = []
  const route = backend("api/admin/tracking/catalog/route.ts", {
    "../../../../modules/catalog": { CATALOG_MODULE: "catalog" },
    "../../../../lib/tracking/catalog-feed": feed,
    "../../../../lib/tracking/catalog-images": images,
    "../../../../lib/tracking/db": dbModule,
    "../../../../lib/tracking/jobs": { jobStates: async () => ({ catalog: { last_run_at: null } }), kickStaleJobs: () => undefined },
    "../../../../lib/tracking/settings": {
      loadTrackingSettings: async (scope) => ({ config: scope.config }),
      ensureFeedToken: async (scope) => scope.feedToken,
      rotateFeedToken: async (scope) => { rotated.push(true); scope.feedToken = "rotated-token-abcdefghijklmnopq"; return scope.feedToken },
    },
    "../../../../lib/tracking/variant-index": variantIndex,
  }, { process: { env: { MEDUSA_BACKEND_URL: "https://api.new.florayn.com/" } } })

  const res = fakeRes()
  await route.GET({ scope: container, headers: {} }, res)
  assert.equal(res.headers["cache-control"], "private, no-store")
  assert.equal(res.body.feed_urls.meta, `https://api.new.florayn.com/feeds/${container.feedToken}/meta.tsv`)
  assert.equal(res.body.feed_urls.tiktok_gz, `https://api.new.florayn.com/feeds/${container.feedToken}/tiktok.tsv.gz`)
  assert.deepEqual(res.body.case_types.map((c) => c.slug), CASE_TYPES.map((c) => c.slug))
  assert.equal(res.body.images.sharp_installed, false)

  const bad = fakeRes()
  await route.POST({ scope: container, headers: {}, body: { action: "explode" } }, bad)
  assert.equal(bad.statusCode, 400)

  const rotate = fakeRes()
  await route.POST({ scope: container, headers: {}, body: { action: "rotate_token" } }, rotate)
  assert.equal(rotated.length, 1)
  assert.match(rotate.body.feed_urls.meta, /rotated-token/)

  const nothingHeld = fakeRes()
  await route.POST({ scope: container, headers: {}, body: { action: "publish_anyway" } }, nothingHeld)
  assert.equal(nothingHeld.statusCode, 409)

  const noSharp = fakeRes()
  await route.POST({ scope: container, headers: {}, body: { action: "convert_images" } }, noSharp)
  assert.equal(noSharp.statusCode, 409)
  assert.match(noSharp.body.message, /sharp/)
})
