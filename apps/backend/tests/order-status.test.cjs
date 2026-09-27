// The one order status transition function (TRACKING.md 7; WP06):
// applyStatusChanges and moveOrdersToStatus in lib/order-status.ts, the four
// writers that now go through it (staff status route, courier send, courier
// sync, Steadfast webhook) with their responses unchanged, and a static scan
// that no other file writes workflow_status. Source files are transpiled into
// vm sandboxes; the order-ops module service is an in-memory fake and
// enqueueStatusEvents is a spy (tracking-status-events.test.cjs covers it).
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const plain = (value) => JSON.parse(JSON.stringify(value))
const isDate = (value) => Object.prototype.toString.call(value) === "[object Date]"
const tick = async (times = 5) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)) }

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

const utils = { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query", LOGGER: "logger" }, Modules: {} }

/** The order-ops module service in memory: every update call is recorded as given. */
function fakeOps(rows = []) {
  const state = new Map()
  const blank = { source: null, steadfast_consignment_id: null, steadfast_tracking_code: null, steadfast_status: null,
    steadfast_synced_at: null, label_printed_at: null, status_changed_at: null, courier_meta: null, note: null }
  for (const row of rows) state.set(row.id, { ...blank, ...row })
  let seq = 0
  const service = {
    state, updates: [], creates: [], fail: false,
    async listOrderOps(filter = {}, config = {}) {
      let list = [...state.values()]
      for (const [key, value] of Object.entries(filter)) list = list.filter((row) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
      return list.slice(0, config.take ?? list.length).map((row) => ({ ...row }))
    },
    async createOrderOps(data) {
      const list = Array.isArray(data) ? data : [data]
      service.creates.push(Array.from(list, (row) => ({ ...row })))
      for (const row of list) {
        const id = `oop_new_${++seq}`
        state.set(id, { ...blank, id, ...row })
      }
    },
    async updateOrderOps(data) {
      if (service.fail) throw new Error("update failed")
      const list = Array.isArray(data) ? data : [data]
      service.updates.push(Array.from(list, (row) => ({ ...row })))
      for (const row of list) {
        if (!state.has(row.id)) throw new Error(`OrderOp with id ${row.id} was not found`)
        Object.assign(state.get(row.id), row)
      }
    },
  }
  return service
}

function harness(options = {}) {
  const ops = fakeOps(options.ops)
  const orders = new Map((options.orders ?? []).map((row) => [row.id, row]))
  const enqueued = [], logs = [], bulkCalls = [], timers = []
  const query = {
    async graph({ entity, filters }) {
      if (entity !== "order") throw new Error(`Unexpected graph ${entity}`)
      if (filters.id) return { data: [...filters.id].map((id) => orders.get(id)).filter(Boolean) }
      if (filters.display_id) return { data: [...orders.values()].filter((row) => row.display_id === filters.display_id) }
      throw new Error("Unexpected filter")
    },
  }
  const services = { order_ops: ops, query, logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line) } }
  const container = { resolve: (key) => { if (!Object.hasOwn(services, key)) throw new Error(`resolve ${key}`); return services[key] } }
  const enqueue = options.enqueue ?? (async (_container, transitions) => { enqueued.push(plain(transitions)); return transitions.length })
  const baseStubs = { "@medusajs/framework/utils": utils, "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" } }
  const steadfast = makeLoader(baseStubs)("lib/steadfast.ts")
  const courier = {
    ...steadfast,
    getCourierSettings: async () => ({ webhook_token: "hook-token-0123456789" }),
    createBulkConsignments: async (_container, inputs) => { bulkCalls.push(plain(inputs)); return options.bulk(inputs) },
    statusByConsignment: async (_container, id) => options.statuses?.[id] ?? { ok: false, error: "unknown" },
  }
  const load = makeLoader({
    ...baseStubs,
    "./tracking/status-events": { enqueueStatusEvents: (...args) => enqueue(...args) },
    "../../../../lib/steadfast": courier,
    "../../../lib/steadfast": courier,
    "node:timers/promises": { setTimeout: async () => {} },
  }, options.globals ?? {
    setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, ms) },
  })
  return { ops, orders, enqueued, logs, bulkCalls, timers, container, load, status: load("lib/order-status.ts") }
}

function response() {
  return {
    code: 200, body: undefined,
    status(code) { this.code = code; return this },
    json(body) { this.body = plain(body); return this },
  }
}

const op = (id, orderId, status, patch = {}) => ({ id, order_id: orderId, workflow_status: status, ...patch })

// ---------------------------------------------------------------- applyStatusChanges

test("applyStatusChanges writes every change in ONE updateOrderOps call; status fields only on a real move", async () => {
  const h = harness({ ops: [
    op("oop_a", "order_a", "processing"),
    op("oop_b", "order_b", "shipped"),
    op("oop_c", "order_c", "processing", { source: "florayn.com" }),
    op("oop_d", "order_d", "delivered"),
  ] })
  const at = new Date("2026-09-27T08:00:00.000Z")
  const result = await h.status.applyStatusChanges(h.container, [
    { op: h.ops.state.get("oop_a"), to: "confirmed", at, via: "staff" },
    { op: h.ops.state.get("oop_b"), to: "shipped", extra: { steadfast_status: "in_review", workflow_status: "cancelled", status_changed_at: at, id: "oop_x" }, via: "courier-sync" },
    { op: h.ops.state.get("oop_c"), to: "shipped", extra: { steadfast_status: "in_review" }, via: "courier-send" },
    { op: h.ops.state.get("oop_d"), to: "delivered", via: "steadfast-webhook" },
  ])
  assert.deepEqual(plain(result), { updated: 3, changed: 2 })
  assert.equal(h.ops.updates.length, 1, "one call")
  const [rows] = h.ops.updates
  assert.deepEqual(rows.map((row) => Object.keys(row).sort()), [
    ["id", "status_changed_at", "workflow_status"],
    ["id", "steadfast_status"],
    ["id", "status_changed_at", "steadfast_status", "workflow_status"],
  ], "a change with nothing to write (oop_d) is left out; extra can never carry the status or the id")
  assert.deepEqual(rows.map((row) => [row.id, row.workflow_status]), [["oop_a", "confirmed"], ["oop_b", undefined], ["oop_c", "shipped"]])
  assert.equal(rows[0].status_changed_at, at, "the given time")
  assert.ok(isDate(rows[2].status_changed_at) && Math.abs(rows[2].status_changed_at.getTime() - Date.now()) < 5_000, "defaults to now")
  assert.equal(h.ops.state.get("oop_b").workflow_status, "shipped")
  // Only real moves of non-imported orders queue ad events.
  assert.deepEqual(h.enqueued, [[{ orderId: "order_a", from: "processing", to: "confirmed", at: at.toISOString() }]])
})

test("applyStatusChanges makes no call when nothing is written and queues nothing without a real move", async () => {
  const h = harness({ ops: [op("oop_a", "order_a", "shipped")] })
  assert.deepEqual(plain(await h.status.applyStatusChanges(h.container, [])), { updated: 0, changed: 0 })
  assert.deepEqual(plain(await h.status.applyStatusChanges(h.container, [{ op: h.ops.state.get("oop_a"), to: "shipped", via: "staff" }])), { updated: 0, changed: 0 })
  assert.equal(h.ops.updates.length, 0)
  await h.status.applyStatusChanges(h.container, [{ op: h.ops.state.get("oop_a"), to: "shipped", extra: { steadfast_status: "hold" }, via: "courier-sync" }])
  assert.equal(h.ops.updates.length, 1)
  assert.deepEqual(h.enqueued, [])
})

test("a failing, throwing or slow enqueue never fails or holds up the status update", async () => {
  const cases = {
    rejects: async () => { throw Object.assign(new Error("db down for 01712345678 order_a"), { code: "ECONNREFUSED" }) },
    throws: () => { throw new TypeError("boom") },
  }
  for (const [label, enqueue] of Object.entries(cases)) {
    const h = harness({ ops: [op("oop_a", "order_a", "processing")], enqueue })
    const result = await h.status.applyStatusChanges(h.container, [{ op: h.ops.state.get("oop_a"), to: "confirmed", via: "staff" }])
    assert.deepEqual(plain(result), { updated: 1, changed: 1 }, label)
    assert.equal(h.ops.state.get("oop_a").workflow_status, "confirmed", label)
    assert.equal(h.logs.length, 1, label)
    assert.match(h.logs[0], /^Order status: the ad events for 1 order \(staff\) were not queued \((Error ECONNREFUSED|TypeError)\)\.$/, label)
    assert.ok(!h.logs[0].includes("01712345678") && !h.logs[0].includes("order_a"), `${label}: no order data in the log`)
  }

  // A hung enqueue: the caller waits the 2 s budget (a fast fake timer here), then returns.
  let release
  const hung = harness({
    ops: [op("oop_a", "order_a", "processing"), op("oop_b", "order_b", "processing")],
    enqueue: () => new Promise((resolve) => { release = resolve }),
    globals: { setTimeout: (fn, ms) => { hung.timers.push(ms); return setTimeout(fn, 1) } },
  })
  const result = await hung.status.applyStatusChanges(hung.container, [
    { op: hung.ops.state.get("oop_a"), to: "confirmed", via: "staff" },
    { op: hung.ops.state.get("oop_b"), to: "shipped", via: "courier-send" },
  ])
  assert.deepEqual(plain(result), { updated: 2, changed: 2 })
  assert.deepEqual(hung.timers, [2000])
  assert.deepEqual(hung.logs, ["Order status: the ad events for 2 orders (staff, courier-send) are still being queued after 2000 ms."])
  release(2)
  await tick()
  assert.equal(hung.logs.length, 1)

  // A failed status write still throws, and then nothing is queued.
  const failed = harness({ ops: [op("oop_a", "order_a", "processing")] })
  failed.ops.fail = true
  await assert.rejects(failed.status.applyStatusChanges(failed.container, [{ op: failed.ops.state.get("oop_a"), to: "confirmed", via: "staff" }]), /update failed/)
  assert.deepEqual(failed.enqueued, [])
})

// ---------------------------------------------------------------- moveOrdersToStatus

/** lib/order-ops.ts setWorkflowStatus as it was before WP06, the reference moveOrdersToStatus reproduces. */
async function oldSetWorkflowStatus(service, orderIds, status) {
  const byOrder = async (ids) => new Map((await service.listOrderOps({ order_id: ids }, { take: ids.length })).map((row) => [row.order_id, row]))
  const before = await byOrder(orderIds)
  const missing = orderIds.filter((id) => !before.has(id))
  if (missing.length) await service.createOrderOps(missing.map((order_id) => ({ order_id, workflow_status: "processing" })))
  const existing = await byOrder(orderIds)
  const updates = orderIds.map((id) => existing.get(id)).filter(Boolean)
    .map((row) => ({ id: row.id, workflow_status: status, ...(row.workflow_status !== status ? { status_changed_at: new Date() } : {}) }))
  if (updates.length) await service.updateOrderOps(updates)
}

test("moveOrdersToStatus reproduces the old setWorkflowStatus rows and queues the real moves", async () => {
  const start = () => [op("oop_a", "order_a", "processing"), op("oop_b", "order_b", "confirmed"),
    op("oop_c", "order_c", "cancelled"), op("oop_i", "order_i", "processing", { source: "florayn.com" })]
  const ids = ["order_a", "order_b", "order_new", "order_c", "order_i"]
  const h = harness({ ops: start() })
  await h.status.moveOrdersToStatus(h.container, [...ids, "order_a"], "confirmed")

  const reference = fakeOps(start())
  await oldSetWorkflowStatus(reference, ids, "confirmed")
  const shape = (service) => [...service.state.values()].map((row) => [row.order_id, row.workflow_status, isDate(row.status_changed_at)])
  assert.deepEqual(shape(h.ops), shape(reference), "the same end state")
  assert.deepEqual(h.ops.creates, reference.creates, "the same new rows (default processing)")
  // The same rows for every real move; a row already in that status is not rewritten.
  const moved = (rows) => rows.filter((row) => row.status_changed_at).map((row) => ({ ...row, status_changed_at: "t" }))
  assert.equal(h.ops.updates.length, 1)
  assert.deepEqual(h.ops.updates[0].map((row) => ({ ...row, status_changed_at: "t" })), moved(reference.updates[0]))
  assert.deepEqual(h.ops.updates[0].map((row) => row.id), ["oop_a", "oop_new_1", "oop_c", "oop_i"])
  assert.deepEqual(h.enqueued.map((list) => list.map((t) => `${t.orderId}:${t.from}->${t.to}`)),
    [["order_a:processing->confirmed", "order_new:processing->confirmed", "order_c:cancelled->confirmed"]], "never for the imported order")
})

// ---------------------------------------------------------------- the writers

test("POST /admin/order-ops/status moves orders through moveOrdersToStatus with the same answers", async () => {
  const h = harness({ ops: [op("oop_a", "order_a", "processing")] })
  const { POST } = h.load("api/admin/order-ops/status/route.ts")
  const call = async (body) => { const res = response(); await POST({ body, scope: h.container }, res); return [res.code, res.body] }
  assert.deepEqual(await call({ order_ids: [], status: "confirmed" }), [400, { message: "No orders selected." }])
  assert.deepEqual(await call({ order_ids: ["order_a"], status: "lost" }), [400, { message: "Unknown status." }])
  assert.deepEqual(await call({ order_ids: ["order_a", 7, ""], status: "confirmed" }), [200, { success: true, updated: 1 }])
  assert.equal(h.ops.state.get("oop_a").workflow_status, "confirmed")
  assert.deepEqual(h.enqueued.map((list) => list.map((t) => t.to)), [["confirmed"]])
})

function managedOrder(id, displayId, phone = "01712345678") {
  return { id, display_id: displayId, total: 1473, metadata: {}, items: [{ title: "Case", quantity: 1 }],
    shipping_address: { first_name: "Md", last_name: "Shamim", address_1: "House 4", province: "Dhaka", phone } }
}

test("POST /admin/courier/send books, stamps the Steadfast fields and moves to shipped in one transition call", async () => {
  const h = harness({
    ops: [
      op("oop_a", "order_a", "processing"),
      op("oop_b", "order_b", "shipped"),
      op("oop_c", "order_c", "shipped", { steadfast_consignment_id: "900", steadfast_tracking_code: "TRK900" }),
      op("oop_i", "order_i", "processing", { source: "florayn.com" }),
      op("oop_e", "order_e", "processing"),
      op("oop_r", "order_r", "processing"),
    ],
    orders: [managedOrder("order_a", 101), managedOrder("order_b", 102), managedOrder("order_c", 103), managedOrder("order_i", 104),
      managedOrder("order_e", 105, "123"), managedOrder("order_r", 106), managedOrder("order_n", 107)],
    bulk: (inputs) => ({ ok: true, results: inputs.map((input) => input.invoice === "106"
      ? { invoice: "106", ok: false, error: "Invalid address" }
      : { invoice: input.invoice, ok: true, consignment_id: `c${input.invoice}`, tracking_code: `T${input.invoice}`, status: input.invoice === "107" ? undefined : "in_review" }) }),
  })
  const { POST } = h.load("api/admin/courier/send/route.ts")
  const res = response()
  await POST({ body: { order_ids: ["order_a", "order_b", "order_c", "order_i", "order_e", "order_r", "order_n", "order_x"] }, scope: h.container }, res)
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, {
    success: true,
    sent: 3,
    results: [
      { order_id: "order_c", ok: true, tracking_code: "TRK900", consignment_id: "900", error: "Already sent." },
      { order_id: "order_i", ok: false, error: "#104 came from florayn.com and is handled there." },
      { order_id: "order_e", ok: false, error: "No valid 11-digit phone." },
      { order_id: "order_x", ok: false, error: "Order not found." },
      { order_id: "order_a", ok: true, tracking_code: "T101", consignment_id: "c101" },
      { order_id: "order_b", ok: true, tracking_code: "T102", consignment_id: "c102" },
      { order_id: "order_r", ok: false, error: "Invalid address" },
      { order_id: "order_n", ok: true, tracking_code: "T107", consignment_id: "c107" },
    ],
  })
  assert.deepEqual(h.bulkCalls[0].map((input) => input.invoice), ["101", "102", "106", "107"])
  assert.equal(h.ops.updates.length, 1, "one update call for the whole booking")
  const rows = h.ops.updates[0]
  const created = [...h.ops.state.values()].find((row) => row.order_id === "order_n").id
  assert.deepEqual(rows.map((row) => row.id), ["oop_a", "oop_b", created])
  for (const row of rows) assert.ok(isDate(row.steadfast_synced_at))
  assert.deepEqual(rows.map((row) => [row.steadfast_consignment_id, row.steadfast_tracking_code, row.steadfast_status, row.workflow_status, isDate(row.status_changed_at)]), [
    ["c101", "T101", "in_review", "shipped", true],
    ["c102", "T102", "in_review", undefined, false],
    ["c107", "T107", "in_review", "shipped", true],
  ], "an order already moved to shipped by hand keeps its status time")
  assert.deepEqual(h.enqueued.map((list) => list.map((t) => `${t.orderId}:${t.from}->${t.to}`)),
    [["order_a:processing->shipped", "order_n:processing->shipped"]])
  assert.equal(h.ops.state.get("oop_i").workflow_status, "processing", "an imported order is never booked or moved")
})

test("POST /admin/courier/send answers as before when Steadfast is not ready", async () => {
  const h = harness({ ops: [op("oop_a", "order_a", "processing")], orders: [managedOrder("order_a", 101)], bulk: () => ({ ok: false, error: "Courier is off." }) })
  const { POST } = h.load("api/admin/courier/send/route.ts")
  const res = response()
  await POST({ body: { order_ids: ["order_a"] }, scope: h.container }, res)
  assert.deepEqual([res.code, res.body], [400, { message: "Courier is off." }])
  assert.equal(h.ops.updates.length, 0)
  const empty = response()
  await POST({ body: {}, scope: h.container }, empty)
  assert.deepEqual([empty.code, empty.body], [400, { message: "No orders selected." }])
})

test("POST /admin/courier/sync advances only off shipped and still records every Steadfast status", async () => {
  const h = harness({
    ops: [
      op("oop_1", "order_1", "shipped", { steadfast_consignment_id: "101" }),
      op("oop_2", "order_2", "shipped", { steadfast_consignment_id: "102" }),
      op("oop_3", "order_3", "refunded", { steadfast_consignment_id: "103" }),
      op("oop_4", "order_4", "shipped", { steadfast_consignment_id: "104" }),
      op("oop_5", "order_5", "shipped"),
      op("oop_6", "order_6", "shipped", { steadfast_consignment_id: "106" }),
    ],
    statuses: {
      101: { ok: true, deliveryStatus: "delivered" },
      102: { ok: true, deliveryStatus: "in_review" },
      103: { ok: true, deliveryStatus: "delivered" },
      104: { ok: true, deliveryStatus: "cancelled" },
      106: { ok: false, error: "Steadfast error (500)." },
    },
  })
  const { POST } = h.load("api/admin/courier/sync/route.ts")
  const res = response()
  await POST({ body: {}, scope: h.container }, res)
  assert.deepEqual([res.code, res.body], [200, { success: true, checked: 4, changed: 2 }])
  assert.equal(h.ops.updates.length, 1)
  assert.deepEqual(h.ops.updates[0].map((row) => [row.id, row.steadfast_status, row.workflow_status, isDate(row.status_changed_at), isDate(row.steadfast_synced_at)]), [
    ["oop_1", "delivered", "delivered", true, true],
    ["oop_2", "in_review", undefined, false, true],
    ["oop_4", "cancelled", "returned", true, true],
  ])
  assert.deepEqual(h.enqueued.map((list) => list.map((t) => `${t.orderId}:${t.from}->${t.to}`)),
    [["order_1:shipped->delivered", "order_4:shipped->returned"]])

  // A manual refund is never overridden, but the Steadfast status is kept.
  const byId = response()
  await POST({ body: { order_ids: ["order_3", 5] }, scope: h.container }, byId)
  assert.deepEqual(byId.body, { success: true, checked: 1, changed: 0 })
  assert.deepEqual(Object.keys(h.ops.updates[1][0]).sort(), ["id", "steadfast_status", "steadfast_synced_at"])
  assert.equal(h.ops.state.get("oop_3").workflow_status, "refunded")
  assert.equal(h.enqueued.length, 1)

  // Nothing readable from Steadfast: no update at all.
  const none = response()
  await POST({ body: { order_ids: ["order_6"] }, scope: h.container }, none)
  assert.deepEqual(none.body, { success: true, checked: 1, changed: 0 })
  assert.equal(h.ops.updates.length, 2)
})

test("the Steadfast webhook merges courier_meta, advances only off shipped and is idempotent on retries", async () => {
  const h = harness({
    ops: [
      op("oop_w", "order_w", "shipped", { steadfast_consignment_id: "201", courier_meta: { charge: 60, tracking_message: "Picked up" } }),
      op("oop_v", "order_v", "shipped", { steadfast_consignment_id: "202" }),
      op("oop_r", "order_r", "refunded", { steadfast_consignment_id: "203" }),
    ],
    orders: [{ id: "order_v", display_id: 1234 }],
  })
  const { POST } = h.load("api/webhooks/steadfast/route.ts")
  const auth = { authorization: "Bearer hook-token-0123456789" }
  const call = async (body, headers = auth) => { const res = response(); await POST({ body, headers, scope: h.container }, res); return [res.code, res.body] }
  const push = { notification_type: "delivery_status", consignment_id: 201, status: "delivered", cod_amount: "1473", tracking_message: "Delivered", updated_at: "2026-09-27 10:00:00" }

  assert.deepEqual(await call(push, { authorization: "Bearer wrong" }), [401, { message: "Unauthorized" }])
  assert.equal(h.ops.updates.length, 0)

  assert.deepEqual(await call(push), [200, { received: true }])
  const [first] = h.ops.updates[0]
  assert.deepEqual(plain({ ...first, steadfast_synced_at: isDate(first.steadfast_synced_at), status_changed_at: isDate(first.status_changed_at) }), {
    id: "oop_w", steadfast_status: "delivered", steadfast_synced_at: true, workflow_status: "delivered", status_changed_at: true,
    courier_meta: { charge: 60, tracking_message: "Delivered", cod_amount: 1473, updated_at: "2026-09-27 10:00:00", event: "delivery_status" },
  })
  assert.deepEqual(h.enqueued, [[{ orderId: "order_w", from: "shipped", to: "delivered", at: plain(first.status_changed_at) }]])

  // Steadfast retries the same push: the order has moved already, so no status write and no second event.
  assert.deepEqual(await call(push), [200, { received: true }])
  assert.deepEqual(Object.keys(h.ops.updates[1][0]).sort(), ["courier_meta", "id", "steadfast_status", "steadfast_synced_at"])
  assert.equal(h.ops.state.get("oop_w").workflow_status, "delivered")
  assert.equal(h.enqueued.length, 1)

  // Invoice fallback (the order's display id) and a return.
  assert.deepEqual(await call({ data: { invoice: "#1234", status: "cancelled" } }), [200, { received: true }])
  assert.equal(h.ops.state.get("oop_v").workflow_status, "returned")
  assert.deepEqual(h.enqueued[1].map((t) => `${t.orderId}:${t.from}->${t.to}`), ["order_v:shipped->returned"])

  // A manual refund is never overridden.
  assert.deepEqual(await call({ consignment_id: "203", status: "delivered" }), [200, { received: true }])
  assert.equal(h.ops.state.get("oop_r").workflow_status, "refunded")
  assert.equal(h.enqueued.length, 2)

  // Other notifications and unknown parcels are acknowledged without a write.
  const writes = h.ops.updates.length
  assert.deepEqual(await call({ notification_type: "tracking_update", consignment_id: 201, status: "x" }), [200, { received: true }])
  assert.deepEqual(await call({ consignment_id: "999", status: "delivered" }), [200, { received: true }])
  assert.equal(h.ops.updates.length, writes)
})

// ---------------------------------------------------------------- static scan

const ALLOWED = new Set(["lib/order-status.ts", "lib/order-ops.ts", "lib/florayn-import.ts"])
const WRITE_CALL = /^(create|update|upsert)OrderOps$/
const RAW_WRITE = /\b(update\s+"?order_op"?\s+set|insert\s+into\s+"?order_op"?)\b[\s\S]*\bworkflow_status\b/i

function propertyName(node) {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null
}

function enclosingFunction(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.text
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text
  }
  return "<top level>"
}

/**
 * Where a file writes workflow_status: an object with that key that reaches a
 * create/update/upsertOrderOps call (directly, through a variable it is
 * assigned or pushed to, or through a `.workflow_status =` assignment on such
 * a variable), and raw SQL that updates or inserts order_op.workflow_status.
 */
function workflowStatusWrites(text, fileName = "file.ts") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const findings = []
  const all = []
  const visit = (node) => { all.push(node); ts.forEachChild(node, visit) }
  visit(source)

  function flowsInto(name) {
    const out = []
    for (const node of all) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) out.push(node.initializer)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = node.left
        if (ts.isIdentifier(left) && left.text === name) out.push(node.right)
        if (ts.isArrayLiteralExpression(left) && left.elements.some((e) => ts.isIdentifier(e) && e.text === name)) out.push(node.right)
        if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === name && left.name.text === "workflow_status") out.push(left)
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === name && ["push", "unshift", "set"].includes(node.expression.name.text)) out.push(...node.arguments)
    }
    return out
  }

  function writes(expr, seen) {
    let found = false
    const walk = (node) => {
      if (found) return
      if (ts.isPropertyAccessExpression(node) && node.name.text === "workflow_status" && ts.isBinaryExpression(node.parent) && node.parent.left === node) { found = true; return }
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && propertyName(node) === "workflow_status") { found = true; return }
      if (ts.isIdentifier(node) && !seen.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        seen.add(node.text)
        for (const next of flowsInto(node.text)) walk(next)
        if (found) return
      }
      ts.forEachChild(node, walk)
    }
    walk(expr)
    return found
  }

  for (const node of all) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_CALL.test(node.expression.name.text)) {
      if (node.arguments.some((arg) => writes(arg, new Set()))) findings.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, fn: enclosingFunction(node), kind: node.expression.name.text })
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && RAW_WRITE.test(node.getText())) {
      findings.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, fn: enclosingFunction(node), kind: "sql" })
    }
  }
  return findings
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

test("the scanner flags the pre-WP06 writer shapes and ignores reads", () => {
  const oldSend = `const updates: any[] = []
for (const r of results) updates.push({ id: op.id, steadfast_status: r.status, workflow_status: "shipped", status_changed_at: new Date() })
if (updates.length) await svc.updateOrderOps(updates)`
  const oldSync = `const updates: any[] = []
for (const op of targets) {
  const update: any = { id: op.id, steadfast_status: s }
  if (advance) { update.workflow_status = workflow; update.status_changed_at = new Date() }
  updates.push(update)
}
if (updates.length) await svc.updateOrderOps(updates)`
  const oldWebhook = `const update: any = { id: op.id }
if (x) update.workflow_status = workflow
await svc.updateOrderOps(update)`
  const oldStaff = `export async function setWorkflowStatus(container, orderIds, status) {
  const updates = orderIds.map((id) => existing.get(id)).map((op) => ({ id: op.id, workflow_status: status }))
  if (updates.length) await opsService(container).updateOrderOps(updates)
}`
  const rawSql = "await knex.raw(`update order_op set workflow_status = 'shipped' where id = ?`, [id])"
  for (const [label, text] of Object.entries({ oldSend, oldSync, oldWebhook, oldStaff, rawSql })) {
    assert.equal(workflowStatusWrites(text).length, 1, label)
  }
  const reads = `const ops = await svc.listOrderOps({ workflow_status: "shipped" }, { take: 60 })
await svc.updateOrderOps({ id: op.id, review_request_sent_at: new Date() })
const counts = await knex.raw("select workflow_status from order_op")
await svc.updateOrderOps(printed)`
  assert.deepEqual(workflowStatusWrites(reads), [])
})

test("no file writes workflow_status except lib/order-status.ts, the initial rows in lib/order-ops.ts and the import", () => {
  const offenders = []
  const allowed = {}
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join("/")
    const findings = workflowStatusWrites(fs.readFileSync(file, "utf8"), file)
    if (ALLOWED.has(relative)) allowed[relative] = findings
    else for (const finding of findings) offenders.push(`${relative}:${finding.line} (${finding.kind} in ${finding.fn})`)
  }
  assert.deepEqual(offenders, [])
  // order-ops.ts only creates rows at the default status; the transition lives in order-status.ts.
  assert.deepEqual(allowed["lib/order-ops.ts"].map((f) => `${f.kind}:${f.fn}`), ["createOrderOps:ensureOps", "createOrderOps:backfillOps"])
  assert.deepEqual(allowed["lib/order-status.ts"].map((f) => `${f.kind}:${f.fn}`), ["updateOrderOps:applyStatusChanges"])
  assert.ok(allowed["lib/florayn-import.ts"].length >= 1)
})

test("lib/order-ops.ts no longer has setWorkflowStatus, adds no import, and order-status.ts is never imported back", () => {
  const opsSource = fs.readFileSync(path.join(SRC, "lib/order-ops.ts"), "utf8")
  assert.ok(!/setWorkflowStatus/.test(opsSource))
  const imports = [...opsSource.matchAll(/^import .* from "([^"]+)"$/gm)].map((match) => match[1])
  assert.deepEqual(imports, ["@medusajs/framework/utils", "../modules/order-ops"])
  // No code anywhere still names it (comments may, for history).
  const names = (text, fileName) => {
    const found = []
    const visit = (node) => { if (ts.isIdentifier(node)) found.push(node.text); ts.forEachChild(node, visit) }
    visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
    return found
  }
  for (const file of sourceFiles(SRC)) {
    assert.ok(!names(fs.readFileSync(file, "utf8"), file).includes("setWorkflowStatus"), path.relative(SRC, file))
  }
  assert.ok(!/order-status/.test(opsSource), "order-ops.ts never imports order-status.ts")
  // The staff route and the three courier writers all go through lib/order-status.ts.
  for (const route of ["api/admin/order-ops/status/route.ts", "api/admin/courier/send/route.ts", "api/admin/courier/sync/route.ts", "api/webhooks/steadfast/route.ts"]) {
    const text = fs.readFileSync(path.join(SRC, route), "utf8")
    assert.match(text, /from "(\.\.\/)+lib\/order-status"/, route)
    assert.ok(!/\.updateOrderOps\(/.test(text), `${route} writes through applyStatusChanges only`)
  }
})
