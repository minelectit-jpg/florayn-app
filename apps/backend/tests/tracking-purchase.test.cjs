// Purchase capture at checkout (TRACKING.md 4.4, 6.1, 6.5, 6.6; WP05): the
// checkout tracking header, the order-event rows and Purchase block, the one
// transaction in recordPurchase, the two checkout workflow steps, the
// /store/checkout route and the reconcile job. Source files are transpiled
// into vm sandboxes; the tracking tables live in an in-memory fake that
// interprets the statements these files issue.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const STOREFRONT_SRC = path.join(__dirname, "../../storefront/src")
const SECRET = "0123456789abcdef0123456789abcdef"
const KEY = crypto.createHmac("sha256", SECRET).update("ingest-v1").digest("hex")
const DATASET = "2247389409441720"
const LIVE_DATASET = "650439547920083"
const PIXEL = "CTESTPIXEL0000000001"
const ORDER_ID = "order_01JTESTORDER0000000000001"
const CART_ID = "cart_01JTESTCART00000000000001"
const VARIANT = "variant_01JTESTVARIANT000000001"
const VID = "v1.1790467200.0123456789abcdef"
const SID = "s1.1790467200.01234567"
const DAY = 86_400_000
const CREATED = new Date(Date.now() - 60_000).toISOString()

const plain = (value) => JSON.parse(JSON.stringify(value))
const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex")
const unix = (value) => Math.floor(new Date(value).getTime() / 1000)
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
const tick = async (times = 5) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)) }
const lf = (text) => text.replace(/\r\n/g, "\n")

const compiled = new Map()
function compile(filename) {
  if (!compiled.has(filename)) {
    compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText)
  }
  return compiled.get(filename)
}

/**
 * Loads TS files into vm sandboxes. Relative imports load the real
 * neighbouring files unless `stubs` maps the specifier; bare imports must be stubbed.
 */
function makeLoader(stubs = {}, globals = {}, root = SRC) {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(compile(filename), {
      exports, console, URL, Buffer, setTimeout, clearTimeout, setImmediate, process: { env: {} }, ...globals,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name]
        if (name === "node:crypto") return crypto
        if (name.startsWith(".")) return loadFile(path.resolve(path.dirname(filename), `${name}.ts`))
        throw new Error(`Unexpected import ${name} in ${filename}`)
      },
    }, { filename })
    return exports
  }
  return (file) => loadFile(path.join(root, file))
}

const utils = { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query", LOGGER: "logger" } }
const settingsLib = makeLoader({ "@medusajs/framework/utils": utils, "../../modules/tracking": { TRACKING_MODULE: "tracking" } })("lib/tracking/settings.ts")
const storefrontContract = makeLoader({}, {}, STOREFRONT_SRC)("lib/tracking/contract.ts")

/** DEFAULT_CONFIG with Meta on (the owner's first platform), plus a one-level-deep patch. */
function config(patch = {}) {
  const base = plain(settingsLib.DEFAULT_CONFIG)
  base.meta.enabled = true
  for (const [key, value] of Object.entries(patch)) {
    base[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[key], ...value } : value
  }
  return base
}

function view(cfg = config(), tokens = { meta: { test: true, live: true }, tiktok: { test: true, live: true } }) {
  return { config: cfg, tokenSet: tokens, feedToken: null }
}

function order(patch = {}) {
  return {
    id: ORDER_ID, display_id: 1234, created_at: CREATED, total: 1473,
    currency_code: "bdt", email: "Buyer@Example.com", is_draft_order: false,
    items: [{ variant_id: VARIANT, quantity: 1, unit_price: 1400, title: "Zebra Stark" }],
    shipping_address: { first_name: "Md", last_name: "Shamim", phone: "01712345678", province: "Dhaka" },
    metadata: { customer_phone: "01712345678", district: "Dhaka" },
    ...patch,
  }
}

function ctx(patch = {}) {
  return {
    v: 1, host: "new.florayn.com", page_url: "https://new.florayn.com/checkout/", edge: true,
    ip: "203.0.113.7", ua: "Mozilla/5.0 Test", vid: VID, sid: SID, src: "meta_paid", camp: "sept",
    fbp: "fb.1.1790467200000.123456789", fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null, wbraid: null,
    country: "BD", device: "mobile", audience: "women", new: true, staff: false, optout: false, consent_version: 1,
    ...patch,
  }
}

const HIT_COLUMNS = ["event_name", "event_id", "origin", "visitor_id", "session_id", "source", "campaign",
  "device_class", "audience", "host", "path", "handle", "variant_id", "device", "case_type", "value", "items",
  "country", "flags"]
const OUTBOX_COLUMNS = ["platform", "env", "destination", "event_name", "event_id", "event_time", "source",
  "order_id", "payload", "status", "last_error"]
const TABLES = ["cartContexts", "orderContexts", "hits", "events", "orderOps"]

function jsonb(value) {
  return value == null ? null : JSON.parse(value)
}

/** The tracking tables and order_op in memory; `raw` interprets the statements WP05 issues. */
class FakeDb {
  constructor() {
    this.cartContexts = new Map()
    this.orderContexts = new Map()
    this.hits = new Map()
    this.events = new Map()
    this.orderOps = new Map()
    this.counters = {}
    this.statements = []
    this.transactions = 0
    this.failOn = null
    this.hang = null
  }

  async transaction(fn) {
    const saved = Object.fromEntries(TABLES.map((table) => [table, new Map([...this[table]].map(([k, v]) => [k, { ...v }]))]))
    this.transactions += 1
    try {
      return await fn({ raw: (sql, bindings) => this.raw(sql, bindings) })
    } catch (error) {
      for (const table of TABLES) this[table] = saved[table]
      throw error
    }
  }

  insertRows(bindings, columns, keyOf, table, fix) {
    let inserted = 0
    for (let i = 0; i < bindings.length; i += columns.length) {
      const row = Object.fromEntries(columns.map((column, j) => [column, bindings[i + j]]))
      if (fix) fix(row)
      const key = keyOf(row)
      if (table.has(key)) continue
      table.set(key, row)
      inserted += 1
    }
    return inserted
  }

  async raw(sql, bindings = []) {
    const s = squash(sql)
    this.statements.push(s)
    if (this.hang && this.hang.test(s)) return new Promise(() => {})
    if (this.failOn && this.failOn.test(s)) throw Object.assign(new Error("injected failure with 01712345678"), { code: "57014" })
    const now = Date.now()
    if (s === "set local statement_timeout = '5s'") return { rows: [] }
    if (s.startsWith("insert into tracking_cart_context")) {
      const [cart_id, context] = bindings
      const old = this.cartContexts.get(cart_id)
      this.cartContexts.set(cart_id, { cart_id, context: jsonb(context), created_at: old?.created_at ?? now, updated_at: now })
      return { rowCount: 1 }
    }
    if (s === "select context from tracking_cart_context where cart_id = ?") {
      const row = this.cartContexts.get(bindings[0])
      return { rows: row ? [{ context: row.context }] : [] }
    }
    if (s.startsWith("insert into tracking_order_context")) {
      const [order_id, display_id, cart_id, host, env, context, trusted, staff, optout, purchase_time] = bindings
      if (this.orderContexts.has(order_id)) return { rowCount: 0 }
      this.orderContexts.set(order_id, { order_id, display_id, cart_id, host, env, context: jsonb(context), trusted, staff,
        optout, purchase_time: new Date(purchase_time), created_at: now })
      return { rowCount: 1 }
    }
    if (s.startsWith("select order_id, display_id, cart_id, host, env, context, trusted, staff, optout, purchase_time from tracking_order_context where order_id in (")) {
      return { rows: bindings.map((id) => this.orderContexts.get(id)).filter(Boolean) }
    }
    if (s.startsWith("insert into tracking_hit")) {
      return { rowCount: this.insertRows(bindings, HIT_COLUMNS, (row) => `${row.event_name}|${row.event_id}`, this.hits) }
    }
    if (s.startsWith("insert into tracking_event")) {
      return { rowCount: this.insertRows(bindings, OUTBOX_COLUMNS, (row) => `${row.platform}|${row.event_name}|${row.event_id}`,
        this.events, (row) => { row.payload = jsonb(row.payload) }) }
    }
    if (/^select order_id from order_op where order_id in \([?, ]+\) and source is not null and source <> '' and deleted_at is null$/.test(s)) {
      return { rows: bindings.filter((id) => this.orderOps.get(id)?.source).map((order_id) => ({ order_id })) }
    }
    if (/^select order_id from order_op where order_id in \([?, ]+\) and deleted_at is null$/.test(s)) {
      return { rows: bindings.filter((id) => this.orderOps.has(id)).map((order_id) => ({ order_id })) }
    }
    if (s.startsWith("select c.cart_id, c.context from tracking_cart_context c")) {
      assert.match(s, /updated_at >= now\(\) - interval '6 days'/)
      assert.match(s, /not exists \(select 1 from tracking_order_context o where o\.cart_id = c\.cart_id\)/)
      const recorded = new Set([...this.orderContexts.values()].map((row) => row.cart_id))
      const rows = [...this.cartContexts.values()]
        .filter((row) => row.updated_at >= now - 6 * DAY && row.updated_at < now - 60_000 && !recorded.has(row.cart_id))
        .sort((a, b) => b.updated_at - a.updated_at)
        .map(({ cart_id, context }) => ({ cart_id, context }))
      return { rows }
    }
    if (s.startsWith("select c.order_id from tracking_order_context c")) {
      assert.match(s, /where c\.trusted and not c\.staff and not c\.optout and c\.env is not null/)
      const has = (platform, row) => this.events.has(`${platform}|Purchase|fl-${row.display_id}`)
      const rows = [...this.orderContexts.values()]
        .filter((row) => row.trusted && !row.staff && !row.optout && row.env !== null
          && row.created_at >= now - 6 * DAY && row.purchase_time.getTime() >= now - 6 * DAY
          && (!has("meta", row) || !has("tiktok", row)))
        .map(({ order_id }) => ({ order_id }))
      return { rows }
    }
    if (s.startsWith("insert into tracking_counter")) {
      for (let i = 0; i < bindings.length; i += 3) this.counters[bindings[i + 1]] = (this.counters[bindings[i + 1]] ?? 0) + bindings[i + 2]
      return { rowCount: bindings.length / 3 }
    }
    throw new Error(`Unexpected SQL: ${s}`)
  }
}

/**
 * The real purchase/order-events/checkout-context/workflow files against the
 * fake database, a fake query.graph and a settings row. scheduleFlush,
 * kickStaleJobs and ensureOps are spies.
 */
function harness(options = {}) {
  const db = new FakeDb()
  const orders = new Map((options.orders ?? [order()]).map((row) => [row.id, row]))
  const links = options.links ?? []
  const logs = [], flushes = [], kicks = [], ensured = [], routeRuns = [], graphCalls = []
  const settingsRow = {
    id: "trackset_default",
    config: options.config ?? config(),
    meta_test_token: "EAAtesttoken", meta_live_token: "EAAlivetoken", tiktok_test_token: null, tiktok_live_token: null,
    catalog_feed_token: null,
    ...options.tokens,
  }
  const query = {
    async graph({ entity, fields, filters }) {
      graphCalls.push({ entity, fields: [...fields], filters })
      if (options.failGraph && options.failGraph.test(entity)) throw new Error("graph unavailable")
      if (entity === "order" && filters.id) return { data: [...filters.id].map((id) => orders.get(id)).filter(Boolean) }
      if (entity === "order" && filters.created_at) {
        return { data: [...orders.values()].filter((row) => new Date(row.created_at).getTime() >= filters.created_at.$gte.getTime()) }
      }
      if (entity === "order_cart") return { data: links.filter((link) => [...filters.cart_id].includes(link.cart_id)) }
      throw new Error(`Unexpected graph ${entity}`)
    },
  }
  const services = {
    pg: db,
    query,
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line) },
    tracking: { listTrackingSettings: async () => [settingsRow] },
  }
  const container = { resolve: (key) => { if (!Object.hasOwn(services, key)) throw new Error(`resolve ${key}`); return services[key] } }

  const sdk = { steps: {}, workflows: {}, composed: [] }
  sdk.StepResponse = class StepResponse { constructor(output) { this.output = output } }
  sdk.WorkflowResponse = class WorkflowResponse { constructor(result) { this.result = result } }
  sdk.createStep = (name, handler) => {
    sdk.steps[name] = handler
    return (input) => { sdk.composed.push(name); return { step: name, input } }
  }
  sdk.createWorkflow = (name, composer) => { sdk.workflows[name] = composer; return () => ({ name }) }
  sdk.transform = (values, fn) => ({ values, fn })

  const load = makeLoader({
    "@medusajs/framework/utils": utils,
    "@medusajs/framework/workflows-sdk": sdk,
    "../../modules/tracking": { TRACKING_MODULE: "tracking" },
    "./outbox": { scheduleFlush: (c) => flushes.push(c) },
    "./jobs": { kickStaleJobs: (c) => kicks.push(c) },
    "../order-ops": { ensureOps: async (_c, ids) => { ensured.push([...ids]); for (const id of ids) db.orderOps.set(id, { order_id: id, source: null }) } },
    "./checkout-service": { runCheckout: async () => { throw new Error("not used") } },
    "../../../workflows/checkout": { checkoutWithTrackingWorkflow: (scope) => ({ run: async (args) => {
      routeRuns.push({ scope, input: args.input })
      return { result: options.routeResult ?? { status: 200, body: { order: { id: ORDER_ID, display_id: 1234 } } } }
    } }) },
    ...options.stubs,
  }, { process: { env: { ...options.env } }, ...options.globals })
  return {
    db, orders, links, logs, flushes, kicks, ensured, routeRuns, graphCalls, settingsRow, container, sdk, load,
    purchase: load("lib/tracking/purchase.ts"),
    events: load("lib/tracking/order-events.ts"),
    header: load("lib/tracking/checkout-context.ts"),
  }
}

/** A stored context row for the pure builders, derived exactly as recordPurchase derives it. */
function contextRow(h, context = ctx(), cfg = config(), raw = order()) {
  return h.purchase.orderContextRow(h.events.toOrderForEvents(raw), CART_ID, context, cfg)
}

// ---------------------------------------------------------------- header

test("decodeTrackingHeader verifies the derived key, reads only the two headers and never throws", () => {
  const env = { TRACKING_INGEST_SECRET: SECRET }
  const h = harness({ env })
  const decode = (headers) => plain(h.header.decodeTrackingHeader(headers))
  const good = ctx({ evil: "dropped", ua: "x".repeat(401), host: "NEW.florayn.com" })

  assert.deepEqual(decode({}), { ctx: null, rejected: false })
  assert.deepEqual(decode({ "x-florayn-ingest-key": KEY }), { ctx: null, rejected: false }, "no tracking header is not a rejection")
  assert.deepEqual(decode({ "x-florayn-tracking": encode(ctx()) }), { ctx: null, rejected: true })
  assert.deepEqual(decode({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": "0".repeat(64) }), { ctx: null, rejected: true })
  assert.deepEqual(decode({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": [KEY, KEY] }), { ctx: null, rejected: true })

  const decoded = decode({ "x-florayn-tracking": encode(good), "x-florayn-ingest-key": KEY })
  assert.equal(decoded.rejected, false)
  assert.equal(decoded.ctx.host, "new.florayn.com")
  assert.equal(decoded.ctx.ua, null, "a value over its cap is left out, never cut")
  assert.ok(!("evil" in decoded.ctx), "unknown keys are dropped")
  assert.deepEqual(Object.keys(decoded.ctx).sort(), Object.keys(ctx()).sort())

  // Over 4 KB, not base64url, not JSON, not an object or another version: no context, not a key problem.
  const big = encode(ctx({ pad: "p".repeat(3200) }))
  assert.ok(big.length > 4096)
  for (const value of [big, "A".repeat(4097), "%%%not-base64%%%", encode("just a string").replace(/=+$/, ""), "bm90IGpzb24", encode([1, 2]), encode(ctx({ v: 2 })), "", ["a", "b"]]) {
    assert.deepEqual(decode({ "x-florayn-tracking": value, "x-florayn-ingest-key": KEY }), { ctx: null, rejected: false })
  }
  assert.ok(encode(ctx()).length <= 4096)

  // Fetch-style Headers work too.
  const fetchHeaders = new Headers({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": KEY })
  assert.equal(decode(fetchHeaders).ctx.vid, VID)

  // Only the two headers are read: never a body, never anything else.
  const reads = []
  const spy = new Proxy({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": KEY, body: { phone: "01712345678" } }, {
    get(target, key) { reads.push(String(key)); return target[key] },
  })
  assert.equal(decode(spy).ctx.vid, VID)
  assert.deepEqual([...new Set(reads)].sort(), ["get", "x-florayn-ingest-key", "x-florayn-tracking"])

  const hostile = new Proxy({}, { get() { throw new Error("boom") } })
  assert.deepEqual(decode(hostile), { ctx: null, rejected: false })
  assert.deepEqual(decode(null), { ctx: null, rejected: false })

  // Fails closed without a secret; the previous secret is accepted while rotating.
  delete env.TRACKING_INGEST_SECRET
  const rotated = harness({ env: { TRACKING_INGEST_SECRET: "f".repeat(32), TRACKING_INGEST_SECRET_PREVIOUS: SECRET } })
  const noSecret = harness({ env: {} })
  assert.deepEqual(plain(noSecret.header.decodeTrackingHeader({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": KEY })), { ctx: null, rejected: true })
  assert.equal(rotated.header.decodeTrackingHeader({ "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": KEY }).ctx.vid, VID)
})

test("countCheckoutHeader bumps rejected and untrusted counters without ever failing", async () => {
  const h = harness()
  h.header.countCheckoutHeader(h.container, { ctx: null, rejected: true })
  h.header.countCheckoutHeader(h.container, { ctx: ctx({ edge: false }), rejected: false })
  h.header.countCheckoutHeader(h.container, { ctx: ctx(), rejected: false })
  h.header.countCheckoutHeader(h.container, { ctx: null, rejected: false })
  await tick()
  assert.deepEqual(h.db.counters, { "checkout.header_rejected": 1, "checkout.untrusted": 1 })
  h.db.failOn = /tracking_counter/
  assert.doesNotThrow(() => h.header.countCheckoutHeader(h.container, { ctx: null, rejected: true }))
  h.header.countCheckoutHeader({ resolve() { throw new Error("no container") } }, { ctx: null, rejected: true })
  await tick()
})

// ---------------------------------------------------------------- order-events (pure)

test("orderContextRow: trusted only with the edge check on an allowlisted host; env from the host roles", () => {
  const h = harness()
  const row = contextRow(h)
  assert.deepEqual(plain({ host: row.host, env: row.env, trusted: row.trusted, staff: row.staff, optout: row.optout, display_id: row.display_id }),
    { host: "new.florayn.com", env: "test", trusted: true, staff: false, optout: false, display_id: 1234 })
  assert.equal(new Date(row.purchase_time).toISOString(), CREATED)
  assert.equal(contextRow(h, ctx({ edge: false })).trusted, false)
  const unknown = contextRow(h, ctx({ host: "evil.example" }))
  assert.equal(unknown.env, null)
  assert.equal(unknown.trusted, false)
  assert.equal(contextRow(h, ctx({ host: null })).host, "")
  assert.equal(contextRow(h, ctx({ host: "florayn.com" })).env, "test", "a live host routes to TEST until live sending is armed")
  assert.equal(contextRow(h, ctx({ host: "florayn.com" }), config({ live_armed: true })).env, "live")
  const optout = contextRow(h, ctx({ optout: true }))
  assert.equal(optout.optout, true)
  for (const key of ["ip", "ua", "vid", "sid", "fbp", "fbc", "ttp", "ttclid", "gclid", "gbraid", "wbraid"]) assert.equal(optout.context[key], null, key)
  assert.equal(optout.context.device, "mobile")
})

test("buildOrderEventRows follows the 6.1 table for Purchase", () => {
  const h = harness()
  const o = h.events.toOrderForEvents(order())
  const build = (context, settings, extra = {}) => plain(h.events.buildOrderEventRows({ kind: "Purchase", order: o, ctx: context,
    settings, at: new Date(), source: "checkout", ...extra }))

  const rows = build(contextRow(h), view())
  assert.deepEqual(rows.map((row) => [row.platform, row.status, row.destination]), [["meta", "pending", DATASET], ["tiktok", "skipped", ""]])
  const [meta, tiktok] = rows
  assert.deepEqual({ ...meta, payload: undefined }, {
    platform: "meta", env: "test", destination: DATASET, event_name: "Purchase", event_id: "fl-1234",
    event_time: new Date(order().created_at).toISOString(), source: "checkout", order_id: ORDER_ID,
    payload: undefined, status: "pending", last_error: null,
  })
  assert.equal(meta.payload.event_id, "fl-1234")
  assert.equal(meta.payload.event_time, unix(order().created_at))
  assert.equal(meta.payload.action_source, "website")
  assert.equal(meta.payload.event_source_url, "https://new.florayn.com/checkout/")
  assert.deepEqual(meta.payload.custom_data, {
    content_type: "product", content_ids: [VARIANT], contents: [{ id: VARIANT, quantity: 1, item_price: 1400 }],
    value: 1473, currency: "BDT", num_items: 1, order_id: "fl-1234", delivery_category: "home_delivery",
  })
  // Share OFF: no contact hashes, only the visitor id and the (non-contact) country.
  assert.deepEqual(Object.keys(meta.payload.user_data).sort(), ["client_ip_address", "client_user_agent", "country", "external_id", "fbp"])
  assert.deepEqual(meta.payload.user_data.external_id, [sha(VID)])
  assert.ok(!JSON.stringify(meta.payload).includes(ORDER_ID), "the raw order id never goes into a payload")
  assert.ok(!JSON.stringify(meta.payload).includes("/order/"))
  assert.deepEqual({ status: tiktok.status, payload: tiktok.payload, last_error: tiktok.last_error },
    { status: "skipped", payload: null, last_error: "skipped: TikTok is off" })

  // No row at all for untrusted, staff, opted-out or unknown-host contexts.
  for (const patch of [{ edge: false }, { staff: true }, { optout: true }, { host: "evil.example" }]) {
    assert.deepEqual(build(contextRow(h, ctx(patch)), view()), [], JSON.stringify(patch))
  }

  // Token missing: blocked "no token", payload kept for the fingerprint requeue.
  const noToken = build(contextRow(h), view(config(), { meta: { test: false, live: false }, tiktok: { test: false, live: false } }))
  assert.equal(noToken[0].status, "blocked")
  assert.equal(noToken[0].last_error, "no token")
  assert.equal(noToken[0].payload.event_id, "fl-1234")

  // Meta off: skipped with its destination and payload, so "Send skipped" can deliver it later.
  const metaOff = build(contextRow(h, ctx(), config({ meta: { enabled: false } })), view(config({ meta: { enabled: false } })))
  assert.deepEqual([metaOff[0].status, metaOff[0].destination, metaOff[0].last_error], ["skipped", DATASET, "skipped: Meta is off"])
  assert.equal(metaOff[0].payload.event_id, "fl-1234")

  // TikTok on: without a pixel id skipped with destination ''; with one pending or blocked.
  const tiktokOn = config({ tiktok: { enabled: true } })
  assert.deepEqual(build(contextRow(h), view(tiktokOn))[1], { ...tiktok, last_error: "skipped: no TikTok test id" })
  const withPixel = config({ tiktok: { enabled: true, test_id: PIXEL } })
  const [, tiktokRow] = build(contextRow(h, ctx({ ttclid: "E.C.P.abc", ttp: "ttp123" })), view(withPixel))
  assert.deepEqual([tiktokRow.status, tiktokRow.destination], ["pending", PIXEL])
  assert.equal(tiktokRow.payload.event, "Purchase")
  assert.deepEqual(tiktokRow.payload.page, { url: "https://new.florayn.com/checkout/" })
  assert.deepEqual(tiktokRow.payload.properties, { currency: "BDT", value: 1473, content_type: "product",
    contents: [{ content_id: VARIANT, quantity: 1, price: 1400 }], num_items: 1, order_id: "fl-1234" })
  assert.deepEqual(Object.keys(tiktokRow.payload.user).sort(), ["external_id", "ip", "ttclid", "ttp", "user_agent"])
  const tiktokNoToken = build(contextRow(h), view(withPixel, { meta: { test: true, live: true }, tiktok: { test: false, live: false } }))[1]
  assert.deepEqual([tiktokNoToken.status, tiktokNoToken.last_error], ["blocked", "no token"])
  const tiktokOff = build(contextRow(h), view(config({ tiktok: { enabled: false, test_id: PIXEL } })))[1]
  assert.deepEqual([tiktokOff.status, tiktokOff.destination, Boolean(tiktokOff.payload)], ["skipped", PIXEL, true])

  // Share ON: the contact hashes join the server copies.
  const shareOn = config({ privacy: { share_contact_hashes: true, consent_text: "ok", consent_version: 2 } })
  const [metaShared, tiktokShared] = build(contextRow(h), view({ ...shareOn, tiktok: { ...shareOn.tiktok, enabled: true, test_id: PIXEL } }))
  assert.deepEqual(Object.keys(metaShared.payload.user_data).sort(),
    ["client_ip_address", "client_user_agent", "country", "ct", "em", "external_id", "fbp", "fn", "ln", "ph"])
  assert.deepEqual(metaShared.payload.user_data.ph, [sha("8801712345678")])
  assert.deepEqual(metaShared.payload.user_data.em, [sha("buyer@example.com")])
  assert.equal(tiktokShared.payload.user.phone, sha("+8801712345678"))

  // A live context goes to the live dataset.
  const live = config({ live_armed: true })
  assert.equal(build(contextRow(h, ctx({ host: "florayn.com" }), live), view(live))[0].destination, LIVE_DATASET)

  // Meta refuses website events without a user agent: kept as skipped, not sent to fail.
  const noUa = build(contextRow(h, ctx({ ua: null })), view())[0]
  assert.deepEqual([noUa.status, noUa.last_error], ["skipped", "skipped: no user agent"])

  // Contents come from items with a variant id; value is the order total; num_items counts every unit.
  const mixed = h.events.toOrderForEvents(order({ total: "2946", items: [
    { variant_id: VARIANT, quantity: 2, unit_price: { numeric: 1400 }, title: "A" },
    { variant_id: null, quantity: 1, unit_price: 73, title: "Custom line" },
  ] }))
  const mixedRow = plain(h.events.buildOrderEventRows({ kind: "Purchase", order: mixed, ctx: contextRow(h), settings: view(), at: new Date(), source: "reconcile" }))[0]
  assert.deepEqual(mixedRow.payload.custom_data.contents, [{ id: VARIANT, quantity: 2, item_price: 1400 }])
  assert.equal(mixedRow.payload.custom_data.value, 2946)
  assert.equal(mixedRow.payload.custom_data.num_items, 3)
  assert.equal(mixedRow.source, "reconcile")

  // An unusable display id builds nothing.
  assert.deepEqual(plain(h.events.buildOrderEventRows({ kind: "Purchase", order: { ...o, display_id: NaN }, ctx: contextRow(h), settings: view(), at: new Date(), source: "checkout" })), [])
})

test("buildOrderEventRows builds the COD events for Meta only, system generated, with the Purchase as original event", () => {
  const h = harness()
  const o = h.events.toOrderForEvents(order())
  const at = new Date(Date.now() - 5_000)
  const cod = (kind, settings = view()) => plain(h.events.buildOrderEventRows({ kind, order: o, ctx: contextRow(h), settings, at, source: "status" }))
  const [confirmed] = cod("OrderConfirmed")
  assert.equal(cod("OrderConfirmed").length, 1, "TikTok never gets COD events")
  assert.deepEqual([confirmed.platform, confirmed.event_id, confirmed.status, confirmed.source], ["meta", "oc-fl-1234", "pending", "status"])
  assert.equal(confirmed.event_time, at.toISOString())
  assert.equal(confirmed.payload.action_source, "system_generated")
  assert.equal(confirmed.payload.event_time, unix(at))
  assert.deepEqual(confirmed.payload.original_event_data, { event_name: "Purchase", event_time: unix(order().created_at), order_id: "fl-1234", event_id: "fl-1234" })
  assert.ok(!("client_ip_address" in confirmed.payload.user_data) && !("client_user_agent" in confirmed.payload.user_data))
  assert.ok(!("event_source_url" in confirmed.payload))
  assert.deepEqual(confirmed.payload.custom_data, { content_type: "product", content_ids: [VARIANT], value: 1473, currency: "BDT", order_id: "fl-1234" })
  assert.equal(cod("Delivered")[0].event_id, "dl-fl-1234")
  assert.equal(cod("Returned")[0].event_id, "rt-fl-1234")
  const toggledOff = config({ meta: { enabled: true, status_events: { OrderConfirmed: false, Delivered: true, Returned: true } } })
  const off = cod("OrderConfirmed", view(toggledOff))[0]
  assert.deepEqual([off.status, off.destination, off.last_error], ["skipped", DATASET, "skipped: OrderConfirmed events are off"])
  assert.equal(off.payload.event_id, "oc-fl-1234")
  assert.deepEqual(plain(h.events.buildOrderEventRows({ kind: "Delivered", order: o, ctx: contextRow(h, ctx({ staff: true })), settings: view(), at, source: "status" })), [])
})

test("buildPurchaseBlock matches the storefront's strict isPurchaseBlock and the share rule", () => {
  const h = harness()
  const o = h.events.toOrderForEvents(order())
  const block = (context = contextRow(h), cfg = config(), raw = o) => plain(h.events.buildPurchaseBlock(raw, context, view(cfg)))

  const base = block()
  assert.deepEqual(base, {
    event_id: "fl-1234", value: 1473, currency: "BDT", num_items: 1,
    contents: [{ id: VARIANT, quantity: 1, item_price: 1400 }],
    platforms: { meta: true, tiktok: false, google: false },
    match: { meta: { external_id: sha(VID) } },
  })
  assert.equal(storefrontContract.isPurchaseBlock(base), true)

  const tiktokOn = config({ tiktok: { enabled: true, test_id: PIXEL } })
  assert.deepEqual(block(contextRow(h), tiktokOn).match, { meta: { external_id: sha(VID) }, tiktok: { external_id: sha(VID) } })

  const shared = config({ privacy: { share_contact_hashes: true, consent_text: "ok", consent_version: 2 } })
  const sharedBlock = block(contextRow(h), shared)
  assert.deepEqual(Object.keys(sharedBlock.match.meta).sort(), ["country", "ct", "em", "external_id", "fn", "ln", "ph"])
  assert.ok(Object.values(sharedBlock.match.meta).every((value) => /^[0-9a-f]{64}$/.test(value)))
  assert.equal(sharedBlock.match.google, undefined, "Google only exists on armed live hosts")
  assert.equal(storefrontContract.isPurchaseBlock(sharedBlock), true)

  const liveGoogle = config({ live_armed: true, google: { enabled: true }, privacy: { share_contact_hashes: true, consent_text: "ok", consent_version: 2 } })
  const liveBlock = block(contextRow(h, ctx({ host: "www.florayn.com" }), liveGoogle), liveGoogle)
  assert.deepEqual(liveBlock.platforms, { meta: true, tiktok: false, google: true })
  assert.equal(liveBlock.match.google.address.country, "BD")
  assert.equal(liveBlock.match.google.sha256_phone_number, sha("+8801712345678"))
  assert.equal(storefrontContract.isPurchaseBlock(liveBlock), true)
  const liveNoShare = config({ live_armed: true, google: { enabled: true } })
  assert.equal(block(contextRow(h, ctx({ host: "florayn.com" }), liveNoShare), liveNoShare).match.google, undefined)

  for (const patch of [{ edge: false }, { staff: true }, { optout: true }, { host: "evil.example" }]) {
    const quiet = block(contextRow(h, ctx(patch)))
    assert.deepEqual([quiet.platforms, quiet.match], [{ meta: false, tiktok: false, google: false }, {}], JSON.stringify(patch))
    assert.equal(storefrontContract.isPurchaseBlock(quiet), true)
  }

  // A line without a variant id would make the storefront drop the whole block: it is left out.
  const custom = h.events.toOrderForEvents(order({ total: { numeric: "1550" }, items: [
    { variant_id: VARIANT, quantity: 1, unit_price: "1400", title: "A" },
    { variant_id: null, quantity: 1, unit_price: 150, title: "Gift wrap" },
  ] }))
  const customBlock = block(contextRow(h), config(), custom)
  assert.deepEqual([customBlock.value, customBlock.num_items, customBlock.contents.length], [1550, 2, 1])
  assert.equal(storefrontContract.isPurchaseBlock(customBlock), true)

  assert.equal(h.events.buildPurchaseBlock({ ...o, display_id: 0 }, contextRow(h), view()), null)
})

// ---------------------------------------------------------------- recordPurchase

test("recordPurchase writes context, hit and one row per platform in one transaction; retries return the same block", async () => {
  const h = harness()
  const record = (context, extra = {}) => h.purchase.recordPurchase(h.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: context, source: "checkout", ...extra })

  const first = plain(await record(ctx()))
  assert.equal(first.event_id, "fl-1234")
  assert.equal(h.db.transactions, 1)
  assert.ok(h.db.statements.includes("set local statement_timeout = '5s'"))
  assert.equal(h.db.orderContexts.size, 1)
  assert.equal(h.db.hits.size, 1)
  assert.deepEqual([...h.db.events.keys()], ["meta|Purchase|fl-1234", "tiktok|Purchase|fl-1234"])
  assert.deepEqual(plain([...h.db.hits.values()][0]), {
    event_name: "Purchase", event_id: "fl-1234", origin: "s", visitor_id: VID, session_id: SID, source: "meta_paid",
    campaign: "sept", device_class: "mobile", audience: "women", host: "new.florayn.com", path: "/checkout/", handle: null,
    variant_id: null, device: null, case_type: null, value: 1473, items: 1, country: "BD", flags: 16,
  })
  const stored = h.db.orderContexts.get(ORDER_ID)
  assert.deepEqual([stored.cart_id, stored.env, stored.trusted, stored.display_id], [CART_ID, "test", true, 1234])
  assert.equal(h.db.events.get("meta|Purchase|fl-1234").status, "pending")
  assert.equal(h.db.events.get("tiktok|Purchase|fl-1234").status, "skipped")
  assert.equal(h.flushes.length, 1)
  assert.equal(h.kicks.length, 1)

  // A retry (even with a different context) keeps the first stored context and answers the same block.
  const retry = plain(await record(ctx({ vid: "v1.1790467299.ffffffffffffffff", staff: true, edge: false })))
  assert.deepEqual(retry, first)
  const [a, b] = await Promise.all([record(ctx()), record(ctx())])
  assert.deepEqual([plain(a), plain(b)], [first, first])
  assert.equal(h.db.orderContexts.size, 1)
  assert.equal(h.db.hits.size, 1)
  assert.equal(h.db.events.size, 2)
  assert.equal(h.db.orderContexts.get(ORDER_ID).staff, false)
  assert.equal(h.flushes.length, 1, "nothing new to send after the first record")
  assert.equal(h.kicks.length, 4)
})

test("recordPurchase: staff, opted-out, untrusted and unknown-host contexts get a context and hit but no ad rows", async () => {
  const cases = [
    [{ staff: true }, (h) => {
      assert.equal([...h.db.hits.values()][0].flags, 8 | 16, "staff Purchase hits are flagged internal")
      assert.equal(h.db.orderContexts.get(ORDER_ID).staff, true)
    }],
    [{ optout: true }, (h) => {
      const hit = [...h.db.hits.values()][0]
      assert.deepEqual([hit.visitor_id, hit.session_id], [null, null])
      const stored = h.db.orderContexts.get(ORDER_ID)
      assert.deepEqual([stored.context.vid, stored.context.ip, stored.context.ua, stored.context.fbp], [null, null, null, null])
    }],
    [{ edge: false }, (h) => assert.equal(h.db.orderContexts.get(ORDER_ID).trusted, false)],
    [{ host: "evil.example" }, (h) => assert.equal(h.db.orderContexts.get(ORDER_ID).env, null)],
  ]
  for (const [patch, check] of cases) {
    const h = harness()
    const block = plain(await h.purchase.recordPurchase(h.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: ctx(patch), source: "checkout" }))
    assert.deepEqual(block.platforms, { meta: false, tiktok: false, google: false }, JSON.stringify(patch))
    assert.deepEqual(block.match, {})
    assert.equal(h.db.orderContexts.size, 1, "every storefront order keeps a context (checkout_without_tracking)")
    assert.equal(h.db.hits.size, 1)
    assert.equal(h.db.events.size, 0)
    assert.equal(h.flushes.length, 0)
    check(h)
  }
})

test("recordPurchase: no context, drafts and imported orders write nothing", async () => {
  const none = harness()
  assert.equal(await none.purchase.recordPurchase(none.container, { orderId: ORDER_ID, cartId: CART_ID, source: "checkout" }), null)
  assert.equal(await none.purchase.recordPurchase(none.container, { orderId: ORDER_ID, source: "checkout" }), null)
  assert.deepEqual(none.db.statements, ["select context from tracking_cart_context where cart_id = ?"])

  const fromCart = harness()
  await fromCart.purchase.stashCartContext(fromCart.container, CART_ID, ctx())
  assert.equal((await fromCart.purchase.recordPurchase(fromCart.container, { orderId: ORDER_ID, cartId: CART_ID, source: "reconcile" })).event_id, "fl-1234")
  assert.equal(fromCart.db.events.get("meta|Purchase|fl-1234").source, "reconcile")

  const draft = harness({ orders: [order({ is_draft_order: true })] })
  assert.equal(await draft.purchase.recordPurchase(draft.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: ctx(), source: "checkout" }), null)
  const imported = harness()
  imported.db.orderOps.set(ORDER_ID, { order_id: ORDER_ID, source: "florayn.com" })
  assert.equal(await imported.purchase.recordPurchase(imported.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: ctx(), source: "checkout" }), null)
  const missing = harness({ orders: [] })
  assert.equal(await missing.purchase.recordPurchase(missing.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: ctx(), source: "checkout" }), null)
  for (const h of [draft, imported, missing]) {
    assert.equal(h.db.transactions, 0)
    assert.deepEqual([h.db.orderContexts.size, h.db.hits.size, h.db.events.size], [0, 0, 0])
  }
})

test("a failure between the inserts leaves nothing half-written and reconcile (a) records the Purchase later", async () => {
  for (const failOn of [/^insert into tracking_hit/, /^insert into tracking_event/]) {
    const h = harness({ links: [{ order_id: ORDER_ID, cart_id: CART_ID }] })
    const input = { body: { cart_id: CART_ID, full_name: "Secret Name", phone: "01712345678" }, complete: true, tracking: ctx() }
    await h.purchase.stashCheckoutTracking(h.container, input)
    h.db.failOn = failOn
    await assert.rejects(h.purchase.recordPurchase(h.container, { orderId: ORDER_ID, cartId: CART_ID, ctx: ctx(), source: "checkout" }))
    assert.deepEqual([h.db.orderContexts.size, h.db.hits.size, h.db.events.size], [0, 0, 0])
    assert.equal(h.flushes.length, 0)

    // The checkout's record step answers null, logs one short line and never throws.
    const block = await h.purchase.recordCheckoutTracking(h.container, input, { status: 200, body: { order: { id: ORDER_ID, display_id: 1234 } } })
    assert.equal(block, null)
    assert.equal(h.logs.length, 1)
    assert.match(h.logs[0], /Purchase was not recorded \(Error 57014\).*reconcile/)
    assert.ok(!/Secret Name|01712345678|injected/.test(h.logs[0]), "the log line holds no body, customer data or raw message")
    assert.deepEqual([h.db.orderContexts.size, h.db.hits.size, h.db.events.size], [0, 0, 0])

    h.db.failOn = null
    h.db.cartContexts.get(CART_ID).updated_at -= 5 * 60_000
    const stats = plain(await h.purchase.runReconcile(h.container))
    assert.equal(stats.recorded, 1)
    assert.deepEqual([h.db.orderContexts.size, h.db.hits.size, h.db.events.size], [1, 1, 2])
    assert.ok([...h.db.events.values()].every((row) => row.source === "reconcile"))
    const again = plain(await h.purchase.runReconcile(h.container))
    assert.deepEqual([again.carts, again.recorded, again.rows_added], [0, 0, 0])
  }
})

// ---------------------------------------------------------------- checkout helpers and steps

test("the checkout helpers stash and record only when they should, within a time budget, and never throw", async () => {
  const h = harness()
  const body = { cart_id: CART_ID, full_name: "Secret Name", phone: "01712345678" }
  await h.purchase.stashCheckoutTracking(h.container, { body, complete: false, tracking: ctx() })
  await h.purchase.stashCheckoutTracking(h.container, { body, complete: true, tracking: null })
  await h.purchase.stashCheckoutTracking(h.container, { body: { cart_id: "order_1" }, complete: true, tracking: ctx() })
  await h.purchase.stashCheckoutTracking(h.container, null)
  assert.equal(h.db.statements.length, 0)
  await h.purchase.stashCheckoutTracking(h.container, { body, complete: true, tracking: ctx() })
  assert.equal(h.db.cartContexts.get(CART_ID).context.vid, VID)

  const placed = { status: 200, body: { order: { id: ORDER_ID, display_id: 1234 } } }
  const input = { body, complete: true, tracking: ctx() }
  for (const result of [{ status: 409, body: { errors: {} } }, { status: 200, body: { quote: {} } }, { status: 503, body: { order: { id: ORDER_ID } } }, null]) {
    assert.equal(await h.purchase.recordCheckoutTracking(h.container, input, result), null)
  }
  assert.equal(await h.purchase.recordCheckoutTracking(h.container, { ...input, tracking: null }, placed), null)
  assert.equal(h.db.transactions, 0, "no record without a placed order and a context")
  assert.equal((await h.purchase.recordCheckoutTracking(h.container, input, placed)).event_id, "fl-1234")

  h.db.failOn = /tracking_cart_context/
  await assert.doesNotReject(h.purchase.stashCheckoutTracking(h.container, input))
  assert.match(h.logs.at(-1), /context was not stashed/)

  // A hung database costs the checkout at most the budget; the order goes on without tracking.
  const timers = []
  const slow = harness({ globals: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} } }, clearTimeout() {} } })
  slow.db.hang = /^insert into tracking_cart_context|^set local/
  const stash = slow.purchase.stashCheckoutTracking(slow.container, input)
  await tick()
  assert.deepEqual(timers.map((timer) => timer.ms), [1000])
  timers.shift().fn()
  await stash
  const record = slow.purchase.recordCheckoutTracking(slow.container, input, placed)
  await tick()
  assert.deepEqual(timers.map((timer) => timer.ms), [3000])
  timers.shift().fn()
  assert.equal(await record, null)
  assert.match(slow.logs.join("\n"), /timeout after 1000 ms[\s\S]*timeout after 3000 ms/)
})

test("the workflow keeps checkoutWorkflow as is and adds the two tracking steps around prepare-checkout", async () => {
  const h = harness()
  h.load("workflows/checkout.ts")
  const { sdk } = h
  assert.deepEqual(Object.keys(sdk.workflows).sort(), ["checkout", "checkout-with-tracking"])

  sdk.composed.length = 0
  const plainResponse = sdk.workflows.checkout({ input: true })
  assert.deepEqual(sdk.composed, ["prepare-checkout"])
  assert.ok(plainResponse instanceof sdk.WorkflowResponse)
  assert.equal(plainResponse.result.step, "prepare-checkout", "checkoutWorkflow returns the step's result untouched")

  sdk.composed.length = 0
  const tracked = sdk.workflows["checkout-with-tracking"]({ input: true })
  assert.deepEqual(sdk.composed, ["stash-checkout-tracking", "prepare-checkout", "record-purchase-tracking"])
  const merge = tracked.result.fn
  const result = { status: 200, body: { order: { id: ORDER_ID, display_id: 1234 } } }
  assert.equal(merge({ result, tracking: null }), result, "no block, no change to the response")
  const block = { event_id: "fl-1234" }
  assert.deepEqual(plain(merge({ result, tracking: block })), { status: 200, body: { order: result.body.order, tracking: block } })
  assert.deepEqual(result.body, { order: { id: ORDER_ID, display_id: 1234 } }, "the step result itself is not mutated")

  // The real steps against the fake database.
  const stash = await sdk.steps["stash-checkout-tracking"]({ body: { cart_id: CART_ID }, complete: true, tracking: ctx() }, { container: h.container })
  assert.ok(stash instanceof sdk.StepResponse)
  assert.equal(stash.output, null)
  assert.ok(h.db.cartContexts.has(CART_ID))
  const record = sdk.steps["record-purchase-tracking"]
  const input = { body: { cart_id: CART_ID }, complete: true, tracking: ctx() }
  const placed = await record({ input, result }, { container: h.container })
  assert.ok(placed instanceof sdk.StepResponse)
  assert.equal(placed.output.event_id, "fl-1234")
  for (const other of [{ status: 409, body: { errors: {} } }, { status: 200, body: {} }]) {
    const response = await record({ input, result: other }, { container: h.container })
    assert.ok(response instanceof sdk.StepResponse)
    assert.equal(response.output, null)
  }
  assert.equal((await record({ input: { ...input, tracking: null }, result }, { container: h.container })).output, null)

  // Even a helper that throws cannot fail the order.
  const broken = harness({ stubs: { "../lib/tracking/purchase": {
    stashCheckoutTracking: async () => { throw new Error("broken") },
    recordCheckoutTracking: () => { throw new Error("broken") },
  } } })
  broken.load("workflows/checkout.ts")
  const brokenStash = await broken.sdk.steps["stash-checkout-tracking"](input, { container: broken.container })
  const brokenRecord = await broken.sdk.steps["record-purchase-tracking"]({ input, result }, { container: broken.container })
  assert.ok(brokenStash instanceof broken.sdk.StepResponse && brokenRecord instanceof broken.sdk.StepResponse)
  assert.deepEqual([brokenStash.output, brokenRecord.output], [null, null])
})

test("checkoutWorkflow, its Input type and the quote route are unchanged; only /store/checkout switches", () => {
  const workflow = lf(fs.readFileSync(path.join(SRC, "workflows/checkout.ts"), "utf8"))
  assert.ok(workflow.includes(`type Input = { body: unknown; complete: boolean; customerId?: string }

const prepareCheckoutStep = createStep("prepare-checkout", async (input: Input, { container }) => {
  return new StepResponse(await runCheckout(container, input.body, input.complete, input.customerId))
})

export const checkoutWorkflow = createWorkflow("checkout", (input: Input) => {
  return new WorkflowResponse(prepareCheckoutStep(input))
})
`))
  const quote = lf(fs.readFileSync(path.join(SRC, "api/store/checkout/quote/route.ts"), "utf8"))
  assert.equal(quote.trimEnd(), `import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkoutWorkflow } from "../../../../workflows/checkout"

/** A quote only prepares delivery and discounts; it never creates a payment or order. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const { result } = await checkoutWorkflow(req.scope).run({ input: { body: req.body, complete: false } })
  return res.status(result.status).json(result.body)
}`)
  const route = lf(fs.readFileSync(path.join(SRC, "api/store/checkout/route.ts"), "utf8"))
  assert.match(route, /checkoutWithTrackingWorkflow\(req\.scope\)\.run/)
  assert.ok(!/\bcheckoutWorkflow\b/.test(route))
  const script = lf(fs.readFileSync(path.join(SRC, "scripts/verify-checkout-isolated.ts"), "utf8"))
  const lastExisting = script.indexOf(`assert.equal((await readSummary()).items[0].thumbnail, "https://example.invalid/selected-case.webp")`)
  const section = script.indexOf(`process.env.TRACKING_DRY_RUN = "1"`)
  assert.ok(lastExisting > 0 && section > lastExisting, "the isolated tracking checks run after every existing assertion")
  assert.match(script, /meta_test_token: "ci-fake-token"/)
})

test("POST /store/checkout decodes the header, counts problems and runs the tracked workflow as before", async () => {
  const response = () => ({
    headers: {}, code: null, body: null,
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  })
  const body = { cart_id: CART_ID, full_name: "Secret Name" }

  const h = harness({ env: { TRACKING_INGEST_SECRET: SECRET } })
  const route = h.load("api/store/checkout/route.ts")
  const trusted = response()
  await route.POST({ headers: { "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": KEY }, body, scope: h.container,
    auth_context: { actor_type: "customer", actor_id: "cus_01" } }, trusted)
  await tick()
  assert.equal(trusted.headers["Cache-Control"], "private, no-store")
  assert.deepEqual([trusted.code, trusted.body], [200, { order: { id: ORDER_ID, display_id: 1234 } }])
  assert.deepEqual(plain(h.routeRuns[0].input), { body, complete: true, customerId: "cus_01", tracking: ctx() })
  assert.equal(h.routeRuns[0].scope, h.container)
  assert.deepEqual(h.db.counters, {})

  const guest = response()
  await route.POST({ headers: { "x-florayn-tracking": encode(ctx({ edge: false })), "x-florayn-ingest-key": KEY }, body, scope: h.container }, guest)
  await route.POST({ headers: { "x-florayn-tracking": encode(ctx()), "x-florayn-ingest-key": "bad" }, body, scope: h.container,
    auth_context: { actor_type: "user", actor_id: "user_01" } }, response())
  await route.POST({ headers: {}, body, scope: h.container }, response())
  await tick()
  assert.equal(h.routeRuns[1].input.customerId, undefined)
  assert.equal(h.routeRuns[1].input.tracking.edge, false)
  assert.equal(h.routeRuns[2].input.tracking, null)
  assert.equal(h.routeRuns[2].input.customerId, undefined)
  assert.equal(h.routeRuns[3].input.tracking, null)
  assert.deepEqual(h.db.counters, { "checkout.untrusted": 1, "checkout.header_rejected": 1 })

  // A counter failure never touches the order.
  const failing = harness({ env: { TRACKING_INGEST_SECRET: SECRET }, routeResult: { status: 409, body: { errors: { form: "changed" } } } })
  failing.db.failOn = /tracking_counter/
  const conflicted = response()
  await failing.load("api/store/checkout/route.ts").POST({ headers: { "x-florayn-tracking": "x" }, body, scope: failing.container }, conflicted)
  await tick()
  assert.deepEqual([conflicted.code, conflicted.body], [409, { errors: { form: "changed" } }])
})

// ---------------------------------------------------------------- reconcile

test("reconcilePurchases covers (a) carts, (b) missing order_op rows and (c) missing platform rows, skipping imported and draft orders", async () => {
  const recent = new Date(Date.now() - 10 * 60_000).toISOString()
  const ids = { X: "order_01JX", Y: "order_01JY", Z: "order_01JZ", W: "order_01JW", V: "order_01JV", A: "order_01JA", OLD: "order_01JOLD" }
  const orders = [
    order({ id: ids.X, display_id: 11, created_at: recent }),
    order({ id: ids.Y, display_id: 12, created_at: recent }),
    order({ id: ids.Z, display_id: 13, created_at: recent }),
    order({ id: ids.W, display_id: 14, created_at: recent }),
    order({ id: ids.V, display_id: 15, created_at: recent, is_draft_order: true }),
    order({ id: ids.A, display_id: 16, created_at: recent }),
    order({ id: ids.OLD, display_id: 17, created_at: new Date(Date.now() - 3 * DAY).toISOString() }),
  ]
  const h = harness({ orders, links: [{ order_id: ids.A, cart_id: "cart_01JA" }, { order_id: ids.V, cart_id: "cart_01JV" }] })
  const seed = (id, display, patch = {}) => h.db.orderContexts.set(id, {
    order_id: id, display_id: display, cart_id: null, host: "new.florayn.com", env: "test", context: ctx(), trusted: true,
    staff: false, optout: false, purchase_time: new Date(recent), created_at: Date.now() - 10 * 60_000, ...patch,
  })
  seed(ids.X, 11)
  seed(ids.Y, 12)
  seed(ids.Z, 13, { staff: true })
  seed(ids.W, 14)
  seed(ids.V, 15)
  const eventRow = (platform, display) => ({ platform, env: "test", destination: "", event_name: "Purchase", event_id: `fl-${display}`,
    event_time: new Date(recent), source: "checkout", order_id: null, payload: null, status: "skipped", last_error: null })
  h.db.events.set("meta|Purchase|fl-11", eventRow("meta", 11))
  h.db.events.set("meta|Purchase|fl-12", eventRow("meta", 12))
  h.db.events.set("tiktok|Purchase|fl-12", eventRow("tiktok", 12))
  h.db.orderOps.set(ids.W, { order_id: ids.W, source: "florayn.com" })
  h.db.orderOps.set(ids.Y, { order_id: ids.Y, source: null })
  // (a) Stashed carts from before the settle minute: A became an order, V a draft.
  await h.purchase.stashCartContext(h.container, "cart_01JA", ctx())
  await h.purchase.stashCartContext(h.container, "cart_01JV", ctx())
  await h.purchase.stashCartContext(h.container, "cart_01JNOORDER", ctx())
  for (const row of h.db.cartContexts.values()) row.updated_at -= 5 * 60_000

  const stats = plain(await h.purchase.runReconcile(h.container))

  // (a) A is recorded; the draft and the cart without an order are not.
  assert.equal(stats.carts, 3)
  assert.equal(stats.recorded, 1)
  assert.equal(h.db.orderContexts.get(ids.A).cart_id, "cart_01JA")
  assert.equal(h.db.events.get("meta|Purchase|fl-16").source, "reconcile")
  const orderCartCall = h.graphCalls.find((call) => call.entity === "order_cart")
  assert.deepEqual(orderCartCall.fields, ["order_id", "cart_id"])
  // (b) Recent non-draft orders without an order_op row get one; drafts, older orders and present rows do not.
  assert.deepEqual(h.ensured, [[ids.X, ids.Z, ids.A]])
  assert.equal(stats.ops_created, 3)
  // (c) X gets its missing TikTok row (skipped: TikTok is off); Y has both; Z staff, W imported and V draft get nothing.
  assert.equal(stats.rows_added, 1)
  const added = h.db.events.get("tiktok|Purchase|fl-11")
  assert.deepEqual([added.status, added.destination, added.source, added.order_id], ["skipped", "", "reconcile", ids.X])
  for (const display of [13, 14, 15]) {
    assert.ok(!h.db.events.has(`meta|Purchase|fl-${display}`) && !h.db.events.has(`tiktok|Purchase|fl-${display}`), String(display))
  }
  assert.equal(h.db.events.get("meta|Purchase|fl-11").status, "skipped", "an existing row is never replaced")
  assert.ok(h.flushes.length >= 1)

  const second = plain(await h.purchase.runReconcile(h.container))
  assert.deepEqual([second.recorded, second.ops_created, second.rows_added], [0, 0, 0])
})

test("reconcile runs every part even when one fails, then reports the first error", async () => {
  const h = harness({ failGraph: /order_cart/ })
  await h.purchase.stashCartContext(h.container, CART_ID, ctx())
  h.db.cartContexts.get(CART_ID).updated_at -= 5 * 60_000
  await assert.rejects(h.purchase.runReconcile(h.container), /graph unavailable/)
  assert.deepEqual(h.ensured, [[ORDER_ID]], "(b) still ran")
  await assert.rejects(h.purchase.reconcilePurchases(h.container), /graph unavailable/)
  assert.equal(await harness().purchase.reconcilePurchases(harness().container), undefined)
})

test("the reconcile job registers with the jobs registry and runs every 5 minutes", async () => {
  const registered = [], runs = []
  const reconcilePurchases = async () => undefined
  const job = makeLoader({
    "../lib/tracking/jobs": {
      registerTrackingJob: (name, spec) => registered.push({ name, spec }),
      runTrackingJob: async (container, name, run) => runs.push({ container, name, run }),
    },
    "../lib/tracking/purchase": { reconcilePurchases },
  })("jobs/tracking-reconcile.ts")
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, "reconcile")
  assert.equal(registered[0].spec.staleAfterMs, 900000)
  assert.equal(registered[0].spec.run, reconcilePurchases)
  const container = {}
  await job.default(container)
  assert.deepEqual(runs, [{ container, name: "reconcile", run: reconcilePurchases }])
  assert.deepEqual(plain(job.config), { name: "tracking-reconcile", schedule: "*/5 * * * *" })
})
