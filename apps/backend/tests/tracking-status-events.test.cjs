// COD status events (TRACKING.md 7, I2; WP06): which events a workflow move
// produces, and enqueueStatusEvents' skips, rows and idempotency against an
// in-memory fake of the tracking tables. Source files are transpiled into vm
// sandboxes; order-events.ts, db.ts, settings.ts and the Meta adapter are the
// real ones, only scheduleFlush is a spy.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const DATASET = "2247389409441720"
const LIVE_DATASET = "650439547920083"
const PIXEL = "CTESTPIXEL0000000001"
const ORDER_ID = "order_01JTESTORDER0000000000001"
const VARIANT = "variant_01JTESTVARIANT000000001"
const VID = "v1.1790467200.0123456789abcdef"
const CREATED = new Date(Date.now() - 3 * 86_400_000).toISOString()
const STATUSES = ["processing", "confirmed", "shipped", "delivered", "returned", "refunded", "cancelled"]

const plain = (value) => JSON.parse(JSON.stringify(value))
const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex")
const unix = (value) => Math.floor(new Date(value).getTime() / 1000)

const compiled = new Map()
function compile(filename) {
  if (!compiled.has(filename)) {
    compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText)
  }
  return compiled.get(filename)
}

/** Relative imports load the real neighbouring files unless `stubs` maps the specifier; bare imports must be stubbed. */
function makeLoader(stubs = {}, globals = {}) {
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
  return (file) => loadFile(path.join(SRC, file))
}

const utils = { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query", LOGGER: "logger" } }
const settingsLib = makeLoader({ "@medusajs/framework/utils": utils, "../../modules/tracking": { TRACKING_MODULE: "tracking" } })("lib/tracking/settings.ts")

/** DEFAULT_CONFIG with Meta on, plus a one-level-deep patch. */
function config(patch = {}) {
  const base = plain(settingsLib.DEFAULT_CONFIG)
  base.meta.enabled = true
  for (const [key, value] of Object.entries(patch)) {
    base[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[key], ...value } : value
  }
  return base
}

function order(patch = {}) {
  return {
    id: ORDER_ID, display_id: 1234, created_at: CREATED, total: 1473,
    currency_code: "bdt", email: "buyer@example.com", is_draft_order: false,
    items: [{ variant_id: VARIANT, quantity: 1, unit_price: 1400, title: "Zebra Stark" }],
    shipping_address: { first_name: "Md", last_name: "Shamim", phone: "01712345678", province: "Dhaka" },
    metadata: {},
    ...patch,
  }
}

/** A stored tracking_order_context row, as recordPurchase keeps it. */
function contextRow(patch = {}, context = {}) {
  return {
    order_id: ORDER_ID, display_id: 1234, cart_id: "cart_01JTESTCART00000000000001", host: "new.florayn.com", env: "test",
    context: {
      v: 1, host: "new.florayn.com", page_url: "https://new.florayn.com/checkout/", edge: true,
      ip: "203.0.113.7", ua: "Mozilla/5.0 Test", vid: VID, sid: "s1.1790467200.01234567", src: "meta_paid", camp: null,
      fbp: "fb.1.1790467200000.123456789", fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null, wbraid: null,
      country: "BD", device: "mobile", audience: "women", new: true, staff: false, optout: false, consent_version: 1,
      ...context,
    },
    trusted: true, staff: false, optout: false, purchase_time: new Date(CREATED),
    ...patch,
  }
}

const OUTBOX_COLUMNS = ["platform", "env", "destination", "event_name", "event_id", "event_time", "source",
  "order_id", "payload", "status", "last_error"]

/** tracking_order_context, order_op and tracking_event in memory; `raw` interprets the statements WP06 issues. */
class FakeDb {
  constructor() {
    this.orderContexts = new Map()
    this.orderOps = new Map()
    this.events = new Map()
    this.statements = []
    this.transactions = 0
    this.failOn = null
  }

  async transaction(fn) {
    const saved = new Map(this.events)
    this.transactions += 1
    try {
      return await fn({ raw: (sql, bindings) => this.raw(sql, bindings, true) })
    } catch (error) {
      this.events = saved
      throw error
    }
  }

  async raw(sql, bindings = [], inTransaction = false) {
    const s = squash(sql)
    this.statements.push({ sql: s, inTransaction })
    if (this.failOn && this.failOn.test(s)) throw Object.assign(new Error("injected failure for 01712345678"), { code: "57014" })
    if (s === "set local statement_timeout = '5s'") return { rows: [] }
    if (s.startsWith("select order_id, display_id, cart_id, host, env, context, trusted, staff, optout, purchase_time from tracking_order_context where order_id in (")) {
      return { rows: bindings.map((id) => this.orderContexts.get(id)).filter(Boolean) }
    }
    if (/^select order_id from order_op where order_id in \([?, ]+\) and source is not null and source <> '' and deleted_at is null$/.test(s)) {
      return { rows: bindings.filter((id) => this.orderOps.get(id)?.source).map((order_id) => ({ order_id })) }
    }
    if (s.startsWith("insert into tracking_event")) {
      assert.match(s, /on conflict \(platform, event_name, event_id\) do nothing$/)
      let inserted = 0
      for (let i = 0; i < bindings.length; i += OUTBOX_COLUMNS.length) {
        const row = Object.fromEntries(OUTBOX_COLUMNS.map((column, j) => [column, bindings[i + j]]))
        row.payload = row.payload == null ? null : JSON.parse(row.payload)
        const key = `${row.platform}|${row.event_name}|${row.event_id}`
        if (this.events.has(key)) continue
        this.events.set(key, row)
        inserted += 1
      }
      return { rowCount: inserted }
    }
    throw new Error(`Unexpected SQL: ${s}`)
  }
}

function harness(options = {}) {
  const db = new FakeDb()
  for (const row of options.contexts ?? [contextRow()]) db.orderContexts.set(row.order_id, row)
  for (const row of options.ops ?? []) db.orderOps.set(row.order_id, row)
  const orders = new Map((options.orders ?? [order()]).map((row) => [row.id, row]))
  const flushes = [], graphCalls = [], logs = []
  const settingsRow = {
    id: "trackset_default", config: options.config ?? config(),
    meta_test_token: "EAAtesttoken", meta_live_token: "EAAlivetoken", tiktok_test_token: "tt", tiktok_live_token: "tt",
    catalog_feed_token: null, ...options.tokens,
  }
  const services = {
    pg: db,
    query: {
      async graph({ entity, fields, filters }) {
        graphCalls.push({ entity, fields: [...fields], filters })
        if (entity === "order" && filters.id) return { data: [...filters.id].map((id) => orders.get(id)).filter(Boolean) }
        throw new Error(`Unexpected graph ${entity}`)
      },
    },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line) },
    tracking: { listTrackingSettings: async () => [settingsRow] },
    ...options.services,
  }
  const container = { resolve: (key) => { if (!Object.hasOwn(services, key)) throw new Error(`resolve ${key}`); return services[key] } }
  const load = makeLoader({
    "@medusajs/framework/utils": utils,
    "../../modules/tracking": { TRACKING_MODULE: "tracking" },
    "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
    "./outbox": { scheduleFlush: (c) => flushes.push(c) },
  })
  return { db, orders, flushes, graphCalls, logs, settingsRow, container, load, lib: load("lib/tracking/status-events.ts") }
}

const move = (from, to, at = new Date(Date.now() - 1_000), orderId = ORDER_ID) => ({ orderId, from, to, at })
const rows = (h) => [...h.db.events.values()]

// ---------------------------------------------------------------- statusEventsFor

test("statusEventsFor: OrderConfirmed on a move into confirmed/shipped/delivered, Delivered and Returned on theirs", () => {
  const { lib } = harness()
  const events = (from, to) => [...lib.statusEventsFor(from, to)]
  assert.deepEqual(events("processing", "confirmed"), ["OrderConfirmed"])
  assert.deepEqual(events("processing", "shipped"), ["OrderConfirmed"], "a courier booking straight from processing counts")
  assert.deepEqual(events("processing", "delivered"), ["OrderConfirmed", "Delivered"])
  assert.deepEqual(events("shipped", "delivered"), ["Delivered"])
  assert.deepEqual(events("shipped", "returned"), ["Returned"])
  assert.deepEqual(events("cancelled", "confirmed"), ["OrderConfirmed"], "processing -> cancelled -> confirmed still counts")
  // Moving on along the workflow is not a new confirmation: a delivery more
  // than 8 days after the confirmation (its sent row pruned) must not send it twice.
  assert.deepEqual(events("confirmed", "shipped"), [])
  assert.deepEqual(events("confirmed", "delivered"), ["Delivered"])
  assert.deepEqual(events("returned", "delivered"), ["Delivered"])
  assert.deepEqual(events("refunded", "shipped"), ["OrderConfirmed"])
  for (const to of ["refunded", "cancelled", "processing"]) {
    for (const from of STATUSES) assert.deepEqual(events(from, to), [], `${from} -> ${to}`)
  }
  for (const status of STATUSES) assert.deepEqual(events(status, status), [], `${status} -> ${status}`)
  // The whole table, so a new rule cannot slip in unnoticed.
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = from === to ? [] : [
        ...(["confirmed", "shipped", "delivered"].includes(to) && !["confirmed", "shipped", "delivered", "returned"].includes(from) ? ["OrderConfirmed"] : []),
        ...(to === "delivered" ? ["Delivered"] : []),
        ...(to === "returned" ? ["Returned"] : []),
      ]
      assert.deepEqual(events(from, to), expected, `${from} -> ${to}`)
    }
  }
  assert.deepEqual(events(null, "confirmed"), ["OrderConfirmed"])
  assert.deepEqual(events("processing", undefined), [])
})

// ---------------------------------------------------------------- enqueueStatusEvents

test("a confirmed storefront order queues one Meta OrderConfirmed row: system generated, at the move time, after its Purchase", async () => {
  const h = harness({ config: config({ tiktok: { enabled: true, test_id: PIXEL } }) })
  const at = new Date(Date.now() - 2_000)
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("processing", "confirmed", at)]), 1)
  assert.equal(rows(h).length, 1, "Meta only, even with TikTok on")
  const [row] = plain(rows(h))
  assert.deepEqual({ ...row, payload: undefined }, {
    platform: "meta", env: "test", destination: DATASET, event_name: "OrderConfirmed", event_id: "oc-fl-1234",
    event_time: at.toISOString(), source: "status", order_id: ORDER_ID, payload: undefined, status: "pending", last_error: null,
  })
  const payload = row.payload
  assert.equal(payload.event_name, "OrderConfirmed")
  assert.equal(payload.event_id, "oc-fl-1234")
  assert.equal(payload.event_time, unix(at))
  assert.equal(payload.action_source, "system_generated")
  assert.ok(!("event_source_url" in payload))
  assert.deepEqual(payload.original_event_data, { event_name: "Purchase", event_time: unix(CREATED), order_id: "fl-1234", event_id: "fl-1234" })
  assert.deepEqual(payload.custom_data, { content_type: "product", content_ids: [VARIANT], value: 1473, currency: "BDT", order_id: "fl-1234" })
  // Share OFF: the visitor id, cookies and country only; no browser ip or user agent days after the visit.
  assert.deepEqual(Object.keys(payload.user_data).sort(), ["country", "external_id", "fbp"])
  assert.deepEqual(payload.user_data.external_id, [sha(VID)])
  const text = JSON.stringify(payload)
  for (const secret of [ORDER_ID, "01712345678", "buyer@example.com", "/order/"]) assert.ok(!text.includes(secret), secret)

  // One transaction with the statement timeout, then one flush; the order was read once.
  assert.equal(h.db.transactions, 1)
  const inside = h.db.statements.filter((s) => s.inTransaction).map((s) => s.sql.split(" (")[0])
  assert.deepEqual(inside, ["set local statement_timeout = '5s'", "insert into tracking_event"])
  assert.equal(h.flushes.length, 1)
  assert.deepEqual(plain(h.graphCalls.map((c) => [c.entity, c.filters.id])), [["order", [ORDER_ID]]])
})

test("each move gets its events: delivered adds Delivered, returned gives Returned, other moves nothing", async () => {
  const at = new Date(Date.now() - 1_000)
  const cases = [
    [["processing", "delivered"], ["OrderConfirmed|oc-fl-1234", "Delivered|dl-fl-1234"]],
    [["shipped", "delivered"], ["Delivered|dl-fl-1234"]],
    [["processing", "shipped"], ["OrderConfirmed|oc-fl-1234"]],
    [["shipped", "returned"], ["Returned|rt-fl-1234"]],
    [["cancelled", "confirmed"], ["OrderConfirmed|oc-fl-1234"]],
    [["shipped", "refunded"], []],
    [["confirmed", "cancelled"], []],
    [["confirmed", "shipped"], []],
    [["shipped", "processing"], []],
    [["delivered", "delivered"], []],
  ]
  for (const [[from, to], expected] of cases) {
    const h = harness()
    await h.lib.enqueueStatusEvents(h.container, [move(from, to, at)])
    assert.deepEqual(rows(h).map((row) => `${row.event_name}|${row.event_id}`), expected, `${from} -> ${to}`)
    for (const row of rows(h)) {
      assert.equal(row.payload.action_source, "system_generated")
      assert.equal(row.payload.event_time, unix(at))
    }
    if (!expected.length) assert.deepEqual(h.db.statements, [], `${from} -> ${to} touches nothing`)
  }
})

test("orders without a usable context, drafts and imported orders queue nothing", async () => {
  const skipped = [
    ["no context", { contexts: [] }],
    ["untrusted", { contexts: [contextRow({ trusted: false })] }],
    ["staff", { contexts: [contextRow({ staff: true })] }],
    ["opted out", { contexts: [contextRow({ optout: true })] }],
    ["unknown host", { contexts: [contextRow({ env: null })] }],
  ]
  for (const [label, options] of skipped) {
    const h = harness(options)
    assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("processing", "delivered")]), 0, label)
    assert.equal(rows(h).length, 0, label)
    assert.equal(h.graphCalls.length, 0, `${label}: no order lookup`)
    assert.equal(h.db.transactions, 0, label)
    assert.equal(h.flushes.length, 0, label)
  }
  const draft = harness({ orders: [order({ is_draft_order: true })] })
  assert.equal(await draft.lib.enqueueStatusEvents(draft.container, [move("processing", "confirmed")]), 0)
  const imported = harness({ ops: [{ order_id: ORDER_ID, source: "florayn.com" }] })
  assert.equal(await imported.lib.enqueueStatusEvents(imported.container, [move("processing", "confirmed")]), 0)
  const missing = harness({ orders: [] })
  assert.equal(await missing.lib.enqueueStatusEvents(missing.container, [move("processing", "confirmed")]), 0)
  for (const h of [draft, imported, missing]) {
    assert.equal(rows(h).length, 0)
    assert.equal(h.db.transactions, 0)
    assert.equal(h.flushes.length, 0)
  }
  const none = harness()
  assert.equal(await none.lib.enqueueStatusEvents(none.container, []), 0)
  assert.equal(await none.lib.enqueueStatusEvents(none.container, [{ orderId: "", from: "processing", to: "confirmed", at: new Date() }]), 0)
  assert.deepEqual(none.db.statements, [])
})

test("a toggle or platform that is off gives a skipped row; a missing token a blocked one", async () => {
  const toggles = config({ meta: { enabled: true, status_events: { OrderConfirmed: true, Delivered: false, Returned: true } } })
  const h = harness({ config: toggles })
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("processing", "delivered")]), 2)
  const byName = Object.fromEntries(rows(h).map((row) => [row.event_name, row]))
  assert.deepEqual([byName.OrderConfirmed.status, byName.OrderConfirmed.last_error], ["pending", null])
  assert.deepEqual([byName.Delivered.status, byName.Delivered.destination, byName.Delivered.last_error],
    ["skipped", DATASET, "skipped: Delivered events are off"])
  assert.equal(byName.Delivered.payload.event_id, "dl-fl-1234", "the payload is kept for Send skipped")
  assert.equal(h.flushes.length, 1)

  const metaOff = harness({ config: config({ meta: { enabled: false } }) })
  await metaOff.lib.enqueueStatusEvents(metaOff.container, [move("processing", "confirmed")])
  assert.deepEqual(rows(metaOff).map((row) => [row.status, row.last_error]), [["skipped", "skipped: Meta is off"]])

  const noId = harness({ config: config({ meta: { enabled: true, test_id: "" } }) })
  await noId.lib.enqueueStatusEvents(noId.container, [move("processing", "confirmed")])
  assert.deepEqual(rows(noId).map((row) => [row.status, row.destination, row.payload]), [["skipped", "", null]])

  const noToken = harness({ tokens: { meta_test_token: null } })
  await noToken.lib.enqueueStatusEvents(noToken.container, [move("processing", "confirmed")])
  assert.deepEqual(rows(noToken).map((row) => [row.status, row.last_error, row.payload.event_id]), [["blocked", "no token", "oc-fl-1234"]])
})

test("the destination is the context's stored environment, not today's host role", async () => {
  // Stored before live sending was armed: stays on TEST even after arming.
  const armedLater = harness({ config: config({ live_armed: true }), contexts: [contextRow({ host: "florayn.com", env: "test" })] })
  await armedLater.lib.enqueueStatusEvents(armedLater.container, [move("processing", "confirmed")])
  assert.deepEqual(rows(armedLater).map((row) => [row.env, row.destination]), [["test", DATASET]])
  // Stored live: stays live after disarming.
  const disarmed = harness({ config: config({ live_armed: false }), contexts: [contextRow({ host: "florayn.com", env: "live" })] })
  await disarmed.lib.enqueueStatusEvents(disarmed.container, [move("processing", "confirmed")])
  assert.deepEqual(rows(disarmed).map((row) => [row.env, row.destination]), [["live", LIVE_DATASET]])
})

test("each event is queued once per order: repeats and duplicate moves add no rows", async () => {
  const h = harness()
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("processing", "confirmed")]), 1)
  const first = plain(rows(h))
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("processing", "confirmed")]), 0)
  // Confirmed again after a cancellation: the outbox key keeps the first row.
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("cancelled", "confirmed")]), 0)
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("confirmed", "shipped")]), 0)
  assert.deepEqual(plain(rows(h)), first, "the first row is kept as it was")
  assert.equal(h.flushes.length, 1, "no flush when nothing was inserted")
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("shipped", "delivered")]), 1)
  assert.deepEqual(rows(h).map((row) => row.event_id), ["oc-fl-1234", "dl-fl-1234"])
  assert.equal(await h.lib.enqueueStatusEvents(h.container, [move("shipped", "delivered")]), 0)

  // Two moves of one order in one call: one row per event, the first move's time.
  const twice = harness()
  const early = new Date(Date.now() - 5_000)
  await twice.lib.enqueueStatusEvents(twice.container, [move("processing", "confirmed", early), move("cancelled", "shipped")])
  assert.deepEqual(rows(twice).map((row) => [row.event_id, new Date(row.event_time).toISOString()]), [["oc-fl-1234", early.toISOString()]])
})

test("several orders are handled in one lookup and one transaction", async () => {
  const other = "order_01JTESTORDER0000000000002"
  const staffOrder = "order_01JTESTORDER0000000000003"
  const h = harness({
    contexts: [contextRow(), contextRow({ order_id: other, display_id: 1235 }), contextRow({ order_id: staffOrder, display_id: 1236, staff: true })],
    orders: [order(), order({ id: other, display_id: 1235 }), order({ id: staffOrder, display_id: 1236 })],
  })
  const inserted = await h.lib.enqueueStatusEvents(h.container, [
    move("processing", "confirmed"), move("shipped", "returned", new Date(), other), move("processing", "confirmed", new Date(), staffOrder),
    move("processing", "confirmed", new Date(), "order_without_context"),
  ])
  assert.equal(inserted, 2)
  assert.deepEqual(rows(h).map((row) => row.event_id).sort(), ["oc-fl-1234", "rt-fl-1235"])
  assert.equal(h.graphCalls.length, 1)
  assert.deepEqual(plain(h.graphCalls[0].filters.id).sort(), [ORDER_ID, other].sort(), "only sendable contexts are looked up")
  assert.equal(h.db.transactions, 1)
})

test("a database failure rolls the rows back and is thrown to the caller", async () => {
  const h = harness()
  h.db.failOn = /^insert into tracking_event/
  await assert.rejects(h.lib.enqueueStatusEvents(h.container, [move("processing", "confirmed")]), /injected failure/)
  assert.equal(rows(h).length, 0)
  assert.equal(h.flushes.length, 0)
})

// ---------------------------------------------------------------- through lib/order-status.ts

/** The order-ops module service in memory. */
function fakeOps(rows) {
  const state = new Map(rows.map((row) => [row.id, { ...row }]))
  const service = {
    state, updates: [],
    async listOrderOps(filter, config) {
      let list = [...state.values()]
      for (const [key, value] of Object.entries(filter)) list = list.filter((row) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
      return list.slice(0, config?.take ?? list.length).map((row) => ({ ...row }))
    },
    async createOrderOps(data) {
      for (const [i, row] of (Array.isArray(data) ? data : [data]).entries()) state.set(`oop_new_${i}`, { id: `oop_new_${i}`, source: null, ...row })
    },
    async updateOrderOps(data) {
      if (service.fail) throw new Error("update failed")
      service.updates.push(data)
      for (const row of Array.isArray(data) ? data : [data]) Object.assign(state.get(row.id), row)
    },
  }
  return service
}

test("moveOrdersToStatus queues OrderConfirmed for a storefront order; a tracking failure never fails the move", async () => {
  const ops = fakeOps([{ id: "oop_1", order_id: ORDER_ID, workflow_status: "processing", source: null }])
  const h = harness({ services: { order_ops: ops } })
  const status = h.load("lib/order-status.ts")
  await status.moveOrdersToStatus(h.container, [ORDER_ID], "confirmed")
  assert.equal(ops.state.get("oop_1").workflow_status, "confirmed")
  assert.deepEqual(rows(h).map((row) => [row.event_id, row.source, row.status]), [["oc-fl-1234", "status", "pending"]])

  // Back to processing and forward again: still one OrderConfirmed.
  await status.moveOrdersToStatus(h.container, [ORDER_ID], "processing")
  await status.moveOrdersToStatus(h.container, [ORDER_ID], "confirmed")
  assert.equal(rows(h).length, 1)

  // The outbox insert fails: the status still moves, one short line is logged without order data.
  h.db.failOn = /^insert into tracking_event/
  await status.moveOrdersToStatus(h.container, [ORDER_ID], "delivered")
  assert.equal(ops.state.get("oop_1").workflow_status, "delivered")
  assert.equal(rows(h).length, 1)
  assert.equal(h.logs.length, 1)
  assert.match(h.logs[0], /^Order status: the ad events for 1 order \(staff\) were not queued \(Error 57014\)\.$/)
  assert.ok(!h.logs[0].includes("01712345678") && !h.logs[0].includes(ORDER_ID))
})
