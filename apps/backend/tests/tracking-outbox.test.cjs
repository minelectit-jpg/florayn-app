// The tracking outbox (lib/tracking/outbox.ts, health.ts), its job and the
// Health admin routes/page (TRACKING.md 6.3, 6.4, 4.6, 3.5). The real Meta
// and TikTok adapters run against an injected fetch; tracking_event lives in
// an in-memory fake that interprets the statements the sender issues.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const START = Date.UTC(2026, 8, 27, 6, 0, 0)
const DAY = 86_400_000
const DATASET = "2247389409441720"
const OTHER_DATASET = "1111111111111111"
const PIXEL = "CTESTPIXEL0000000001"
const TOKEN = "EAAtesttoken1234567890abcdefghijklmnop"

const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const plain = (value) => JSON.parse(JSON.stringify(value))
const tick = async (times = 20) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)) }

function clock(start = START) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, now: () => now, advance(ms) { now += ms }, set(ms) { now = ms } }
}

/** setTimeout/clearTimeout driven by the fake clock. */
function fakeTimers(time) {
  const timers = new Map()
  let next = 1
  return {
    delays: [],
    setTimeout(fn, ms) {
      const id = next++
      this.delays.push(ms)
      timers.set(id, { fn, at: time.now() + ms })
      return { id, unref() {} }
    },
    clearTimeout(handle) { if (handle) timers.delete(handle.id) },
    async advance(ms) {
      const until = time.now() + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        time.set(Math.max(time.now(), due[1].at))
        due[1].fn()
        await tick()
      }
      time.set(until)
    },
  }
}

/**
 * Transpiles TS files into vm sandboxes. Relative imports load the real
 * neighbouring files unless `stubs` maps the specifier; bare imports must be stubbed.
 */
function makeLoader(stubs, globals) {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, {
      exports, console, URL, Buffer, AbortSignal, JSON, ...globals,
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

// The real settings module for its pure parts (defaults, destinationFor, tokenFingerprint).
const realSettings = makeLoader({
  "@medusajs/framework/utils": { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query" } },
  "../../modules/tracking": { TRACKING_MODULE: "tracking" },
}, { Date })("lib/tracking/settings.ts")

function config(patch = {}) {
  const base = plain(realSettings.DEFAULT_CONFIG)
  base.meta.enabled = true
  base.tiktok.enabled = true
  base.tiktok.test_id = PIXEL
  base.meta.test_event_code = "TEST12345"
  for (const [key, value] of Object.entries(patch)) {
    base[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[key], ...value } : value
  }
  return base
}

/** tracking_event and tracking_state in memory; `raw` interprets the outbox statements. */
class FakeDb {
  constructor(time) {
    this.time = time
    this.events = []
    this.nextId = 1
    this.statements = []
    this.state = new Map()
    this.counters = {}
    this.inserted = []
    this.deletes = []
    this.deleteAnswer = () => 0
    this.variant = null
  }

  add(row) {
    const now = this.time.now()
    const event = {
      id: String(this.nextId++), platform: "meta", env: "test", destination: DATASET, event_name: "PageView",
      event_id: crypto.randomUUID(), event_time: new Date(now - 60_000), source: "browser", order_id: null,
      status: "pending", attempts: 0, next_attempt_at: new Date(now - 1000), locked_until: null, last_error: null,
      sent_at: null, created_at: new Date(now - 60_000), ...row,
    }
    if (!("payload" in row)) event.payload = payloadFor(event)
    this.events.push(event)
    return event
  }

  byId(id) { return this.events.find((event) => event.id === id) }

  async raw(sql, bindings = []) {
    const s = squash(sql)
    this.statements.push({ sql: s, bindings, at: this.time.now() })
    const now = this.time.now()
    if (s.startsWith("update tracking_event set status = 'sending'")) {
      const due = this.events
        .filter((e) => ["pending", "retry"].includes(e.status) && e.next_attempt_at.getTime() <= now && e.event_time.getTime() >= now - 6.5 * DAY)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, 500)
      for (const e of due) {
        e.status = "sending"
        e.locked_until = new Date(now + 120_000)
        e.attempts += 1
      }
      return { rowCount: due.length, rows: due.map((e) => ({ ...plain(e), event_time: new Date(e.event_time), id: e.id })) }
    }
    if (s.startsWith("update tracking_event set status = 'retry', next_attempt_at = now() where status = 'sending'")) {
      const stale = this.events.filter((e) => e.status === "sending" && e.locked_until && e.locked_until.getTime() < now)
      for (const e of stale) { e.status = "retry"; e.next_attempt_at = new Date(now) }
      return { rowCount: stale.length }
    }
    if (s.startsWith("update tracking_event set status = 'expired'")) {
      const old = this.events.filter((e) => ["pending", "retry"].includes(e.status) && e.event_time.getTime() < now - 6.5 * DAY).slice(0, 10_000)
      for (const e of old) { e.status = "expired"; e.payload = null; e.locked_until = null; e.last_error = e.last_error ?? "expired: not sent within 6.5 days" }
      return { rowCount: old.length }
    }
    if (s.startsWith("update tracking_event set status = 'retry', attempts = 0")) {
      const [platform, env] = bindings
      const rows = this.events.filter((e) => e.status === "blocked" && e.platform === platform && e.env === env && e.payload !== null && e.event_time.getTime() >= now - 6 * DAY)
      for (const e of rows) { e.status = "retry"; e.attempts = 0; e.next_attempt_at = new Date(now); e.locked_until = null }
      return { rowCount: rows.length }
    }
    if (s.startsWith("update tracking_event set status = 'retry', next_attempt_at = now(), attempts = 0")) {
      const statuses = bindings.filter((b) => ["blocked", "failed", "skipped"].includes(b))
      const rest = bindings.slice(statuses.length)
      const platform = /and platform = \?/.test(s) ? rest.shift() : null
      const env = /and env = \?/.test(s) ? rest.shift() : null
      const rows = this.events.filter((e) => statuses.includes(e.status) && e.payload !== null && e.event_time.getTime() >= now - 6 * DAY
        && (!platform || e.platform === platform) && (!env || e.env === env))
      for (const e of rows) { e.status = "retry"; e.attempts = 0; e.next_attempt_at = new Date(now); e.locked_until = null }
      return { rowCount: rows.length }
    }
    if (s.startsWith("update tracking_event as t set")) {
      assert.equal(bindings.length % 5, 0)
      for (let i = 0; i < bindings.length; i += 5) {
        const [id, status, delay, error, refund] = bindings.slice(i, i + 5)
        const e = this.byId(id)
        if (!e || e.status !== "sending") continue
        e.status = status
        if (delay !== null) e.next_attempt_at = new Date(now + delay)
        if (status === "sent" || status === "dry_run") e.sent_at = new Date(now)
        if (status === "sent" || status === "expired") e.payload = null
        if (refund) e.attempts = Math.max(e.attempts - 1, 0)
        e.last_error = error
        e.locked_until = null
      }
      return { rowCount: bindings.length / 5 }
    }
    if (s.startsWith("delete from")) {
      const table = s.match(/^delete from (\w+)/)[1]
      const n = this.deleteAnswer(table, s)
      this.deletes.push({ table, sql: s, n })
      return { rowCount: n }
    }
    if (s.startsWith("select variant_id, price from tracking_variant")) return { rows: this.variant ? [this.variant] : [] }
    throw new Error(`Unexpected SQL: ${s}`)
  }
}

function payloadFor(event) {
  const time = Math.floor(event.event_time.getTime() / 1000)
  if (event.platform === "tiktok") {
    return { event: "ViewContent", event_time: time, event_id: event.event_id, user: { external_id: "a".repeat(64) }, properties: { currency: "BDT", value: 1400 } }
  }
  return {
    event_name: event.event_name, event_time: time, event_id: event.event_id, action_source: "website",
    event_source_url: "https://new.florayn.com/", user_data: { client_user_agent: "Mozilla/5.0", external_id: ["a".repeat(64)] }, opt_out: false,
  }
}

function setup({ cfg = config(), tokens = { "meta:test": TOKEN, "tiktok:test": TOKEN, "meta:live": TOKEN, "tiktok:live": TOKEN }, env = {} } = {}) {
  const time = clock()
  const timers = fakeTimers(time)
  const db = new FakeDb(time)
  const proc = { env: { ...env } }
  const calls = []
  let fetchImpl = async () => { throw new Error("no fetch expected") }
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    return fetchImpl(url, init, body)
  }
  const dbStub = {
    trackingDb: (container) => container.db,
    async getState(d, key) { return d.state.has(key) ? plain(d.state.get(key)) : null },
    async setState(d, key, value) { d.state.set(key, plain(value)) },
    async bumpCounters(d, deltas) { for (const [k, n] of Object.entries(deltas)) d.counters[k] = (d.counters[k] ?? 0) + n },
    async insertOutbox(d, rows) { d.inserted.push(...rows); return rows.length },
  }
  const container = { db, cfg, tokens }
  const settingsStub = {
    ...realSettings,
    async loadTrackingSettings(c) { return { config: c.cfg, tokenSet: { meta: { test: Boolean(c.tokens["meta:test"]), live: Boolean(c.tokens["meta:live"]) }, tiktok: { test: Boolean(c.tokens["tiktok:test"]), live: Boolean(c.tokens["tiktok:live"]) } }, feedToken: null } },
    async loadTrackingToken(c, platform, e) { return c.tokens[`${platform}:${e}`] ?? null },
  }
  const load = makeLoader({ "./db": dbStub, "./settings": settingsStub }, {
    Date: time.Date, process: proc, fetch,
    setTimeout: timers.setTimeout.bind(timers), clearTimeout: timers.clearTimeout.bind(timers),
  })
  const outbox = load("lib/tracking/outbox.ts")
  return { time, timers, db, proc, calls, container, outbox, load, dbStub, settingsStub, fetch, respond(fn) { fetchImpl = fn } }
}

const ok = (json = { events_received: 1 }) => ({ status: 200, async text() { return JSON.stringify(json) } })
const reply = (status, json) => ({ status, async text() { return JSON.stringify(json) } })
const metaError = (code, message, extra = {}) => reply(400, { error: { code, message, type: "OAuthException", fbtrace_id: "Atrace123", ...extra } })

test("the claim is one UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) of due rows inside 6.5 days", async () => {
  const { outbox, db, container, respond, fetch, calls } = setup()
  const sql = squash(outbox.CLAIM_SQL)
  assert.match(sql, /^update tracking_event set status = 'sending', locked_until = now\(\) \+ interval '2 min', attempts = attempts \+ 1 where id in \(/)
  assert.match(sql, /select id from tracking_event where status in \('pending', 'retry'\) and next_attempt_at <= now\(\) and event_time >= now\(\) - interval '6\.5 days' order by id limit 500 for update skip locked\)/)
  assert.match(sql, /returning id, platform, env, destination, event_name, event_id, event_time, payload, attempts$/)
  assert.equal(outbox.CLAIM_LIMIT, 500)

  db.add({})
  db.add({ next_attempt_at: new Date(START + 60_000) }) // not due yet
  respond(async () => ok())
  const stats = await outbox.flush(container, { fetch })
  assert.equal(db.statements[0].sql, squash(outbox.CLAIM_SQL), "flush starts with the claim")
  assert.equal(stats.claimed, 1)
  assert.equal(calls.length, 1)
})

test("sent rows become sent with payload NULL; nothing is sent twice", async () => {
  const s = setup()
  const a = s.db.add({})
  const b = s.db.add({})
  s.respond(async () => ok({ events_received: 2 }))
  const stats = await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(stats.sent, 2)
  assert.equal(s.calls.length, 1)
  assert.equal(s.calls[0].url, `https://graph.facebook.com/v26.0/${DATASET}/events`)
  assert.equal(s.calls[0].body.test_event_code, "TEST12345", "Meta TEST gets the test event code from settings")
  for (const row of [a, b]) {
    assert.equal(row.status, "sent")
    assert.equal(row.payload, null)
    assert.equal(row.sent_at.getTime(), START)
    assert.equal(row.last_error, null)
  }
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(s.calls.length, 1)
  assert.equal(s.db.counters["outbox.sent.meta.test"], 2)
})

test("rows are grouped by (platform, env, destination), one request per group", async () => {
  const s = setup({ cfg: config({ live_armed: true }) })
  s.db.add({})
  s.db.add({ destination: OTHER_DATASET })
  s.db.add({ env: "live", destination: "650439547920083" })
  s.db.add({ platform: "tiktok", destination: PIXEL })
  s.db.add({ platform: "tiktok", destination: PIXEL })
  s.db.add({})
  s.respond(async () => ok({ code: 0, message: "OK", events_received: 1 }))
  await s.outbox.flush(s.container, { fetch: s.fetch })
  const byUrl = s.calls.map((call) => `${call.url} ${call.body.data.length}`).sort()
  assert.deepEqual(byUrl, [
    `https://business-api.tiktok.com/open_api/v1.3/event/track/ 2`,
    `https://graph.facebook.com/v26.0/${OTHER_DATASET}/events 1`,
    `https://graph.facebook.com/v26.0/${DATASET}/events 2`,
    "https://graph.facebook.com/v26.0/650439547920083/events 1",
  ])
  const live = s.calls.find((call) => call.url.includes("650439547920083"))
  assert.equal(live.body.test_event_code, undefined, "no test code for live")
  assert.ok(s.db.events.every((e) => e.status === "sent"))
})

test("transient failures back off 1 m, 2 m, 5 m, 15 m, 1 h, 3 h, 6 h, 12 h, then the row fails", async () => {
  const s = setup()
  assert.deepEqual([...s.outbox.BACKOFF_MS], [60e3, 120e3, 300e3, 900e3, 3600e3, 10800e3, 21600e3, 43200e3])
  const row = s.db.add({})
  s.respond(async () => reply(503, { error: { message: "Service unavailable", code: 2 } }))
  for (let attempt = 1; attempt <= 8; attempt++) {
    await s.outbox.flush(s.container, { fetch: s.fetch })
    assert.equal(row.status, "retry", `attempt ${attempt}`)
    assert.equal(row.attempts, attempt)
    assert.equal(row.next_attempt_at.getTime() - s.time.now(), s.outbox.BACKOFF_MS[attempt - 1])
    assert.ok(row.payload, "a retried row keeps its payload")
    // Not due before its time.
    await s.outbox.flush(s.container, { fetch: s.fetch })
    assert.equal(s.calls.length, attempt)
    s.time.advance(s.outbox.BACKOFF_MS[attempt - 1])
  }
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(row.status, "failed")
  assert.match(row.last_error, /^failed after 9 attempts: transient: /)
  assert.equal(s.calls.length, 9)
})

test("a payload error splits the batch in halves until only the bad row fails", async () => {
  const s = setup()
  const rows = Array.from({ length: 8 }, () => s.db.add({}))
  const bad = rows[5].event_id
  s.respond(async (url, init, body) => body.data.some((e) => e.event_id === bad)
    ? metaError(100, "Invalid parameter", { type: "OAuthException" })
    : ok({ events_received: body.data.length }))
  const stats = await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(rows[5].status, "failed")
  assert.match(rows[5].last_error, /^payload: HTTP 400 code 100 OAuthException: Invalid parameter \(trace Atrace123\)$/)
  assert.ok(rows[5].payload, "a failed row keeps its payload so Retry can send it")
  for (const row of rows.filter((r) => r !== rows[5])) {
    assert.equal(row.status, "sent")
    assert.equal(row.payload, null)
    assert.equal(row.attempts, 1, "one attempt for the whole split")
  }
  assert.deepEqual({ sent: stats.sent, failed: stats.failed }, { sent: 7, failed: 1 })
  // 8 -> 4+4 -> 2+2 -> 1+1: the bad row is found in 7 requests.
  assert.equal(s.calls.length, 7)
  const state = s.db.state.get("outbox:last_error:meta:test")
  assert.equal(state.status, "failed")
  assert.equal(state.cls, "payload")
  assert.equal(state.code, "HTTP 400 code 100 OAuthException")
  assert.equal(state.trace_id, "Atrace123")
})

test("TikTok 40002 fails only the named row and resends the innocent rows at once", async () => {
  const s = setup()
  const rows = Array.from({ length: 4 }, () => s.db.add({ platform: "tiktok", destination: PIXEL }))
  const bad = rows[2].event_id
  s.respond(async (url, init, body) => {
    const index = body.data.findIndex((e) => e.event_id === bad)
    return index >= 0 ? reply(200, { code: 40002, message: `data[${index}].properties invalid`, request_id: "req-1" }) : ok({ code: 0, message: "OK" })
  })
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(rows[2].status, "failed")
  assert.match(rows[2].last_error, /code 40002/)
  for (const row of [rows[0], rows[1], rows[3]]) {
    assert.equal(row.status, "sent", "innocent rows are sent in the same run")
    assert.equal(row.attempts, 1)
  }
  assert.equal(s.calls.length, 2)
  assert.equal(s.calls[0].init.headers["Access-Token"], TOKEN)
  assert.equal(s.calls[1].body.data.length, 3)
})

test("a Meta 7-day rejection expires the old row and resends the newer rows at once", async () => {
  const s = setup()
  const rows = Array.from({ length: 3 }, () => s.db.add({}))
  // The payload says 8 days ago although the row is recent: the vendor's view decides.
  rows[1].payload.event_time = Math.floor((START - 8 * DAY) / 1000)
  const old = rows[1].event_id
  s.respond(async (url, init, body) => body.data.some((e) => e.event_id === old)
    ? metaError(100, "The event_time is too far in the past")
    : ok({ events_received: body.data.length }))
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(rows[1].status, "expired")
  assert.equal(rows[1].payload, null)
  for (const row of [rows[0], rows[2]]) {
    assert.equal(row.status, "sent")
    assert.equal(row.attempts, 1)
  }
  assert.equal(s.calls.length, 2)
  assert.ok(!s.calls[1].body.data.some((e) => e.event_id === old))
})

test("the sweep reclaims stale sending rows, expires rows past 6.5 days and never sends them", async () => {
  const s = setup()
  const stale = s.db.add({ status: "sending", attempts: 1, locked_until: new Date(START - 1000) })
  const locked = s.db.add({ status: "sending", attempts: 1, locked_until: new Date(START + 60_000) })
  const old = s.db.add({ event_time: new Date(START - 6.6 * DAY) })
  const oldRetry = s.db.add({ status: "retry", event_time: new Date(START - 7 * DAY) })
  const fresh = s.db.add({})
  s.respond(async (url, init, body) => ok({ events_received: body.data.length }))
  const stats = await s.outbox.runOutboxSweep(s.container, { fetch: s.fetch })
  assert.equal(s.db.statements[0].sql, squash(s.outbox.RECLAIM_SQL))
  assert.equal(squash(s.outbox.RECLAIM_SQL), "update tracking_event set status = 'retry', next_attempt_at = now() where status = 'sending' and locked_until < now()")
  assert.match(squash(s.outbox.EXPIRE_SQL), /set status = 'expired', payload = null.*where status in \('pending', 'retry'\) and event_time < now\(\) - interval '6\.5 days' limit 10000\)$/)
  assert.equal(stats.reclaimed, 1)
  assert.equal(stats.expired_old, 2)
  assert.equal(stale.status, "sent")
  assert.equal(stale.attempts, 2)
  assert.equal(locked.status, "sending", "a live lock is left alone")
  for (const row of [old, oldRetry]) {
    assert.equal(row.status, "expired")
    assert.equal(row.payload, null)
  }
  assert.equal(fresh.status, "sent")
  const sentIds = s.calls.flatMap((call) => call.body.data.map((e) => e.event_id))
  assert.ok(!sentIds.includes(old.event_id) && !sentIds.includes(oldRetry.event_id), "expired rows never enter a request")
})

test("TRACKING_DRY_RUN=1 marks rows dry_run with zero fetch calls", async () => {
  const s = setup({ env: { TRACKING_DRY_RUN: "1" } })
  const rows = [s.db.add({}), s.db.add({ platform: "tiktok", destination: PIXEL })]
  const stats = await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(s.calls.length, 0)
  assert.equal(stats.dry_run, 2)
  for (const row of rows) {
    assert.equal(row.status, "dry_run")
    assert.equal(row.sent_at.getTime(), START)
  }
})

test("a missing token blocks the rows as 'no token' without a request", async () => {
  const s = setup({ tokens: { "meta:test": null, "tiktok:test": TOKEN } })
  const row = s.db.add({})
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(s.calls.length, 0)
  assert.equal(row.status, "blocked")
  assert.equal(row.last_error, "no token")
  assert.ok(row.payload, "blocked rows keep the payload for the requeue")
  assert.equal(s.db.counters["outbox.blocked.meta.test"], 1)
  assert.equal(s.db.state.get("outbox:last_error:meta:test").code, "no token")
})

test("a platform switched off (or live disarmed) after enqueue keeps its rows as skipped", async () => {
  const s = setup({ cfg: config({ tiktok: { enabled: false }, live_armed: false }) })
  const tiktok = s.db.add({ platform: "tiktok", destination: PIXEL })
  const live = s.db.add({ env: "live", destination: "650439547920083" })
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(s.calls.length, 0)
  assert.equal(tiktok.status, "skipped")
  assert.equal(live.status, "skipped")
  assert.ok(tiktok.payload && live.payload, "skipped rows keep the payload for Send skipped")
})

test("a token change requeues blocked rows from the last 6 days, once", async () => {
  const s = setup()
  s.db.state.set("token_fp:meta:test", "deadbeef")
  for (const platform of ["meta", "tiktok"]) {
    for (const env of ["test", "live"]) {
      if (platform !== "meta" || env !== "test") s.db.state.set(`token_fp:${platform}:${env}`, realSettings.tokenFingerprint(TOKEN))
    }
  }
  const recent = s.db.add({ status: "blocked", attempts: 3, last_error: "no token", event_time: new Date(START - 5 * DAY) })
  const tooOld = s.db.add({ status: "blocked", attempts: 3, last_error: "no token", event_time: new Date(START - 6.2 * DAY) })
  const tiktok = s.db.add({ platform: "tiktok", destination: PIXEL, status: "blocked", attempts: 2, event_time: new Date(START - DAY) })
  s.respond(async (url, init, body) => ok({ events_received: body.data.length }))
  const stats = await s.outbox.runOutboxSweep(s.container, { fetch: s.fetch })
  assert.equal(stats.requeued, 1)
  assert.equal(recent.status, "sent")
  assert.equal(recent.attempts, 1, "a fresh set of attempts")
  assert.equal(tooOld.status, "blocked")
  assert.equal(tiktok.status, "blocked", "TikTok's token did not change")
  assert.equal(s.db.state.get("token_fp:meta:test"), realSettings.tokenFingerprint(TOKEN))
  assert.ok(!JSON.stringify([...s.db.state.values()]).includes(TOKEN), "only the fingerprint is stored")
  const requeues = () => s.db.statements.filter((st) => st.sql.startsWith("update tracking_event set status = 'retry', attempts = 0")).length
  assert.equal(requeues(), 1)
  await s.outbox.runOutboxSweep(s.container, { fetch: s.fetch })
  assert.equal(requeues(), 1, "an unchanged fingerprint requeues nothing")
  // A removed token stores an empty fingerprint and requeues nothing.
  s.container.tokens["tiktok:live"] = null
  await s.outbox.runOutboxSweep(s.container, { fetch: s.fetch })
  assert.equal(requeues(), 1)
  assert.equal(s.db.state.get("token_fp:tiktok:live"), "")
})

test("last_error never contains the token, even when the vendor or the network echoes it", async () => {
  const s = setup()
  const a = s.db.add({})
  s.respond(async () => metaError(190, `Invalid OAuth access token ${TOKEN}`))
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(a.status, "blocked")
  assert.ok(!a.last_error.includes(TOKEN))
  assert.match(a.last_error, /\[token\]/)
  const b = s.db.add({ platform: "tiktok", destination: PIXEL })
  s.respond(async () => { throw new Error(`connect failed for ${TOKEN}`) })
  await s.outbox.flush(s.container, { fetch: s.fetch })
  assert.equal(b.status, "retry")
  assert.ok(!b.last_error.includes(TOKEN))
  assert.ok(!JSON.stringify([...s.db.state.entries()]).includes(TOKEN))
  assert.equal(s.calls[0].body.access_token, TOKEN, "the token goes in the Meta body only")
  assert.ok(!s.calls[0].url.includes(TOKEN))
})

test("100 scheduleFlush calls cause at most 2 flushes; the flush waits 2 s and at most 5 s", async () => {
  const s = setup()
  const claims = () => s.db.statements.filter((st) => st.sql.startsWith("update tracking_event set status = 'sending'")).length
  for (let i = 0; i < 100; i++) {
    s.outbox.scheduleFlush(s.container)
    await s.timers.advance(40)
  }
  assert.equal(s.timers.delays[0], 2000, "debounced by 2 s")
  assert.equal(claims(), 0, "calls every 40 ms keep postponing the flush")
  await s.timers.advance(10_000)
  assert.ok(claims() >= 1 && claims() <= 2, `flushes: ${claims()}`)
  const first = s.db.statements.find((st) => st.sql.startsWith("update tracking_event set status = 'sending'"))
  assert.equal(first.at, START + 5000, "but never more than 5 s after the first call")
  // A steady stream still flushes within 5 s of its first call.
  const before = claims()
  for (let i = 0; i < 6; i++) {
    s.outbox.scheduleFlush(s.container)
    await s.timers.advance(1000)
  }
  assert.equal(claims(), before + 1)
  assert.doesNotThrow(() => s.outbox.scheduleFlush(null))
})

test("pruneRetention deletes in 10k batches and covers every table of 6.3", async () => {
  const s = setup()
  let hitBatches = 0
  s.db.deleteAnswer = (table) => table === "tracking_hit" && hitBatches++ < 2 ? 10_000 : 3
  const deleted = await s.outbox.pruneRetention(s.container)
  const expected = [
    ["tracking_event", "status in ('sent', 'dry_run') and created_at < now() - interval '8 days'"],
    ["tracking_event", "status in ('failed', 'expired', 'blocked', 'skipped') and created_at < now() - interval '14 days'"],
    ["tracking_hit", "received_at < now() - interval '7 days'"],
    ["tracking_cart_context", "updated_at < now() - interval '14 days'"],
    ["tracking_order_context", "created_at < now() - interval '90 days'"],
    ["tracking_minute", "bucket < now() - interval '35 days'"],
    ["tracking_session", "day < (now() - interval '90 days')::date"],
    ["tracking_counter", "hour < now() - interval '35 days'"],
    ["catalog_feed_fetch", "fetched_at < now() - interval '30 days'"],
  ]
  for (const [table, where] of expected) {
    const statement = `delete from ${table} where ctid = any(array(select ctid from ${table} where ${where} limit 10000))`
    assert.ok(s.db.deletes.some((d) => d.sql === statement), `missing: ${statement}`)
  }
  assert.ok(s.db.deletes.every((d) => /limit 10000\)\)$/.test(d.sql)), "never one unbounded delete")
  assert.equal(s.db.deletes.filter((d) => d.table === "tracking_hit").length, 3, "a full batch is followed by another")
  assert.equal(deleted.tracking_hit, 20_003)
  assert.deepEqual(s.db.state.get("prune:last"), { at: new Date(START).toISOString(), done: true, deleted: plain(deleted) })
})

test("enqueue inserts through the caller's transaction or the container's connection", async () => {
  const s = setup()
  const trx = { raw() {}, inserted: [] }
  const row = { platform: "meta", env: "test", destination: DATASET, event_name: "Purchase", event_id: "fl-1", event_time: new Date(), source: "checkout", payload: {} }
  assert.equal(await s.outbox.enqueue(trx, [row]), 1)
  assert.deepEqual(trx.inserted, [row])
  assert.equal(await s.outbox.enqueue(s.container, [row]), 1)
  assert.deepEqual(s.db.inserted, [row])
})

test("admin retry: validation and rows from the last 6 days with a payload", async () => {
  const s = setup()
  assert.deepEqual(plain(s.outbox.parseRetryBody({ statuses: ["blocked", "failed", "blocked"] })),
    { ok: true, request: { platform: null, env: null, statuses: ["blocked", "failed"] } })
  for (const bad of [{}, { statuses: [] }, { statuses: ["sent"] }, { statuses: ["failed"], platform: "google" }, { statuses: ["failed"], env: "prod" }, null]) {
    assert.equal(s.outbox.parseRetryBody(bad).ok, false)
  }
  const failed = s.db.add({ status: "failed", attempts: 9 })
  const skipped = s.db.add({ status: "skipped" })
  const noPayload = s.db.add({ status: "skipped", payload: null, destination: "" })
  const old = s.db.add({ status: "failed", event_time: new Date(START - 6.5 * DAY) })
  const tiktok = s.db.add({ status: "failed", platform: "tiktok", destination: PIXEL })
  const queued = await s.outbox.retryRows(s.container, { platform: "meta", env: "test", statuses: ["failed", "skipped"] })
  assert.equal(queued, 2)
  assert.equal(failed.status, "retry")
  assert.equal(failed.attempts, 0)
  assert.equal(skipped.status, "retry")
  assert.equal(noPayload.status, "skipped")
  assert.equal(old.status, "failed")
  assert.equal(tiktok.status, "failed")
  const sql = s.db.statements.at(-1).sql
  assert.match(sql, /where status in \(\?, \?\) and payload is not null and event_time >= now\(\) - interval '6 days' and platform = \? and env = \?$/)
})

test("sendTestEvent: TEST destination only, Meta PageView with the test code, TikTok ViewContent; not ok without a destination or token", async () => {
  const s = setup({ cfg: config({ live_armed: true }) })
  s.respond(async () => ok({ events_received: 1, fbtrace_id: "Atrace9" }))
  const meta = await s.outbox.sendTestEvent(s.container, "meta", { fetch: s.fetch, userAgent: "Mozilla/5.0 Test" })
  assert.equal(meta.ok, true)
  assert.equal(meta.cls, "ok")
  assert.equal(meta.traceId, "Atrace9")
  assert.equal(s.calls[0].url, `https://graph.facebook.com/v26.0/${DATASET}/events`)
  assert.equal(s.calls[0].body.test_event_code, "TEST12345")
  assert.equal(s.calls[0].body.data.length, 1)
  assert.equal(s.calls[0].body.data[0].event_name, "PageView")
  assert.equal(s.calls[0].body.data[0].event_source_url, "https://new.florayn.com/")
  assert.equal(s.calls[0].body.data[0].user_data.client_user_agent, "Mozilla/5.0 Test")

  s.db.variant = { variant_id: "variant_01ABCDEFGHIJ", price: "1400" }
  s.respond(async () => ok({ code: 0, message: "OK", request_id: "r1" }))
  const tiktok = await s.outbox.sendTestEvent(s.container, "tiktok", { fetch: s.fetch })
  assert.equal(tiktok.cls, "ok")
  assert.equal(s.calls[1].body.event_source_id, PIXEL)
  assert.equal(s.calls[1].body.data[0].event, "ViewContent")
  assert.deepEqual(s.calls[1].body.data[0].properties.contents, [{ content_id: "variant_01ABCDEFGHIJ", quantity: 1, price: 1400 }])
  assert.equal(s.db.events.length, 0, "nothing goes through the outbox")

  s.container.cfg = config({ meta: { enabled: false } })
  assert.equal((await s.outbox.sendTestEvent(s.container, "meta", { fetch: s.fetch })).ok, false)
  s.container.cfg = config({ tiktok: { test_id: "" } })
  assert.equal((await s.outbox.sendTestEvent(s.container, "tiktok", { fetch: s.fetch })).ok, false)
  s.container.cfg = config()
  s.container.tokens["meta:test"] = null
  assert.equal((await s.outbox.sendTestEvent(s.container, "meta", { fetch: s.fetch })).ok, false)
  assert.equal(s.calls.length, 2)
})

test("outboxHealth counts per platform/env/destination with the last error; counters24h sums by key", async () => {
  const s = setup()
  const health = s.load("lib/tracking/health.ts")
  const sql = squash(health.OUTBOX_HEALTH_SQL)
  for (const status of ["pending", "sending", "retry", "blocked", "failed", "expired", "skipped", "dry_run"]) {
    assert.ok(sql.includes(`count(*) filter (where status = '${status}')::int as ${status}`), status)
  }
  assert.ok(sql.includes("count(*) filter (where status = 'sent' and sent_at >= now() - interval '24 hours')::int as sent_24h"))
  assert.match(sql, /group by platform, env, destination/)
  s.db.state.set("outbox:last_error:meta:test", { at: "2026-09-27T05:00:00.000Z", status: "blocked", cls: "blocked", code: "HTTP 400 code 190", trace_id: "A1", message: "blocked: HTTP 400 code 190: bad", destination: DATASET })
  let reads = 0
  const db = {
    state: s.db.state,
    async raw(query) {
      reads += 1
      if (/from tracking_counter/.test(query)) {
        assert.match(squash(query), /hour >= date_trunc\('hour', now\(\)\) - interval '23 hours'/)
        return { rows: [{ key: "sf.untrusted", n: "12" }, { key: "outbox.sent.meta.test", n: "40" }] }
      }
      return { rows: [
        { platform: "meta", env: "test", destination: DATASET, pending: 2, sending: 0, retry: 1, blocked: 3, failed: 0, expired: 0, skipped: 0, dry_run: 0, sent_24h: 40, last_sent_at: new Date(START) },
        { platform: "tiktok", env: "test", destination: PIXEL, pending: 0, sending: 0, retry: 0, blocked: 0, failed: 1, expired: 0, skipped: 0, dry_run: 0, sent_24h: 0, last_sent_at: null },
      ] }
    },
  }
  const rows = await health.outboxHealth({ db })
  assert.deepEqual(plain(rows[0]), {
    platform: "meta", env: "test", destination: DATASET,
    counts: { pending: 2, sending: 0, retry: 1, blocked: 3, failed: 0, expired: 0, skipped: 0, dry_run: 0, sent_24h: 40 },
    last_sent_at: new Date(START).toISOString(), last_error: "blocked: HTTP 400 code 190: bad", last_error_at: "2026-09-27T05:00:00.000Z",
  })
  assert.equal(rows[1].last_error, null)
  await health.outboxHealth({ db })
  assert.equal(reads, 1, "shared for 10 s")
  await health.outboxHealth({ db }, { maxAgeMs: 0 })
  assert.equal(reads, 2)
  assert.deepEqual(plain(await health.counters24h({ db })), { "sf.untrusted": 12, "outbox.sent.meta.test": 40 })
})

// ---------------------------------------------------------------- job, routes, page

function loadJob(overrides = {}) {
  const calls = []
  const registered = []
  const state = new Map()
  const time = clock()
  const job = makeLoader({
    "../lib/tracking/alerts": { async checkAlerts() { calls.push("alerts") } },
    "../lib/tracking/db": { trackingDb: () => ({}), async getState(db, key) { return state.get(key) ?? null } },
    "../lib/tracking/jobs": {
      registerTrackingJob(name, spec) { registered.push([name, spec]) },
      async runTrackingJob(container, name, run) { calls.push(`job:${name}`); await run(container) },
    },
    "../lib/tracking/outbox": {
      async runOutboxSweep() { calls.push("sweep"); if (overrides.sweepFails) throw new Error("sweep failed") },
      async pruneRetention() { calls.push("prune") },
    },
  }, { Date: time.Date })("jobs/tracking-outbox.ts")
  return { job, calls, registered, state, time }
}

test("the outbox job registers itself, runs sweep, alerts and an hourly prune", async () => {
  const { job, calls, registered, state } = loadJob()
  assert.deepEqual(plain(job.config), { name: "tracking-outbox", schedule: "* * * * *" })
  assert.equal(typeof job.default, "function")
  assert.equal(registered.length, 1)
  assert.equal(registered[0][0], "outbox")
  assert.equal(registered[0][1].staleAfterMs, 180000)
  await job.default({})
  assert.deepEqual(calls, ["job:outbox", "sweep", "alerts", "prune"])
  calls.length = 0
  state.set("prune:last", { at: new Date(START - 30 * 60_000).toISOString() })
  await job.default({})
  assert.deepEqual(calls, ["job:outbox", "sweep", "alerts"], "pruned within the hour: no prune")
  state.set("prune:last", { at: new Date(START - 61 * 60_000).toISOString() })
  calls.length = 0
  await registered[0][1].run({})
  assert.deepEqual(calls, ["sweep", "alerts", "prune"])

  const failing = loadJob({ sweepFails: true })
  await assert.rejects(failing.registered[0][1].run({}), /sweep failed/)
  assert.deepEqual(failing.calls, ["sweep", "alerts", "prune"], "later steps still run; the job records the error")
})

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test("admin routes answer private, no-store; test-event is 409 without a TEST destination or token", async () => {
  const outboxStub = {
    parseRetryBody: setup().outbox.parseRetryBody,
    async retryRows(scope, request) { scope.retried = request; return 3 },
    scheduleFlush(scope) { scope.flushed = true },
    async sendTestEvent(scope, platform) {
      return scope.ready ? { ok: true, cls: "ok", message: "ok, 1 received", traceId: "t", test_event_code: true } : { ok: false, message: "Meta has no TEST destination." }
    },
  }
  const load = makeLoader({
    "../../../../lib/tracking/outbox": outboxStub,
    "../../../../lib/tracking/alerts": { async sendTestAlert() { return { ok: false, error: "Email is not configured." } }, async alertStates() { return [] } },
  }, {})
  const retry = load("api/admin/tracking/retry/route.ts")
  const testEvent = load("api/admin/tracking/test-event/route.ts")
  const testAlert = load("api/admin/tracking/test-alert/route.ts")

  let res = fakeRes()
  await retry.POST({ scope: {}, body: { statuses: ["nope"] } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.headers["cache-control"], "private, no-store")
  const scope = {}
  res = fakeRes()
  await retry.POST({ scope, body: { statuses: ["skipped"], platform: "meta" } }, res)
  assert.deepEqual(plain(res.body), { queued: 3 })
  assert.deepEqual(plain(scope.retried), { platform: "meta", env: null, statuses: ["skipped"] })
  assert.equal(scope.flushed, true)

  res = fakeRes()
  await testEvent.POST({ scope: {}, body: { platform: "google" }, headers: {} }, res)
  assert.equal(res.statusCode, 400)
  res = fakeRes()
  await testEvent.POST({ scope: { ready: false }, body: { platform: "meta" }, headers: {} }, res)
  assert.equal(res.statusCode, 409)
  assert.equal(res.headers["cache-control"], "private, no-store")
  res = fakeRes()
  await testEvent.POST({ scope: { ready: true }, body: { platform: "tiktok" }, headers: { "user-agent": "UA" } }, res)
  assert.deepEqual(plain(res.body), { cls: "ok", message: "ok, 1 received", traceId: "t", test_event_code: true })

  res = fakeRes()
  await testAlert.POST({ scope: {} }, res)
  assert.deepEqual(plain(res.body), { ok: false, error: "Email is not configured." })
  assert.equal(res.headers["cache-control"], "private, no-store")
})

test("the health route returns outbox, jobs, counters, variant index and email state, and kicks stale jobs", async () => {
  const kicked = []
  const state = new Map([["variant_index", { built_at: "2026-09-27T05:00:00.000Z", count: 900, sellable: 850 }]])
  const load = makeLoader({
    "../../../../lib/send-email": { emailConfigured: () => false },
    "../../../../lib/tracking/alerts": { async alertStates() { return [{ key: "token:meta:test", open: true, title: "Meta token missing (test)" }] } },
    "../../../../lib/tracking/db": { trackingDb: () => ({}), async getState(db, key) { return state.get(key) ?? null } },
    "../../../../lib/tracking/health": { async outboxHealth(scope, options) { scope.healthOptions = options; return [{ platform: "meta" }] }, async counters24h() { return { "sf.untrusted": 1 } } },
    "../../../../lib/tracking/jobs": { async jobStates() { return { outbox: null } }, kickStaleJobs(scope) { kicked.push(scope) } },
    "../../../../lib/tracking/settings": {
      destinationFor: realSettings.destinationFor,
      async loadTrackingSettings() { return { config: config(), tokenSet: { meta: { test: true, live: false }, tiktok: { test: false, live: false } } } },
    },
  }, { process: { env: {} } })
  const route = load("api/admin/tracking/health/route.ts")
  const scope = {}
  const res = fakeRes()
  await route.GET({ scope, query: { fresh: "1" } }, res)
  assert.equal(res.headers["cache-control"], "private, no-store")
  assert.deepEqual(plain(scope.healthOptions), { maxAgeMs: 0 })
  assert.deepEqual(plain(res.body.platforms), [{ platform: "meta" }])
  assert.deepEqual(plain(res.body.counters), { "sf.untrusted": 1 })
  assert.equal(res.body.variant_index.count, 900)
  assert.equal(res.body.email_configured, false)
  assert.equal(res.body.test.meta, true)
  assert.equal(res.body.test.tiktok, false, "no TikTok TEST token")
  assert.equal(res.body.alerts.states[0].key, "token:meta:test")
  assert.deepEqual(plain(res.body.errors), [])
  assert.deepEqual(kicked, [scope])
  assert.ok(!JSON.stringify(res.body).includes(TOKEN))
})

test("the Health page is a sub-page (no config export) that polls every 30 s only while visible", () => {
  const page = fs.readFileSync(path.join(SRC, "admin/routes/tracking/health/page.tsx"), "utf8")
  assert.ok(!/export const config/.test(page) && !/defineRouteConfig/.test(page), "no sidebar config")
  assert.match(page, /export default TrackingHealthPage/)
  assert.match(page, /const TrackingHealthPage = \(\) =>/)
  assert.match(page, /POLL_MS = 30_000/)
  assert.match(page, /visibilitychange/)
  assert.match(page, /document\.visibilityState === "visible"/)
  for (const pathName of ["/admin/tracking/health", "/admin/tracking/retry", "/admin/tracking/test-event", "/admin/tracking/test-alert"]) {
    assert.ok(page.includes(pathName), pathName)
  }
  assert.match(page, /statuses: string\[\]/)
  assert.match(page, /retry\(\["blocked", "failed"\]/)
  assert.match(page, /retry\(\["skipped"\]/)
  assert.match(page, /usePrompt/)
})
