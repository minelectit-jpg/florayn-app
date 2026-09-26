// Tracking alerts (lib/tracking/alerts.ts, TRACKING.md section 10): every
// kind triggers, repeats only after repeat_hours, sends one recovery email,
// stays silent while alerts are off, and a missing email setup is recorded,
// never thrown. The database is a fake that answers each check's query from
// a mutable "world".
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
// 12:00 in Dhaka (UTC+6).
const START = Date.UTC(2026, 8, 27, 6, 0, 0)
const MINUTE = 60_000
const HOUR = 3_600_000
const TOKEN = "EAAsecrettoken0123456789abcdefghij"

const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const plain = (value) => JSON.parse(JSON.stringify(value))

function clock(start = START) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, now: () => now, advance(ms) { now += ms }, set(ms) { now = ms } }
}

function makeLoader(stubs, globals) {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, {
      exports, console, URL, JSON, ...globals,
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

const realSettings = makeLoader({
  "@medusajs/framework/utils": { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query" } },
  "../../modules/tracking": { TRACKING_MODULE: "tracking" },
}, { Date })("lib/tracking/settings.ts")

function config(patch = {}) {
  const base = plain(realSettings.DEFAULT_CONFIG)
  base.meta.enabled = true
  for (const [key, value] of Object.entries(patch)) {
    base[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...base[key], ...value } : value
  }
  return base
}

/** Everything the checks read; healthy by default. */
function world() {
  return {
    config: config(),
    state: new Map(),
    counters: {},
    blocked: [],
    backlog: [],
    orders: [],
    imported: [],
    contexts: [],
    trusted: [],
    purchaseRows: [],
    livePurchases: 0,
    history: 0,
    liveHits: 0,
    productHits: { n: 0, unknown: 0 },
    publishedAt: null,
    metaFeed: null,
    lastFetch: null,
    jobs: { outbox: null, rollup: null, reconcile: null, catalog: null },
    queries: [],
  }
}

function fakeDb(w) {
  return {
    async raw(sql, bindings = []) {
      const s = squash(sql)
      w.queries.push({ sql: s, bindings })
      if (/from tracking_event where status = 'blocked' and created_at >= now\(\) - interval '1 hour'/.test(s)) return { rows: w.blocked }
      if (/from tracking_counter where hour >= date_trunc\('hour', now\(\)\) - interval '1 hour' and key in/.test(s)) {
        return { rows: bindings.filter((key) => key in w.counters).map((key) => ({ key, n: String(w.counters[key]) })) }
      }
      if (/where status = 'retry' and created_at < now\(\) - interval '30 minutes'/.test(s)) return { rows: w.backlog }
      if (/from order_op where order_id in/.test(s)) {
        assert.match(s, /and source is not null and deleted_at is null$/)
        return { rows: bindings.filter((id) => w.imported.includes(id)).map((order_id) => ({ order_id })) }
      }
      if (/from tracking_order_context where order_id in/.test(s)) return { rows: bindings.filter((id) => w.contexts.includes(id)).map((order_id) => ({ order_id })) }
      if (/from tracking_order_context where trusted and not staff and not optout and env is not null/.test(s)) {
        assert.match(s, /created_at >= now\(\) - interval '3 hours' and created_at < now\(\) - interval '10 minutes'/)
        return { rows: w.trusted }
      }
      if (/from tracking_event where event_name = 'Purchase' and event_id in/.test(s)) return { rows: w.purchaseRows.filter((r) => bindings.includes(r.event_id)) }
      if (/from tracking_hit where event_name = 'Purchase'/.test(s)) return { rows: [{ n: w.livePurchases }] }
      if (/generate_series\(1, 14\)/.test(s)) return { rows: [{ total: w.history }] }
      if (/from tracking_hit where received_at >= now\(\) - interval '1 hour' and host in/.test(s)) return { rows: [{ n: w.liveHits }] }
      if (/flags & 64 <> 0/.test(s)) return { rows: [w.productHits] }
      if (/from catalog_feed where kind = 'published'/.test(s)) return { rows: [{ at: w.publishedAt }] }
      if (/from catalog_feed where platform = 'meta' and kind = 'published'/.test(s)) return { rows: w.metaFeed ? [{ published_at: w.metaFeed }] : [] }
      if (/from catalog_feed_fetch where platform = 'meta'/.test(s)) return { rows: [{ at: w.lastFetch }] }
      if (/from tracking_state where key like 'alert:%'/.test(s)) {
        return { rows: [...w.state.entries()].filter(([key]) => key.startsWith("alert:")).map(([key, value]) => ({ key, value })) }
      }
      throw new Error(`Unexpected SQL: ${s}`)
    },
  }
}

function setup(w = world(), { configured = true, sendOk = true, env = {} } = {}) {
  const time = clock()
  const emails = []
  const email = { configured, sendOk }
  const db = fakeDb(w)
  const container = {
    resolve(key) {
      assert.equal(key, "query")
      return { async graph(input) { w.graph = input; return { data: w.orders } } }
    },
  }
  const load = makeLoader({
    "@medusajs/framework/utils": { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query" } },
    "../send-email": {
      emailConfigured: () => email.configured,
      async sendEmail(input) { emails.push(input); return email.sendOk ? { ok: true } : { ok: false, error: "emailit rejected the send (422)" } },
    },
    "./db": {
      trackingDb: () => db,
      async getState(d, key) { return w.state.has(key) ? plain(w.state.get(key)) : null },
      async setState(d, key, value) { w.state.set(key, plain(value)) },
    },
    "./jobs": { async jobStates() { return plain(w.jobs) }, TRACKING_JOB_NAMES: ["outbox", "rollup", "reconcile", "catalog"] },
    "./settings": { async loadTrackingSettings() { return { config: w.config, tokenSet: { meta: { test: true, live: true }, tiktok: { test: false, live: false } }, feedToken: null } } },
  }, { Date: time.Date, process: { env: { MEDUSA_BACKEND_URL: "https://api.new.florayn.com", ...env } } })
  const alerts = load("lib/tracking/alerts.ts")
  return { w, time, emails, email, alerts, container, run: () => alerts.checkAlerts(container) }
}

const iso = (ms) => new Date(ms).toISOString()

/**
 * Every kind: the trigger opens the alert with one email, the next run within
 * repeat_hours sends nothing, after repeat_hours it repeats, and when the
 * trigger clears one recovery email is sent, then nothing.
 */
const KINDS = [
  {
    kind: "token (missing)", key: "token:meta:test", subject: "Florayn tracking: Meta token missing (test)",
    trigger(w) { w.blocked = [{ platform: "meta", env: "test", n: 2, missing: 2 }] },
    clear(w) { w.blocked = [] },
  },
  {
    kind: "token (rejected)", key: "token:meta:live", subject: "Florayn tracking: Meta token rejected (live)",
    trigger(w, now) {
      w.counters["outbox.blocked.meta.live"] = 5
      w.state.set("outbox:last_error:meta:live", { at: iso(now - MINUTE), status: "blocked", cls: "blocked", code: "HTTP 400 code 190 OAuthException", trace_id: "Atr1", message: `blocked: HTTP 400 code 190 OAuthException: Invalid token ${TOKEN}`, destination: "650439547920083" })
    },
    clear(w) { delete w.counters["outbox.blocked.meta.live"] },
    body: /Last answer: blocked, HTTP 400 code 190 OAuthException, trace Atr1/,
  },
  {
    kind: "payload", key: "payload:meta", subject: "Florayn tracking: Meta is rejecting events",
    trigger(w) { w.counters["outbox.failed.meta.test"] = 6; w.counters["outbox.failed.meta.live"] = 4 },
    clear(w) { w.counters = {} },
  },
  {
    kind: "send_failures", key: "send_failures:meta", subject: "Florayn tracking: Meta sends keep failing",
    trigger(w) { w.backlog = [{ platform: "meta", n: 50 }] },
    clear(w) { w.backlog = [{ platform: "meta", n: 49 }] },
  },
  {
    kind: "checkout_without_tracking", key: "checkout_without_tracking", subject: "Florayn tracking: Orders placed without tracking",
    trigger(w) {
      w.orders = [
        { id: "order_A", is_draft_order: false, metadata: { checkout_quote_version: "v1" } }, // no context: counts
        { id: "order_B", is_draft_order: false, metadata: { checkout_quote_version: "v1" } }, // imported
        { id: "order_C", is_draft_order: true, metadata: { checkout_quote_version: "v1" } }, // draft
        { id: "order_D", is_draft_order: false, metadata: {} }, // not a storefront checkout
        { id: "order_E", is_draft_order: false, metadata: { checkout_quote_version: "v1" } }, // tracked
      ]
      w.imported = ["order_B"]
      w.contexts = ["order_E"]
    },
    clear(w) { w.contexts = ["order_A", "order_E"] },
    body: /^1 order from the last hour has no tracking data/m,
  },
  {
    kind: "checkout header rejected", key: "checkout_without_tracking", subject: "Florayn tracking: Orders placed without tracking",
    trigger(w) { w.counters["checkout.header_rejected"] = 2 },
    clear(w) { w.counters = {} },
    body: /TRACKING_INGEST_SECRET probably differs/,
  },
  {
    kind: "purchase_not_enqueued", key: "purchase_not_enqueued", subject: "Florayn tracking: Purchases not queued for the ad platforms",
    trigger(w) {
      w.trusted = [{ order_id: "order_1", display_id: 1001 }, { order_id: "order_2", display_id: 1002 }]
      w.purchaseRows = [{ platform: "meta", event_id: "fl-1001" }, { platform: "tiktok", event_id: "fl-1002" }]
    },
    clear(w) { w.purchaseRows.push({ platform: "meta", event_id: "fl-1002" }) },
    body: /^1 order from the last 3 hours has tracking data but no Purchase queued for Meta/m,
  },
  {
    kind: "edge_missing", key: "edge_missing", subject: "Florayn tracking: Tracking requests are not coming through Cloudflare",
    trigger(w) { w.counters["sf.untrusted"] = 50 },
    clear(w) { w.counters["sf.untrusted"] = 49 },
  },
  {
    kind: "edge_missing (checkout)", key: "edge_missing", subject: "Florayn tracking: Tracking requests are not coming through Cloudflare",
    trigger(w) { w.counters["checkout.untrusted"] = 1 },
    clear(w) { w.counters = {} },
  },
  {
    kind: "no_purchase", key: "no_purchase", subject: "Florayn tracking: No purchases on the live site for 3 hours",
    trigger(w) { w.config.live_armed = true; w.livePurchases = 0; w.history = 14 * 4.6 },
    clear(w) { w.livePurchases = 1 },
    body: /averaged 4\.6 purchases over the last 14 days/,
  },
  {
    kind: "sweep_stale", key: "sweep_stale", subject: "Florayn tracking: Tracking jobs stopped running",
    trigger(w, now) { w.jobs.outbox = { last_run_at: iso(now - 11 * MINUTE) } },
    clear(w, now) { w.jobs.outbox = { last_run_at: iso(now - MINUTE) } },
    body: /Not running: outbox \(last run 11 minutes ago\)/,
  },
  {
    kind: "rollup_lag", key: "rollup_lag", subject: "Florayn tracking: Live dashboard numbers are behind",
    trigger(w, now) { w.state.set("rollup:watermark", { done_through: iso(now - 11 * MINUTE) }) },
    clear(w, now) { w.state.set("rollup:watermark", { done_through: iso(now - MINUTE) }) },
  },
  {
    kind: "live_disarmed", key: "live_disarmed", subject: "Florayn tracking: Live site traffic while live sending is off",
    trigger(w) { w.liveHits = 12 },
    clear(w) { w.liveHits = 0 },
  },
  {
    kind: "unknown_variants", key: "unknown_variants", subject: "Florayn tracking: Many product events have unknown variants",
    trigger(w) { w.productHits = { n: 50, unknown: 11 } },
    clear(w) { w.productHits = { n: 50, unknown: 10 } },
  },
  {
    kind: "feed_guard", key: "feed_guard", subject: "Florayn tracking: Catalog feed update held back",
    trigger(w, now) { w.publishedAt = new Date(now - 2 * HOUR); w.state.set("catalog:alert", { kind: "feed_guard", at: iso(now - HOUR), detail: "items dropped 45%" }) },
    clear(w, now) { w.publishedAt = new Date(now) },
    body: /Detail: items dropped 45%/,
  },
  {
    kind: "feed_error", key: "feed_error", subject: "Florayn tracking: Catalog feed build failed",
    trigger(w, now) { w.state.set("catalog:alert", { kind: "feed_error", at: iso(now - HOUR), detail: "boom" }) },
    // A later build that finished (even with an unchanged feed, so nothing is published) clears it.
    clear(w, now) { w.state.set("catalog:build", { at: iso(now), status: "unchanged" }) },
  },
  {
    kind: "feed_not_fetched", key: "feed_not_fetched", subject: "Florayn tracking: Meta has not fetched the catalog feed",
    trigger(w, now) { w.config.catalog.enabled = true; w.metaFeed = new Date(now - 40 * HOUR); w.lastFetch = new Date(now - 37 * HOUR) },
    clear(w, now) { w.lastFetch = new Date(now) },
  },
]

for (const spec of KINDS) {
  test(`alert ${spec.kind}: triggers, throttles by repeat_hours and recovers once`, async () => {
    const s = setup()
    const first = await s.run()
    assert.equal(s.emails.length, 0, "a healthy shop sends nothing")
    assert.deepEqual(plain(first.errors), [])

    spec.trigger(s.w, s.time.now())
    const opened = await s.run()
    assert.deepEqual(plain(opened.errors), [])
    assert.deepEqual(s.emails.map((e) => e.subject), [spec.subject])
    const [mail] = s.emails
    assert.equal(mail.to, "floraynweb@gmail.com")
    assert.match(mail.text, /Details: https:\/\/api\.new\.florayn\.com\/app\/tracking\/health$/)
    assert.ok(mail.html.includes('href="https://api.new.florayn.com/app/tracking/health"'))
    assert.ok(!mail.text.includes(TOKEN) && !mail.html.includes(TOKEN), "never a token")
    if (spec.body) assert.match(mail.text, spec.body)
    assert.deepEqual(plain(opened.sent), [spec.key])
    const state = s.w.state.get(`alert:${spec.key}`)
    assert.equal(state.open, true)
    assert.equal(state.last_sent_at, iso(START))

    s.time.advance(5 * HOUR)
    await s.run()
    assert.equal(s.emails.length, 1, "throttled inside repeat_hours (6)")
    s.time.advance(HOUR)
    await s.run()
    assert.equal(s.emails.length, 2, "repeats after repeat_hours")
    assert.equal(s.emails[1].subject, spec.subject)
    assert.equal(s.w.state.get(`alert:${spec.key}`).since, iso(START), "the episode start is kept")

    spec.clear(s.w, s.time.now())
    const cleared = await s.run()
    assert.equal(s.emails.length, 3)
    assert.equal(s.emails[2].subject, spec.subject.replace("Florayn tracking: ", "Florayn tracking: resolved - "))
    assert.deepEqual(plain(cleared.recovered), [spec.key])
    assert.equal(s.w.state.get(`alert:${spec.key}`).open, false)
    s.time.advance(MINUTE)
    await s.run()
    assert.equal(s.emails.length, 3, "one recovery email only")
  })
}

test("a held build after the guard keeps feed_guard open; a new guard after a publish opens it again", async () => {
  const s = setup()
  const now = s.time.now()
  s.w.publishedAt = new Date(now - 3 * HOUR)
  s.w.state.set("catalog:alert", { kind: "feed_guard", at: iso(now - HOUR), detail: "dropped" })
  await s.run()
  assert.equal(s.emails.length, 1)
  s.w.state.set("catalog:build", { at: iso(now), status: "held" })
  await s.run()
  assert.equal(s.w.state.get("alert:feed_guard").open, true, "still held")
  s.w.publishedAt = new Date(now) // "Publish anyway"
  await s.run()
  assert.equal(s.emails.length, 2)
  assert.match(s.emails[1].subject, /resolved - Catalog feed update held back/)
  s.time.advance(HOUR)
  s.w.state.set("catalog:alert", { kind: "feed_guard", at: iso(s.time.now()), detail: "dropped again" })
  await s.run()
  assert.equal(s.emails.length, 3)
  assert.equal(s.emails[2].subject, "Florayn tracking: Catalog feed update held back")
})

test("alerts switched off: nothing is checked, sent or written", async () => {
  const s = setup()
  s.w.config.alerts.enabled = false
  for (const spec of KINDS) spec.trigger(s.w, s.time.now())
  const before = JSON.stringify([...s.w.state.entries()])
  const queries = s.w.queries.length
  const run = await s.run()
  assert.equal(run.disabled, true)
  assert.equal(s.emails.length, 0)
  assert.equal(s.w.queries.length, queries)
  assert.equal(JSON.stringify([...s.w.state.entries()]), before)
})

test("email not configured: recorded as a warning, never thrown; sent once it is configured", async () => {
  const s = setup(world(), { configured: false })
  s.w.counters["sf.untrusted"] = 80
  const run = await s.run()
  assert.equal(s.emails.length, 0)
  assert.match(run.warning, /Email is not configured/)
  assert.deepEqual(plain(run.pending), ["edge_missing"])
  assert.equal(s.w.state.get("alerts:last").warning, run.warning)
  assert.equal(s.w.state.get("alert:edge_missing").open, true)
  assert.equal(s.w.state.get("alert:edge_missing").last_sent_at, null)
  s.email.configured = true
  await s.run()
  assert.equal(s.emails.length, 1, "the open alert is emailed as soon as email works")
})

test("an alert that was never emailed closes quietly; a failed send is retried after 15 minutes", async () => {
  const s = setup(world(), { configured: false })
  s.w.liveHits = 3
  await s.run()
  s.w.liveHits = 0
  await s.run()
  assert.equal(s.emails.length, 0)
  assert.equal(s.w.state.get("alert:live_disarmed").open, false)

  s.email.configured = true
  s.email.sendOk = false
  s.w.liveHits = 3
  const failed = await s.run()
  assert.equal(s.emails.length, 1)
  assert.match(failed.errors[0], /live_disarmed: emailit rejected/)
  s.time.advance(10 * MINUTE)
  await s.run()
  assert.equal(s.emails.length, 1, "not retried within 15 minutes")
  s.email.sendOk = true
  s.time.advance(5 * MINUTE)
  await s.run()
  assert.equal(s.emails.length, 2)
  assert.equal(s.w.state.get("alert:live_disarmed").last_sent_at, iso(s.time.now()))
})

test("no_purchase fires only while armed, between 10 and 24 Dhaka time, with a 14-day average of at least 4.6", async () => {
  const s = setup()
  s.w.history = 14 * 4.6
  await s.run()
  assert.equal(s.emails.length, 0, "not armed")
  s.w.config.live_armed = true
  s.w.history = 14 * 4.5
  await s.run()
  assert.equal(s.emails.length, 0, "average 4.5: zero purchases is not unusual enough")
  s.w.history = 14 * 4.6
  s.time.set(Date.UTC(2026, 8, 26, 21, 30)) // 03:30 in Dhaka
  await s.run()
  assert.equal(s.emails.length, 0, "outside the active hours")
  s.time.set(Date.UTC(2026, 8, 27, 3, 59)) // 09:59 in Dhaka
  await s.run()
  assert.equal(s.emails.length, 0)
  s.time.set(Date.UTC(2026, 8, 27, 4, 0)) // 10:00 in Dhaka
  await s.run()
  assert.equal(s.emails.length, 1)
  const [recent, history] = s.w.queries.filter((q) => /tracking_hit where event_name = 'Purchase'|generate_series/.test(q.sql)).slice(-2)
  assert.deepEqual(plain(recent.bindings), [3, "florayn.com", "www.florayn.com"], "live hosts, no_purchase_hours")
  assert.match(recent.sql, /flags & 8 = 0/)
  assert.deepEqual(plain(history.bindings), ["florayn.com", "www.florayn.com", 3])
  // Midnight in Dhaka is outside the window: the alert stays open, no false recovery.
  s.time.set(Date.UTC(2026, 8, 27, 18, 0))
  s.w.livePurchases = 0
  await s.run()
  assert.equal(s.emails.length, 1)
  assert.equal(s.w.state.get("alert:no_purchase").open, true)
  // Disarming closes it without a recovery email.
  s.w.config.live_armed = false
  await s.run()
  assert.equal(s.emails.length, 1)
  assert.equal(s.w.state.get("alert:no_purchase").open, false)
  assert.equal(s.alerts.dhakaHour(Date.UTC(2026, 8, 27, 18, 0)), 0)
  assert.equal(s.alerts.dhakaHour(Date.UTC(2026, 8, 27, 17, 59)), 23)
})

test("per-platform kinds only fire for enabled platforms; platform-wide kinds need a platform on", async () => {
  const s = setup()
  s.w.config.meta.enabled = false
  s.w.blocked = [{ platform: "meta", env: "test", n: 4, missing: 4 }, { platform: "tiktok", env: "test", n: 4, missing: 4 }]
  s.w.counters = { "outbox.failed.tiktok.test": 30, "sf.untrusted": 500, "checkout.header_rejected": 3 }
  s.w.backlog = [{ platform: "tiktok", n: 400 }]
  s.w.trusted = [{ order_id: "order_1", display_id: 7 }]
  s.w.orders = [{ id: "order_A", is_draft_order: false, metadata: { checkout_quote_version: "v1" } }]
  await s.run()
  assert.equal(s.emails.length, 0)
  assert.equal(s.w.graph, undefined, "no order query while every platform is off")
  s.w.config.tiktok.enabled = true
  await s.run()
  assert.deepEqual(s.emails.map((e) => e.subject).sort(), [
    "Florayn tracking: Orders placed without tracking",
    "Florayn tracking: Purchases not queued for the ad platforms",
    "Florayn tracking: TikTok is rejecting events",
    "Florayn tracking: TikTok sends keep failing",
    "Florayn tracking: TikTok token missing (test)",
    "Florayn tracking: Tracking requests are not coming through Cloudflare",
  ])
  // The order query covers the last hour, older than 5 minutes.
  assert.equal(s.w.graph.entity, "order")
  assert.equal(s.w.graph.filters.created_at.$gte.getTime(), s.time.now() - HOUR)
  assert.equal(s.w.graph.filters.created_at.$lte.getTime(), s.time.now() - 5 * MINUTE)
})

test("sweep_stale uses max(10 min, 3 x staleAfterMs) and ignores jobs that never ran", async () => {
  const s = setup()
  assert.deepEqual(plain(s.alerts.JOB_STALE_AFTER_MS), { outbox: 180000, rollup: 180000, reconcile: 900000, catalog: 2700000 })
  const now = s.time.now()
  s.w.jobs = { outbox: { last_run_at: iso(now - 9 * MINUTE) }, rollup: null, reconcile: { last_run_at: iso(now - 44 * MINUTE) }, catalog: { last_run_at: iso(now - 134 * MINUTE) } }
  await s.run()
  assert.equal(s.emails.length, 0)
  s.w.jobs.catalog = { last_run_at: iso(now - 136 * MINUTE) }
  s.w.jobs.reconcile = { last_run_at: iso(now - 46 * MINUTE) }
  await s.run()
  assert.equal(s.emails.length, 1)
  assert.match(s.emails[0].text, /Not running: reconcile \(last run 46 minutes ago\), catalog \(last run 136 minutes ago\)/)
})

test("a failing check is skipped for the run and leaves its alert as it was", async () => {
  const s = setup()
  s.w.liveHits = 5
  await s.run()
  assert.equal(s.w.state.get("alert:live_disarmed").open, true)
  s.w.liveHits = undefined
  const originalRaw = s.w.queries
  s.w.queries = { push(q) { if (/host in/.test(q.sql) && /interval '1 hour' and host in/.test(q.sql)) throw new Error("relation \"tracking_hit\" does not exist"); originalRaw.push(q) } }
  const run = await s.run()
  assert.match(run.errors.join(" "), /live_disarmed: relation "tracking_hit" does not exist/)
  assert.equal(s.w.state.get("alert:live_disarmed").open, true, "no false recovery")
  assert.equal(s.emails.length, 1)
})

test("sendTestAlert emails the alert address even while alerts are off, and reports a missing setup", async () => {
  const s = setup(world(), { configured: false })
  assert.deepEqual(plain(await s.alerts.sendTestAlert(s.container)), { ok: false, error: "Email is not configured on the server (EMAILIT_API_KEY and EMAIL_FROM)." })
  s.email.configured = true
  s.w.config.alerts.enabled = false
  s.w.config.alerts.email = "owner@example.com"
  assert.deepEqual(plain(await s.alerts.sendTestAlert(s.container)), { ok: true })
  assert.equal(s.emails[0].to, "owner@example.com")
  assert.equal(s.emails[0].subject, "Florayn tracking: test alert")
  s.email.sendOk = false
  assert.equal((await s.alerts.sendTestAlert(s.container)).ok, false)
})

test("alertStates lists every alert for the Health page; the admin link falls back without MEDUSA_BACKEND_URL", async () => {
  const s = setup()
  s.w.liveHits = 1
  await s.run()
  const states = plain(await s.alerts.alertStates(s.container))
  assert.deepEqual(states.map((state) => [state.key, state.open]), [["live_disarmed", true]])
  const bare = setup(world(), { env: { MEDUSA_BACKEND_URL: "" } })
  assert.equal(bare.alerts.healthUrl(), "Admin > Tracking > Health")
})
