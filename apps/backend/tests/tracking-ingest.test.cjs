// The ingest route for browser events (api/tracking/ingest/route.ts,
// lib/tracking/ingest.ts) and its body-size entry in api/middlewares.ts
// (TRACKING.md 4.3, 6.1, 2.4, B5, B6). The real contract, secret, settings,
// db, hash, adapters and outbox enqueue run; the variant index, the job kicks
// and scheduleFlush are stubbed, and Postgres is an in-memory fake that
// interprets the statements ingest issues, commits only when the
// transaction's callback resolves, and keys rows like the real tables.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const NOW = Date.UTC(2026, 8, 27, 8, 0, 0)
const T = NOW - 5_000
const SECRET = "0123456789abcdef0123456789abcdef"
const OLD_SECRET = "fedcba9876543210fedcba9876543210"
const HOST = "new.florayn.com"
const TEST_DATASET = "2247389409441720"
const LIVE_DATASET = "650439547920083"
const PIXEL = "CTESTPIXEL0000000001"

const V1 = "variant_01JABCDEFGHJKMNPQRST"
const V2 = "variant_01JZYXWVUTSRQPNMKJHG"
const V_PRICELESS = "variant_01JPRICELESS0000000"
const V_ZERO = "variant_01JZEROPRICE0000000"
const V_UNKNOWN = "variant_01JUNKNOWN000000000"
const INDEX = new Map([
  [V1, { price: 1400, sellable: true, handle: "zebra-stark", case_type: "Signature", device: "iPhone 17 Pro Max" }],
  [V2, { price: 750, sellable: true, handle: "airpods-bloom", case_type: "Signature Earbuds", device: "AirPods Pro 2" }],
  [V_PRICELESS, { price: null, sellable: false, handle: "draft-case", case_type: null, device: null }],
  [V_ZERO, { price: 0, sellable: false, handle: "free-thing", case_type: null, device: null }],
])

const IP = "103.4.145.2"
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) IngestTest"
const VID = "v1.1790467200.0123456789abcdef"
const CTX = {
  ip: IP, ua: UA, vid: VID, sid: "s1.1790467200.0a1b2c3d", src: "meta_paid", camp: "sept-sale",
  fbp: "fb.1.1790467200123.1234567890", fbc: "fb.1.1790467200123.IwAR0abcdef", ttp: "ttp-cookie-value",
  ttclid: "E.C.P.ttclid-value", gclid: null, gbraid: null, wbraid: null,
  country: "BD", device: "mobile", audience: "women", new: true, staff: false,
}

const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const plain = (value) => JSON.parse(JSON.stringify(value))
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex")
const key = (secret) => crypto.createHmac("sha256", secret).update("ingest-v1").digest("hex")
const uuid = () => crypto.randomUUID()
const icId = () => `ic-${crypto.randomBytes(12).toString("hex")}`

class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])) }
  static now() { return NOW }
}

// ---------------------------------------------------------------- loader

const env = {}
const calls = { fetch: 0, lookups: [], order: [] }

/**
 * Transpiles TS files into vm sandboxes. Relative imports load the real
 * neighbouring files unless `stubs` maps the specifier; bare imports must be stubbed.
 */
function makeLoader(stubs) {
  const cache = new Map()
  const globals = {
    console, URL, URLSearchParams, Buffer, AbortSignal, JSON, Date: FakeDate,
    process: { env },
    setTimeout, clearTimeout,
    fetch: async () => {
      calls.fetch += 1
      throw new Error("no vendor call may happen during ingest")
    },
  }
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, {
      exports, ...globals,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name]
        if (name === "node:crypto") return crypto
        if (name.startsWith(".")) return loadFile(path.resolve(path.dirname(filename), `${name}.ts`))
        throw new Error(`Unexpected import ${name} in ${filename}`)
      },
    }, { filename })
    return exports
  }
  return (file) => loadFile(path.join(SRC, file))
}

const FRAMEWORK = {
  "@medusajs/framework/utils": { ContainerRegistrationKeys: { PG_CONNECTION: "pg", LOGGER: "logger", QUERY: "query" } },
  "../../modules/tracking": { TRACKING_MODULE: "tracking" },
}
// The real WP03 enqueue (lib/tracking/outbox.ts), loaded on its own.
const realOutbox = makeLoader(FRAMEWORK)("lib/tracking/outbox.ts")

const load = makeLoader({
  ...FRAMEWORK,
  "./outbox": {
    enqueue: (...args) => realOutbox.enqueue(...args),
    scheduleFlush: () => { calls.order.push("scheduleFlush") },
  },
  "./jobs": { kickStaleJobs: () => { calls.order.push("kickStaleJobs") } },
  "./variant-index": {
    lookupVariants: async (_container, ids) => {
      calls.lookups.push([...ids])
      return new Map(ids.filter((id) => INDEX.has(id)).map((id) => [id, INDEX.get(id)]))
    },
  },
})
const contract = load("lib/tracking/contract.ts")
const settingsLib = load("lib/tracking/settings.ts")
const ingestLib = load("lib/tracking/ingest.ts")
const route = load("api/tracking/ingest/route.ts")

// ---------------------------------------------------------------- fakes

function config(patch = {}) {
  const base = plain(settingsLib.DEFAULT_CONFIG)
  base.meta.enabled = true
  base.tiktok.enabled = true
  base.tiktok.test_id = PIXEL
  for (const [name, value] of Object.entries(patch)) {
    base[name] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[name], ...value } : value
  }
  return base
}

const ALL_TOKENS = { meta: { test: true, live: true }, tiktok: { test: true, live: true } }

function view(patch = {}, tokenSet = ALL_TOKENS) {
  return { config: settingsLib.parseTrackingConfig(config(patch)), tokenSet, feedToken: null }
}

/** Postgres for the tables ingest writes. Statements outside a transaction are refused. */
class FakePg {
  constructor() {
    this.hits = new Map()
    this.events = new Map()
    this.counters = new Map()
    this.transactions = []
    this.fail = null
  }

  async raw(sql) {
    throw new Error(`statement outside a transaction: ${squash(sql)}`)
  }

  async transaction(fn) {
    const staged = { hits: new Map(this.hits), events: new Map(this.events), counters: new Map(this.counters) }
    const record = { statements: [], committed: false }
    this.transactions.push(record)
    const trx = {
      raw: async (sql, bindings = []) => {
        const text = squash(sql)
        record.statements.push({ sql: text, bindings })
        if (this.fail && this.fail(text)) {
          // Like knex: the message quotes the statement with its values.
          const error = new Error(`${text} - ${JSON.stringify(bindings)} - canceling statement due to statement timeout`)
          error.code = "57014"
          throw error
        }
        return this.apply(staged, text, bindings)
      },
    }
    const result = await fn(trx)
    Object.assign(this, staged)
    record.committed = true
    calls.order.push("commit")
    return result
  }

  apply(staged, sql, bindings) {
    if (/^set local statement_timeout = '5s'$/i.test(sql)) return {}
    const match = sql.match(/^insert into (\w+) \(([^)]*)\) values/)
    if (!match) throw new Error(`unexpected statement: ${sql}`)
    const columns = match[2].split(",").map((column) => column.trim())
    let rowCount = 0
    for (let i = 0; i < bindings.length; i += columns.length) {
      const row = Object.fromEntries(columns.map((column, at) => [column, bindings[i + at]]))
      if (match[1] === "tracking_hit") {
        assert.match(sql, /on conflict \(event_name, event_id\) do nothing$/)
        const id = `${row.event_name}|${row.event_id}`
        if (!staged.hits.has(id)) { staged.hits.set(id, row); rowCount += 1 }
      } else if (match[1] === "tracking_event") {
        assert.match(sql, /on conflict \(platform, event_name, event_id\) do nothing$/)
        const id = `${row.platform}|${row.event_name}|${row.event_id}`
        if (!staged.events.has(id)) {
          staged.events.set(id, { ...row, payload: row.payload === null ? null : JSON.parse(row.payload) })
          rowCount += 1
        }
      } else if (match[1] === "tracking_counter") {
        staged.counters.set(row.key, (staged.counters.get(row.key) ?? 0) + row.n)
        rowCount += 1
      } else {
        throw new Error(`unexpected table ${match[1]}`)
      }
    }
    return { rowCount }
  }

  rows(platform) {
    return [...this.events.values()].filter((row) => !platform || row.platform === platform)
  }
}

function setup({ patch = {}, tokens = { meta_test_token: "EAAtest", tiktok_test_token: "tt-test" } } = {}) {
  const pg = new FakePg()
  const logs = []
  const row = { id: "trackset_default", config: config(patch), catalog_feed_token: null, ...tokens }
  const container = {
    resolve(name) {
      if (name === "pg") return pg
      if (name === "tracking") return { listTrackingSettings: async () => [row] }
      if (name === "logger") return { warn: (message) => logs.push(message), error: (message) => logs.push(message) }
      throw new Error(`unexpected resolve ${name}`)
    },
  }
  settingsLib.invalidateTrackingSettings()
  calls.order.length = 0
  return { pg, logs, container }
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = plain(body); return this },
  }
}

/** POSTs through the route handler; a null header sends none. */
async function post(container, body, header = key(SECRET)) {
  const res = fakeRes()
  const headers = header === null ? {} : { "x-florayn-ingest-key": header }
  await route.POST({ headers, body, scope: container }, res)
  return res
}

// ---------------------------------------------------------------- events

const PRODUCT_PATH = "/product/zebra-stark/?case=signature"

function pageView(d = { first: true }, p = PRODUCT_PATH) {
  return { n: "PageView", id: uuid(), t: T, p, d }
}

function viewContent(items = [{ id: V1, q: 1, price: 1 }], d = {}) {
  return {
    n: "ViewContent", id: uuid(), t: T, p: PRODUCT_PATH,
    d: { items, value: 1400, currency: "BDT", handle: "browser-handle", device: "Browser Device", case_type: "Browser Type", primary: true, ...d },
  }
}

function addToCart(items = [{ id: V1, q: 2, price: 5 }], value = 99999) {
  return { n: "AddToCart", id: uuid(), t: T, p: PRODUCT_PATH, d: { items, value, currency: "BDT" } }
}

function initiateCheckout(items = [{ id: V1, q: 1, price: 1400 }, { id: V2, q: 2, price: 750 }], d = {}) {
  return { n: "InitiateCheckout", id: icId(), t: T, p: "/checkout/", d: { items, value: 2900, currency: "BDT", num_items: 3, ...d } }
}

function envelope(events, ctx = {}, extra = {}) {
  return { v: 1, batches: [{ host: HOST, ctx: { ...CTX, ...ctx }, events }], ...extra }
}

/** buildRows on one batch as parseIngestEnvelope hands it over. */
function build(events, { ctx = {}, host = HOST, settings = view(), now = NOW } = {}) {
  const parsed = contract.parseIngestEnvelope({ v: 1, batches: [{ host, ctx: { ...CTX, ...ctx }, events }] })
  assert.ok(parsed, "the envelope parses")
  return plain(ingestLib.buildRows(settings, INDEX, parsed.batches[0], now))
}

/** tracking_hit.flags bits (TRACKING.md 2.4). */
const FLAGS = { PRIMARY: 1, VARIANT_SWITCH: 2, INTERNAL: 8, NEW_VISITOR: 16, FIRST_PAGEVIEW: 32, UNKNOWN_VARIANT: 64 }

// ---------------------------------------------------------------- the middleware entry

function middlewareEntries() {
  const loadMiddlewares = makeLoader({
    "@medusajs/framework/http": { authenticate: () => () => undefined, defineMiddlewares: (config) => config },
    "../lib/revalidate-storefront": { queueStorefrontRevalidation: async () => undefined },
    "../lib/storefront-write-domains": { storefrontWriteTags: () => [] },
  })
  return loadMiddlewares("api/middlewares.ts").default.routes
}

test("middlewares.ts has exactly one /tracking/ingest entry: POST with a 512 KB body limit", () => {
  const entries = middlewareEntries().filter((entry) => entry.matcher === "/tracking/ingest")
  assert.equal(entries.length, 1)
  assert.deepEqual(plain(entries[0]), { matcher: "/tracking/ingest", method: ["POST"], bodyParser: { sizeLimit: "512kb" } })
})

// ---------------------------------------------------------------- key and envelope

test("a missing, wrong or unconfigured ingest key gives 401 and touches nothing", async () => {
  const { pg, container } = setup()
  const lookups = calls.lookups.length
  env.TRACKING_INGEST_SECRET = SECRET
  delete env.TRACKING_INGEST_SECRET_PREVIOUS
  const body = envelope([viewContent()])

  for (const header of [null, "", key("another-secret-of-at-least-32-chars"), [key(SECRET), key(SECRET)]]) {
    const res = await post(container, body, header)
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, {})
    assert.equal(res.headers["cache-control"], "no-store")
  }

  // An unset or short secret fails closed, even for the key it would derive.
  delete env.TRACKING_INGEST_SECRET
  assert.equal((await post(container, body, key(SECRET))).statusCode, 401)
  env.TRACKING_INGEST_SECRET = "short"
  assert.equal((await post(container, body, key("short"))).statusCode, 401)
  assert.equal(pg.transactions.length, 0)
  assert.equal(calls.lookups.length, lookups, "nothing is read before the key is checked")
})

test("the previous secret's key is accepted while rotating", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  env.TRACKING_INGEST_SECRET_PREVIOUS = OLD_SECRET
  const res = await post(container, envelope([viewContent()]), key(OLD_SECRET))
  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.body, { accepted: 1 })
  assert.equal(pg.hits.size, 1)
  delete env.TRACKING_INGEST_SECRET_PREVIOUS
})

test("malformed envelopes and more than 200 events give 400", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  const many = Array.from({ length: 201 }, () => pageView({}))
  const bad = [
    undefined, null, "text", [], { v: 2, batches: [] }, { v: 1 }, { v: 1, batches: {} },
    { v: 1, batches: [{ host: HOST, events: [] }] },
    { v: 1, batches: [{ ctx: CTX, events: [] }] },
    { v: 1, batches: [{ host: HOST, ctx: CTX, events: "x" }] },
    { v: 1, stats: { "sf.untrusted": -1 }, batches: [] },
    { v: 1, stats: { "Bad Key": 1 }, batches: [] },
    envelope(many),
    { v: 1, batches: [{ host: HOST, ctx: CTX, events: many.slice(0, 150) }, { host: HOST, ctx: CTX, events: many.slice(150) }] },
  ]
  for (const body of bad) {
    const res = await post(container, body)
    assert.equal(res.statusCode, 400, JSON.stringify(body)?.slice(0, 80))
    assert.deepEqual(res.body, {})
  }
  assert.equal(pg.transactions.length, 0)
  assert.equal((await post(container, envelope(many.slice(0, 200)))).statusCode, 202, "exactly 200 is fine")
})

// ---------------------------------------------------------------- per event checks

test("a batch for a host that is not allowlisted is dropped whole", () => {
  const rows = build([pageView(), viewContent()], { host: "evil.example.com" })
  assert.deepEqual(rows.hits, [])
  assert.deepEqual(rows.outbox, [])
  assert.deepEqual(rows.counters, { "ingest.unknown_host": 2 })
})

test("Purchase, other server names, private paths and non-variant ids are rejected per event", () => {
  const good = viewContent()
  const rows = build([
    { ...viewContent(), n: "Purchase", id: "fl-1234" },
    { ...viewContent(), n: "OrderConfirmed", id: "oc-fl-1234" },
    { ...pageView(), p: "/order/order_01ABCDEF/" },
    { ...pageView(), p: "/men/account/" },
    { ...pageView(), p: "/review/x/?r=token" },
    viewContent([{ id: "prod_01JABCDEFGHJKMNPQRST", q: 1, price: 1 }]),
    viewContent([{ id: "12345", q: 1, price: 1 }]),
    { ...viewContent(), id: "not-a-uuid" },
    { ...initiateCheckout(), id: uuid() },
    good,
  ])
  assert.deepEqual(rows.hits.map((hit) => hit.event_id), [good.id])
  assert.equal(rows.counters["ingest.invalid"], 9)
})

test("events outside [now - 15 min, now + 1 min] are dropped", () => {
  const at = (t) => ({ ...pageView(), t })
  const kept = [at(NOW - 14 * 60_000), at(NOW + 30_000), at(NOW - 15 * 60_000), at(NOW + 60_000)]
  const dropped = [at(NOW - 15 * 60_000 - 1), at(NOW + 60_001), at(NOW - 86_400_000)]
  const rows = build([...kept, ...dropped])
  assert.deepEqual(rows.hits.map((hit) => hit.event_id).sort(), kept.map((event) => event.id).sort())
  assert.equal(rows.counters["ingest.invalid"], 3)
  const metaTimes = rows.outbox.filter((row) => row.platform === "meta").map((row) => Date.parse(row.event_time))
  assert.deepEqual(metaTimes.sort(), kept.map((event) => event.t).sort(), "event_time is the event's own time")
})

// ---------------------------------------------------------------- prices

test("item prices come from the variant index and the value is clamped", () => {
  const over = addToCart([{ id: V1, q: 2, price: 5 }], 99999)
  const under = addToCart([{ id: V1, q: 2, price: 5000 }], 500)
  const pack = addToCart([{ id: V1, q: 1, price: 0 }, { id: V2, q: 3, price: 0 }], 4000)
  const rows = build([over, under, pack])
  const hit = (event) => rows.hits.find((row) => row.event_id === event.id)
  const meta = (event) => rows.outbox.find((row) => row.platform === "meta" && row.event_id === event.id).payload
  const tiktok = (event) => rows.outbox.find((row) => row.platform === "tiktok" && row.event_id === event.id).payload

  assert.equal(hit(over).value, 2800, "min(client value, 1400 x 2)")
  assert.equal(hit(under).value, 500, "a lower client value stands")
  assert.equal(hit(pack).value, 3650, "1400 + 750 x 3")
  assert.equal(hit(pack).items, 4)
  assert.deepEqual(meta(over).custom_data.contents, [{ id: V1, quantity: 2, item_price: 1400 }])
  assert.equal(meta(over).custom_data.value, 2800)
  assert.deepEqual(meta(pack).custom_data.contents, [
    { id: V1, quantity: 1, item_price: 1400 },
    { id: V2, quantity: 3, item_price: 750 },
  ])
  assert.deepEqual(tiktok(under).properties.contents, [{ content_id: V1, quantity: 2, price: 1400 }])
  assert.equal(tiktok(under).properties.value, 500)
})

test("an unknown or priceless variant flags the hit 64, counts, and sends nothing for that event", () => {
  const mixed = addToCart([{ id: V1, q: 1, price: 1400 }, { id: V_UNKNOWN, q: 1, price: 900 }], 2300)
  const priceless = viewContent([{ id: V_PRICELESS, q: 1, price: 999 }])
  const zero = viewContent([{ id: V_ZERO, q: 1, price: 999 }])
  const known = viewContent()
  const rows = build([mixed, priceless, zero, known])
  const hit = (event) => rows.hits.find((row) => row.event_id === event.id)

  for (const event of [mixed, priceless, zero]) {
    assert.equal(hit(event).flags & FLAGS.UNKNOWN_VARIANT, FLAGS.UNKNOWN_VARIANT)
    assert.equal(rows.outbox.filter((row) => row.event_id === event.id).length, 0)
  }
  assert.equal(hit(mixed).value, 1400, "only known items bound the value")
  assert.equal(hit(priceless).value, 0)
  assert.equal(hit(known).flags & FLAGS.UNKNOWN_VARIANT, 0)
  assert.equal(rows.counters["ingest.unknown_variant"], 3)
  assert.deepEqual(rows.outbox.filter((row) => row.event_id === known.id).map((row) => row.platform), ["meta", "tiktok"])
})

// ---------------------------------------------------------------- hits

test("hits carry the flags, the index's product facts and never an IP or user agent", () => {
  const first = pageView({ first: true }, "/collections/women/?case=signature")
  const routeChange = pageView({})
  const primary = viewContent(undefined, { primary: true })
  const variantSwitch = viewContent([{ id: V2, q: 1, price: 750 }], { primary: false })
  const unlabelled = viewContent([{ id: V_UNKNOWN, q: 1, price: 1 }], { primary: undefined })
  const rows = build([first, routeChange, primary, variantSwitch, unlabelled], { ctx: { new: false } })
  const hit = (event) => rows.hits.find((row) => row.event_id === event.id)

  assert.equal(hit(first).flags, FLAGS.FIRST_PAGEVIEW)
  assert.equal(hit(first).path, "/collections/women/", "pathname only")
  assert.equal(hit(routeChange).flags, 0)
  assert.equal(hit(primary).flags, FLAGS.PRIMARY)
  assert.equal(hit(variantSwitch).flags, FLAGS.VARIANT_SWITCH)
  assert.equal(hit(unlabelled).flags, FLAGS.UNKNOWN_VARIANT)

  assert.deepEqual(hit(primary), {
    event_name: "ViewContent", event_id: primary.id, origin: "b",
    visitor_id: VID, session_id: CTX.sid, source: "meta_paid", campaign: "sept-sale",
    device_class: "mobile", audience: "women", host: HOST, path: "/product/zebra-stark/",
    handle: "zebra-stark", variant_id: V1, device: "iPhone 17 Pro Max", case_type: "Signature",
    value: 1400, items: 1, country: "BD", flags: FLAGS.PRIMARY,
  })
  // An id the index does not know keeps what the browser reported.
  assert.equal(hit(unlabelled).handle, "browser-handle")
  assert.equal(hit(unlabelled).case_type, "Browser Type")
  assert.equal(hit(routeChange).value, null)
  assert.equal(hit(routeChange).items, null)

  const withNew = build([pageView()], { ctx: { new: true, country: null } }).hits[0]
  assert.equal(withNew.flags, FLAGS.FIRST_PAGEVIEW | FLAGS.NEW_VISITOR)
  assert.equal(withNew.country, null)

  const text = JSON.stringify(rows.hits)
  assert.ok(!text.includes(IP) && !text.includes(UA) && !text.includes(CTX.fbp) && !text.includes(CTX.ttclid))
})

test("staff traffic is recorded as internal and never reaches an ad platform", () => {
  const events = [pageView(), viewContent(), addToCart(), initiateCheckout()]
  const rows = build(events, { ctx: { staff: true } })
  assert.equal(rows.hits.length, 4)
  for (const hit of rows.hits) assert.equal(hit.flags & FLAGS.INTERNAL, FLAGS.INTERNAL)
  assert.deepEqual(rows.outbox, [])
  assert.deepEqual(rows.counters, {})
})

test("opted-out traffic, if it ever arrives, keeps no ids and sends nothing", () => {
  const ic = initiateCheckout()
  const rows = build([pageView(), viewContent(), ic], { ctx: { optout: true } })
  assert.equal(rows.hits.length, 3)
  for (const hit of rows.hits) {
    assert.equal(hit.visitor_id, null)
    assert.equal(hit.session_id, null)
  }
  assert.equal(rows.hits[2].event_id, ic.id, "no session to key an InitiateCheckout hit by")
  assert.deepEqual(rows.outbox, [])
})

test("an InitiateCheckout hit is keyed by its cart id and the session; its outbox rows keep the cart id", () => {
  const ic = initiateCheckout()
  const vc = viewContent()
  const rows = build([ic, vc])
  assert.deepEqual(rows.hits.map((hit) => hit.event_id), [`${ic.id}:${CTX.sid}`, vc.id], "other events keep their own id")
  assert.deepEqual(rows.outbox.filter((row) => row.event_name === "InitiateCheckout").map((row) => [row.platform, row.event_id, row.payload.event_id]),
    [["meta", ic.id, ic.id], ["tiktok", ic.id, ic.id]])
  assert.equal(ingestLib.hitEventId({ n: "InitiateCheckout", id: ic.id }, null), ic.id)
  assert.equal(ingestLib.hitEventId({ n: "AddToCart", id: vc.id }, "s9"), vc.id)
})

test("the same cart's checkout in a later session records a second hit but queues nothing new for the ad platforms", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  const ic = initiateCheckout()
  assert.deepEqual((await post(container, envelope([ic]))).body, { accepted: 1 })
  assert.deepEqual((await post(container, envelope([plain(ic)]))).body, { accepted: 1 })
  assert.equal(pg.hits.size, 1, "a reload in the same session is still one checkout")
  assert.equal(pg.rows().length, 2)
  calls.order.length = 0

  const later = "s2.1790470800.0a1b2c3e"
  assert.deepEqual((await post(container, envelope([plain(ic)], { sid: later }))).body, { accepted: 1 })
  assert.deepEqual([...pg.hits.values()].map((hit) => [hit.event_id, hit.session_id]), [
    [`${ic.id}:${CTX.sid}`, CTX.sid],
    [`${ic.id}:${later}`, later],
  ], "each session's funnel gets its InitiateCheckout")
  assert.deepEqual(pg.rows().map((row) => `${row.platform}:${row.event_id}`), [`meta:${ic.id}`, `tiktok:${ic.id}`],
    "Meta and TikTok still get the cart's checkout once")
  assert.deepEqual(calls.order, ["commit", "kickStaleJobs"], "nothing new to send")
})

// ---------------------------------------------------------------- outbox rows

test("Meta gets both PageView kinds and VC/ATC/IC; TikTok gets VC/ATC/IC only", () => {
  const first = pageView({ first: true })
  const routeChange = pageView({})
  const vc = viewContent()
  const atc = addToCart()
  const ic = initiateCheckout()
  const rows = build([first, routeChange, vc, atc, ic])
  const summary = rows.outbox.map((row) => `${row.platform}:${row.event_name}:${row.event_id}`)
  assert.deepEqual(summary, [
    `meta:PageView:${first.id}`,
    `meta:PageView:${routeChange.id}`,
    `meta:ViewContent:${vc.id}`, `tiktok:ViewContent:${vc.id}`,
    `meta:AddToCart:${atc.id}`, `tiktok:AddToCart:${atc.id}`,
    `meta:InitiateCheckout:${ic.id}`, `tiktok:InitiateCheckout:${ic.id}`,
  ])
  for (const row of rows.outbox) {
    assert.equal(row.source, "browser")
    assert.equal(row.env, "test")
    assert.equal(row.destination, row.platform === "meta" ? TEST_DATASET : PIXEL)
    assert.equal(row.status, undefined, "pending by default")
    assert.equal(row.payload.event_id, row.event_id, "the browser copy shares the id")
  }
  assert.deepEqual(rows.counters, {})
})

test("Meta and TikTok payloads are the WP02 builders' output for the event", () => {
  const vc = viewContent()
  const ic = initiateCheckout()
  const rows = build([vc, ic])
  const find = (platform, event) => rows.outbox.find((row) => row.platform === platform && row.event_id === event.id).payload
  const externalId = sha(VID)

  const metaVc = find("meta", vc)
  assert.deepEqual(metaVc, {
    event_name: "ViewContent",
    event_time: Math.floor(T / 1000),
    event_id: vc.id,
    action_source: "website",
    user_data: {
      client_ip_address: IP, client_user_agent: UA, fbp: CTX.fbp, fbc: CTX.fbc,
      external_id: [externalId], country: [sha("bd")],
    },
    opt_out: false,
    event_source_url: `https://${HOST}${PRODUCT_PATH}`,
    custom_data: {
      content_type: "product", content_ids: [V1], contents: [{ id: V1, quantity: 1, item_price: 1400 }],
      value: 1400, currency: "BDT",
    },
  })
  assert.equal(find("meta", ic).custom_data.num_items, 3)
  assert.equal(find("meta", ic).event_source_url, `https://${HOST}/checkout/`)

  const tiktokVc = find("tiktok", vc)
  assert.deepEqual(tiktokVc, {
    event: "ViewContent",
    event_time: Math.floor(T / 1000),
    event_id: vc.id,
    user: { external_id: externalId, ttclid: CTX.ttclid, ttp: CTX.ttp, ip: IP, user_agent: UA },
    properties: { currency: "BDT", value: 1400, content_type: "product", contents: [{ content_id: V1, quantity: 1, price: 1400 }] },
    page: { url: `https://${HOST}${PRODUCT_PATH}` },
  })
  assert.equal(find("tiktok", ic).properties.num_items, 3)
})

test("no row without a destination; an enabled platform without an id counts ingest.no_destination", () => {
  const events = [pageView(), viewContent()]
  const off = build(events, { settings: view({ meta: { enabled: false }, tiktok: { enabled: false } }) })
  assert.equal(off.hits.length, 2)
  assert.deepEqual(off.outbox, [])
  assert.deepEqual(off.counters, {}, "a platform switched off is not an anomaly")

  const noPixel = build(events, { settings: view({ tiktok: { enabled: true, test_id: "" } }) })
  assert.deepEqual(noPixel.outbox.map((row) => row.platform), ["meta", "meta"])
  assert.deepEqual(noPixel.counters, { "ingest.no_destination": 1 })
})

test("a missing token drops the rows and counts ingest.no_token_dropped", () => {
  const tokens = { meta: { test: false, live: true }, tiktok: { test: true, live: true } }
  const rows = build([pageView(), viewContent()], { settings: view({}, tokens) })
  assert.deepEqual(rows.outbox.map((row) => `${row.platform}:${row.event_name}`), ["tiktok:ViewContent"])
  assert.deepEqual(rows.counters, { "ingest.no_token_dropped": 2 })
})

test("Meta needs a user agent; TikTok still gets its copy", () => {
  const rows = build([pageView(), viewContent()], { ctx: { ua: null } })
  assert.deepEqual(rows.outbox.map((row) => `${row.platform}:${row.event_name}`), ["tiktok:ViewContent"])
  assert.equal(rows.hits.length, 2)
})

test("live hosts route by live_armed: TEST while disarmed, the live dataset once armed", () => {
  const disarmed = build([viewContent()], { host: "florayn.com" })
  assert.deepEqual(disarmed.outbox.map((row) => `${row.env}:${row.destination}`), [`test:${TEST_DATASET}`, `test:${PIXEL}`])
  assert.equal(disarmed.outbox[0].payload.event_source_url, `https://florayn.com${PRODUCT_PATH}`)

  const armed = build([viewContent()], {
    host: "www.florayn.com",
    settings: view({ live_armed: true }, { meta: { test: true, live: true }, tiktok: { test: true, live: false } }),
  })
  assert.deepEqual(armed.outbox.map((row) => `${row.platform}:${row.env}:${row.destination}`), [`meta:live:${LIVE_DATASET}`])
  assert.deepEqual(armed.counters, { "ingest.no_token_dropped": 1 })
})

test("the same event twice in a batch is recorded once", () => {
  const event = viewContent()
  const rows = build([event, event])
  assert.equal(rows.hits.length, 1)
  assert.equal(rows.outbox.length, 2)
})

// ---------------------------------------------------------------- the route end to end

test("hits, outbox rows and counters are written in ONE transaction with a 5 s statement timeout", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  calls.fetch = 0
  const vc = viewContent()
  const unknown = viewContent([{ id: V_UNKNOWN, q: 1, price: 1 }])
  const body = envelope([pageView(), vc, unknown], {}, { stats: { "sf.untrusted": 3, "sf.forward_failed": 2 } })
  const res = await post(container, body)

  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.body, { accepted: 3 })
  assert.equal(res.headers["cache-control"], "no-store")
  assert.equal(pg.transactions.length, 1)
  const [tx] = pg.transactions
  assert.ok(tx.committed)
  assert.deepEqual(tx.statements.map((s) => s.sql.split(" (")[0]), [
    "SET LOCAL statement_timeout = '5s'",
    "insert into tracking_hit",
    "insert into tracking_event",
    "insert into tracking_counter",
  ])
  assert.equal(pg.hits.size, 3)
  assert.deepEqual(pg.rows().map((row) => `${row.platform}:${row.event_name}`), ["meta:PageView", "meta:ViewContent", "tiktok:ViewContent"])
  assert.deepEqual(Object.fromEntries(pg.counters), { "ingest.unknown_variant": 1, "sf.untrusted": 3, "sf.forward_failed": 2 })
  for (const row of pg.rows()) {
    assert.equal(row.status, "pending")
    assert.equal(row.source, "browser")
  }
  const hitBindings = JSON.stringify(tx.statements[1].bindings)
  assert.ok(!hitBindings.includes(IP) && !hitBindings.includes(UA), "tracking_hit never gets the IP or user agent")

  // 202 comes back before any vendor call: the flush is only scheduled, after the commit.
  assert.equal(calls.fetch, 0)
  assert.deepEqual(calls.order, ["commit", "scheduleFlush", "kickStaleJobs"])
  assert.deepEqual(calls.lookups.at(-1).sort(), [V1, V_UNKNOWN].sort(), "one index lookup for the envelope")
})

test("resending the same envelope creates no duplicate hits or outbox rows", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  const body = envelope([pageView(), viewContent(), addToCart(), initiateCheckout()])
  assert.deepEqual((await post(container, body)).body, { accepted: 4 })
  const hits = pg.hits.size
  const events = pg.rows().length
  assert.equal(events, 7)
  calls.order.length = 0

  assert.deepEqual((await post(container, plain(body))).body, { accepted: 4 })
  assert.equal(pg.hits.size, hits)
  assert.equal(pg.rows().length, events)
  assert.deepEqual(calls.order, ["commit", "kickStaleJobs"], "nothing new to send, so no flush")
})

test("a stats-only envelope bumps the storefront counters; other keys are ignored", async () => {
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  const body = {
    v: 1,
    stats: { "sf.untrusted": 60, "sf.rate_dropped": 0, "sf.bot": 4, "checkout.header_rejected": 1, "outbox.failed.meta.live": 9 },
    batches: [],
  }
  const res = await post(container, body)
  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.body, { accepted: 0 })
  assert.deepEqual(Object.fromEntries(pg.counters), { "sf.untrusted": 60, "sf.bot": 4 })
  assert.equal(pg.hits.size, 0)
  assert.deepEqual(calls.order, ["commit", "kickStaleJobs"])

  const empty = setup()
  assert.deepEqual((await post(empty.container, { v: 1, batches: [] })).body, { accepted: 0 })
  assert.equal(empty.pg.transactions.length, 0, "nothing to write, no transaction")
})

test("a failed write commits nothing, answers 503 and logs no values", async () => {
  const { pg, container, logs } = setup()
  env.TRACKING_INGEST_SECRET = SECRET
  pg.fail = (sql) => sql.startsWith("insert into tracking_counter")
  const res = await post(container, envelope([pageView(), viewContent([{ id: V_UNKNOWN, q: 1, price: 1 }])]))
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, {})
  assert.equal(pg.transactions.length, 1)
  assert.equal(pg.transactions[0].committed, false)
  assert.equal(pg.hits.size, 0, "the hit insert rolled back")
  assert.equal(pg.rows().length, 0, "the outbox insert rolled back")
  assert.ok(!calls.order.includes("scheduleFlush"))
  assert.deepEqual(logs, ["[tracking] ingest failed: 57014"])
})

test("a 64 KB batch is accepted end to end through the 512 KB body parser; 600 KB gives 413", async () => {
  const express = require("express")
  const entry = middlewareEntries().find((item) => item.matcher === "/tracking/ingest")
  const { pg, container } = setup()
  env.TRACKING_INGEST_SECRET = SECRET

  const app = express()
  // Medusa's json body parser is express.json({ limit: sizeLimit }) for the matching entry.
  app.post(entry.matcher, express.json({ limit: entry.bodyParser.sizeLimit }), (req, res) => {
    req.scope = container
    return route.POST(req, res)
  })
  // Like Medusa's error handler, answer with the parser's status (413) instead of logging a stack.
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({}))
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)) })
  const url = `http://127.0.0.1:${server.address().port}${entry.matcher}`
  const send = (text) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-florayn-ingest-key": key(SECRET) },
    body: text,
  })

  try {
    const items = [V1, V2, V1, V2, V1, V2].map((id, i) => ({ id, q: i + 1, price: 1 }))
    const events = []
    let text = ""
    while (Buffer.byteLength(text) < 64 * 1024) {
      events.push(addToCart(items, 5000))
      text = JSON.stringify(envelope(events))
    }
    assert.ok(events.length <= 200)
    const ok = await send(text)
    assert.equal(ok.status, 202)
    assert.deepEqual(await ok.json(), { accepted: events.length })
    assert.equal(pg.hits.size, events.length)
    assert.equal(pg.rows().length, events.length * 2)

    // What the forwarder may send (up to 256 KB) is over the 100 KB default but under the entry.
    const wide = Array.from({ length: 20 }, (_, i) => ({ id: i % 2 ? V1 : V2, q: 1, price: 1 }))
    const bigEvents = Array.from({ length: 180 }, () => addToCart(wide, 1))
    const big = JSON.stringify(envelope(bigEvents))
    assert.ok(Buffer.byteLength(big) > 200 * 1024 && Buffer.byteLength(big) < 256 * 1024)
    assert.equal((await send(big)).status, 202)

    const huge = JSON.stringify({ ...envelope([]), pad: "x".repeat(600 * 1024) })
    assert.equal((await send(huge)).status, 413)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("no vendor was called anywhere in this file", () => {
  assert.equal(calls.fetch, 0)
})
