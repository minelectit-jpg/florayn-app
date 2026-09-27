// Admin > Live (lib/tracking/live.ts, the live/report/staff-link routes and
// admin/routes/live/page.tsx, TRACKING.md 9): Dhaka day boundaries, rollups +
// raw tail without double counting at the watermark, live visitors over
// non-internal browser hits, the pace projection, orders without drafts and
// imported ones (cancelled counted apart), the result shared per poll, staff links
// equal to the Appendix C vector, and a page that polls only while visible,
// renders an empty database and uses no chart library. The database is a
// fake that answers each query from in-memory rows.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const VECTORS = require("./fixtures/tracking-vectors.json")
const HOST = "new.florayn.com"
const LIVE_HOST = "florayn.com"
const MINUTE = 60_000
const DAY = 86_400_000
// 12:00 in Dhaka on 2026-09-27; Dhaka midnight is 2026-09-26T18:00Z.
const NOW = Date.UTC(2026, 8, 27, 6, 0, 0)
const MIDNIGHT = Date.UTC(2026, 8, 26, 18, 0, 0)
const plain = (value) => JSON.parse(JSON.stringify(value))
const squash = (sql) => sql.replace(/\s+/g, " ").trim()

function clock(start = NOW) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, advance(ms) { now += ms }, set(ms) { now = ms } }
}

function makeLoader(stubs, globals = {}) {
  const cache = new Map()
  function resolveFile(base, name) {
    for (const ext of [".ts", ".tsx"]) {
      const file = path.resolve(path.dirname(base), `${name}${ext}`)
      if (fs.existsSync(file)) return file
    }
    throw new Error(`Cannot find ${name} from ${base}`)
  }
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const module = { exports: {} }
    cache.set(filename, module.exports)
    vm.runInNewContext(code, {
      module, exports: module.exports, console, JSON, ...globals,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name]
        if (name === "node:crypto") return crypto
        if (name.startsWith(".")) return loadFile(resolveFile(filename, name))
        throw new Error(`Unexpected import ${name} in ${filename}`)
      },
    }, { filename })
    return module.exports
  }
  return (file) => loadFile(path.join(SRC, file))
}

const UTILS = { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query" } }

function config(patch = {}) {
  return { test_hosts: [HOST], live_hosts: [LIVE_HOST, "www.florayn.com"], live_armed: false, ...patch }
}

/** lib/tracking/live.ts with real settings/db/rollup and stubbed outbox, jobs and feed readers. */
function loadLive(time = clock(), extra = {}) {
  const kicks = []
  const live = makeLoader({
    "@medusajs/framework/utils": UTILS,
    "../../modules/tracking": { TRACKING_MODULE: "tracking" },
    "./catalog-feed": { feedMeta: async () => [], lastFeedFetches: async () => ({}) },
    "./health": { outboxHealth: async () => [] },
    "./jobs": {
      jobStates: async () => ({ outbox: null, rollup: null, reconcile: null, catalog: null }),
      kickStaleJobs: (container) => kicks.push(container),
    },
    ...extra,
  }, { Date: time.Date, process: { env: {} } })("lib/tracking/live.ts")
  return { live, kicks, time }
}

// ---------------------------------------------------------------- the fake database

function hit(overrides) {
  return {
    event_name: "PageView", event_id: `e-${Math.random()}`, origin: "b", visitor_id: "v1", session_id: "s1", source: "direct",
    host: HOST, path: "/", handle: null, device: null, case_type: null, value: null, items: null, flags: 0, ...overrides,
  }
}

const floorMinute = (t) => t - (t % MINUTE)
const dhakaDate = (t) => new Date(t + 6 * 3_600_000).toISOString().slice(0, 10)

/** What the rollup would have written for the hits before the watermark (see tracking-rollup.test.cjs). */
function rolledUp(hits, watermark) {
  const minute = new Map()
  const sessions = new Map()
  for (const h of hits) {
    const t = h.received_at.getTime()
    if (watermark === null || t >= watermark) continue
    if (!(h.flags & 8)) {
      for (const name of h.event_name === "ViewContent" && (h.flags & 1) ? [h.event_name, "ProductView"] : [h.event_name]) {
        const key = `${floorMinute(t)}|${name}|${h.source ?? ""}|${h.host}`
        const row = minute.get(key) ?? { bucket: new Date(floorMinute(t)), event_name: name, source: h.source ?? "", host: h.host, count: 0, value: 0 }
        row.count += 1
        row.value += h.value ?? 0
        minute.set(key, row)
      }
    }
    if (!h.session_id) continue
    const s = sessions.get(h.session_id) ?? { session_id: h.session_id, visitor_id: h.visitor_id ?? "", day: dhakaDate(t), started_at: h.received_at,
      host: h.host, source: h.source, flags: 0 }
    s.flags |= ({ ViewContent: 1, AddToCart: 2, InitiateCheckout: 4, Purchase: 8 }[h.event_name] ?? 0) | (h.flags & 8 ? 16 : 0)
    sessions.set(h.session_id, s)
  }
  return { minute: [...minute.values()], sessions: [...sessions.values()] }
}

function hostCount(sql) {
  const match = /host in \(([?, ]+)\)/.exec(sql)
  return match ? (match[1].match(/\?/g) ?? []).length : 0
}

function inHosts(row, hosts) {
  return !hosts || hosts.includes(row.host)
}

const time = (v) => (v instanceof Date ? v.getTime() : Date.parse(v))
const distinct = (values) => new Set(values.filter((v) => v !== null && v !== undefined && v !== "")).size

function liveDb(w) {
  return {
    async raw(sql, bindings = []) {
      const s = squash(sql)
      w.queries.push({ sql: s, bindings })
      if (w.broken) throw new Error(`relation does not exist`)
      const n = hostCount(s)
      const hostsAtEnd = n ? bindings.slice(bindings.length - n) : null
      const hits = w.hits
      if (s.startsWith("select value from tracking_state where key = ?")) {
        return { rows: w.state.has(bindings[0]) ? [{ value: w.state.get(bindings[0]) }] : [] }
      }
      if (s.includes("as v5")) {
        const [since5, since30] = bindings.map(time)
        const recent = hits.filter((h) => time(h.received_at) >= since30 && h.origin === "b" && !(h.flags & 8) && h.visitor_id && inHosts(h, hostsAtEnd))
        return { rows: [{ v5: distinct(recent.filter((h) => time(h.received_at) >= since5).map((h) => h.visitor_id)), v30: distinct(recent.map((h) => h.visitor_id)) }] }
      }
      if (s.includes("count(distinct visitor_id)::int as visitors from tracking_hit")) {
        const since30 = time(bindings[0])
        const recent = hits.filter((h) => time(h.received_at) >= since30 && h.origin === "b" && !(h.flags & 8) && h.visitor_id && inHosts(h, hostsAtEnd)
          && (!s.includes("event_name = 'PageView'") || h.event_name === "PageView"))
        const byKey = new Map()
        for (const h of recent) {
          const key = s.startsWith("select path") ? h.path : (h.source || "unknown")
          byKey.set(key, (byKey.get(key) ?? new Set()).add(h.visitor_id))
        }
        const col = s.startsWith("select path") ? "path" : "source"
        return { rows: [...byKey].map(([key, set]) => ({ [col]: key, visitors: set.size })).sort((a, b) => b.visitors - a.visitors) }
      }
      if (s.includes("from tracking_minute where bucket >= ? and bucket < ?")) {
        const [from, to] = bindings.slice(0, 2).map(time)
        const events = bindings.slice(2, bindings.length - n)
        const rows = w.minute.filter((m) => time(m.bucket) >= from && time(m.bucket) < to && events.includes(m.event_name) && inHosts(m, hostsAtEnd))
        if (s.includes("as t5")) {
          const groups = new Map()
          for (const m of rows) {
            const key = `${Math.floor(time(m.bucket) / 300_000) * 300}|${m.event_name}`
            groups.set(key, (groups.get(key) ?? 0) + m.count)
          }
          return { rows: [...groups].map(([key, count]) => ({ t5: key.split("|")[0], event_name: key.split("|")[1], n: count })) }
        }
        const groups = new Map()
        for (const m of rows) {
          const g = groups.get(m.event_name) ?? { event_name: m.event_name, n: 0, v: 0 }
          g.n += m.count
          g.v += m.value
          groups.set(m.event_name, g)
        }
        return { rows: [...groups.values()] }
      }
      if (s.includes("from tracking_hit where received_at >= ? and received_at < ? and (flags & 8) = 0")) {
        const [from, to] = bindings.slice(0, 2).map(time)
        const rows = hits.filter((h) => time(h.received_at) >= from && time(h.received_at) < to && !(h.flags & 8) && inHosts(h, hostsAtEnd))
        const name = (h) => (h.event_name === "ViewContent" && (h.flags & 1) ? "ProductView" : h.event_name)
        const groups = new Map()
        for (const h of rows) {
          const key = s.includes("as t5") ? `${Math.floor(time(h.received_at) / 300_000) * 300}|${name(h)}` : name(h)
          const g = groups.get(key) ?? { event_name: name(h), t5: key.split("|")[0], n: 0, v: 0 }
          g.n += 1
          g.v += h.value ?? 0
          groups.set(key, g)
        }
        return { rows: [...groups.values()] }
      }
      if (s.includes("from ( select visitor_id, session_id from tracking_session")) {
        const [day, end] = [bindings[0], time(bindings[1])]
        const hostsFirst = n ? bindings.slice(2, 2 + n) : null
        const [tailFrom, tailTo] = bindings.slice(2 + n, 4 + n).map(time)
        const known = new Set(w.sessions.map((x) => x.session_id))
        const rows = [
          ...w.sessions.filter((x) => x.day === day && time(x.started_at) < end && !(x.flags & 16) && inHosts(x, hostsFirst)),
          ...hits.filter((h) => time(h.received_at) >= tailFrom && time(h.received_at) < tailTo && !(h.flags & 8) && h.session_id
            && inHosts(h, hostsFirst) && !known.has(h.session_id)),
        ]
        return { rows: [{ visitors: distinct(rows.map((r) => r.visitor_id)), sessions: distinct(rows.map((r) => r.session_id)) }] }
      }
      if (s.startsWith("select o.id, o.created_at, o.canceled_at, o.is_draft_order, op.source, op.workflow_status,")) {
        // One read: the order, its order_op row and order_summary's current_order_total for the current version.
        assert.match(s, /from order_summary s where s\.order_id = o\.id and s\.deleted_at is null and s\.version <= o\.version order by s\.version desc limit 1\) as total/)
        assert.match(s, /left join order_op op on op\.order_id = o\.id and op\.deleted_at is null/)
        assert.match(s, /where o\.deleted_at is null and o\.is_draft_order is not true and o\.created_at >= \?/)
        const bounded = s.includes("and o.created_at < ?")
        const from = time(bindings[0])
        const to = bounded ? time(bindings[1]) : Infinity
        assert.equal(bindings.at(-1), 20_000, "at most MAX_ORDERS rows")
        w.orderReads.push({ from, to })
        return { rows: w.orders
          .filter((o) => time(o.created_at) >= from && time(o.created_at) < to && o.is_draft_order !== true)
          .map((o) => ({ ...o, created_at: new Date(o.created_at), source: w.ops.get(o.id)?.source ?? null,
            workflow_status: w.ops.get(o.id)?.workflow_status ?? null })) }
      }
      if (s.startsWith("select o.id from \"order\" o left join order_op op")) {
        const ids = JSON.parse(bindings[0])
        w.cancelReads.push(ids)
        return { rows: w.orders.filter((o) => ids.includes(o.id) && (o.canceled_at || w.ops.get(o.id)?.workflow_status === "cancelled"))
          .map((o) => ({ id: o.id })) }
      }
      if (s.includes("as purchase from tracking_session")) {
        const [from, to] = bindings
        const rows = w.sessions.filter((x) => x.day >= from && x.day <= to && !(x.flags & 16) && inHosts(x, hostsAtEnd))
        const has = (bit) => rows.filter((x) => x.flags & bit).length
        return { rows: [{ sessions: rows.length, vc: has(1), atc: has(2), ic: has(4), purchase: has(8) }] }
      }
      if (s.startsWith("select dim, key, event_name")) {
        const [from, to] = bindings
        const dims = bindings.slice(2, bindings.length - n)
        const groups = new Map()
        for (const r of w.dayDim.filter((d) => d.day >= from && d.day <= to && dims.includes(d.dim) && inHosts(d, hostsAtEnd))) {
          const key = `${r.dim}|${r.key}|${r.event_name}`
          const g = groups.get(key) ?? { dim: r.dim, key: r.key, event_name: r.event_name, n: 0, v: 0 }
          g.n += r.count
          g.v += r.value
          groups.set(key, g)
        }
        return { rows: [...groups.values()] }
      }
      if (s.includes("as key, count(*)::int as n from tracking_session")) {
        const [from, to] = bindings
        const pick = s.includes("nullif(source") ? (x) => x.source || "unknown" : s.includes("landing_path") ? (x) => (x.landing_path ?? "").split("?")[0]
          : s.startsWith("select audience") ? (x) => x.audience : (x) => x.device_class
        const counts = new Map()
        for (const x of w.sessions.filter((r) => r.day >= from && r.day <= to && !(r.flags & 16) && inHosts(r, hostsAtEnd))) {
          counts.set(pick(x), (counts.get(pick(x)) ?? 0) + 1)
        }
        return { rows: [...counts].map(([key, count]) => ({ key, n: count })) }
      }
      if (s.includes("from tracking_hit where received_at >= ? and event_name <> 'PageView'")) {
        const since = time(bindings[0])
        return { rows: hits.filter((h) => time(h.received_at) >= since && h.event_name !== "PageView" && inHosts(h, hostsAtEnd))
          .sort((a, b) => time(b.received_at) - time(a.received_at)).slice(0, 20) }
      }
      if (s.includes("(flags & 64) <> 0")) {
        const since = time(bindings[0])
        return { rows: [{ n: hits.filter((h) => time(h.received_at) >= since && (h.flags & 64) && inHosts(h, hostsAtEnd)).length }] }
      }
      if (s.startsWith("select day::text as day, event_name")) {
        const [from, to] = bindings
        const groups = new Map()
        for (const r of w.dayDim.filter((d) => d.dim === "source" && d.day >= from && d.day <= to && inHosts(d, hostsAtEnd))) {
          const key = `${r.day}|${r.event_name}`
          const g = groups.get(key) ?? { day: r.day, event_name: r.event_name, n: 0, v: 0 }
          g.n += r.count
          g.v += r.value
          groups.set(key, g)
        }
        return { rows: [...groups.values()] }
      }
      if (s.startsWith("select day::text as day, count(*)::int as sessions")) {
        const [from, to] = bindings
        const byDay = new Map()
        for (const x of w.sessions.filter((r) => r.day >= from && r.day <= to && !(r.flags & 16) && inHosts(r, hostsAtEnd))) {
          const g = byDay.get(x.day) ?? { day: x.day, sessions: 0, ids: new Set() }
          g.sessions += 1
          if (x.visitor_id) g.ids.add(x.visitor_id)
          byDay.set(x.day, g)
        }
        return { rows: [...byDay.values()].map((g) => ({ day: g.day, sessions: g.sessions, visitors: g.ids.size })) }
      }
      if (s.startsWith("select count(distinct nullif(visitor_id, ''))::int as visitors from tracking_session")) {
        const [from, to] = bindings
        return { rows: [{ visitors: distinct(w.sessions.filter((r) => r.day >= from && r.day <= to && !(r.flags & 16) && inHosts(r, hostsAtEnd)).map((r) => r.visitor_id)) }] }
      }
      throw new Error(`Unexpected SQL: ${s.slice(0, 140)}`)
    },
  }
}

function liveWorld({ hits = [], watermark = null, orders = [], ops = new Map(), products = new Map(), dayDim = [], cfg = config(), extraSessions = [] } = {}) {
  const w = { hits, orders, ops, products, dayDim, queries: [], graph: [], orderReads: [], cancelReads: [], state: new Map(), broken: false, cfg, settingsFail: false }
  const rolled = rolledUp(hits, watermark)
  w.minute = rolled.minute
  w.sessions = [...rolled.sessions, ...extraSessions]
  if (watermark !== null) w.state.set("rollup:watermark", { done_through: new Date(watermark).toISOString() })
  return w
}

function container(w) {
  const db = liveDb(w)
  return {
    resolve(key) {
      if (key === "pg") return db
      if (key === "tracking") {
        return {
          async listTrackingSettings() {
            if (w.settingsFail) throw new Error("no table")
            return [{ id: "trackset_default", config: w.cfg }]
          },
        }
      }
      if (key === "query") {
        return {
          async graph(input) {
            w.graph.push(input)
            assert.equal(input.entity, "product", "orders are one SQL read, never query.graph with totals")
            return { data: input.filters.handle.filter((h) => w.products.has(h)).map((handle) => ({ handle, title: w.products.get(handle) })) }
          },
        }
      }
      throw new Error(`Unexpected resolve ${key}`)
    },
  }
}

const at = (ms) => new Date(ms)

// ---------------------------------------------------------------- pure helpers

test("Dhaka day boundaries around midnight (UTC+6)", () => {
  const { live } = loadLive()
  const justBefore = Date.parse("2026-09-27T17:59:59.999Z") // 23:59:59.999 in Dhaka on the 27th
  const justAfter = Date.parse("2026-09-27T18:00:00.000Z") // 00:00 in Dhaka on the 28th
  assert.equal(new Date(live.dhakaMidnight(justBefore)).toISOString(), "2026-09-26T18:00:00.000Z")
  assert.equal(new Date(live.dhakaMidnight(justAfter)).toISOString(), "2026-09-27T18:00:00.000Z")
  assert.equal(new Date(live.dhakaMidnight(Date.parse("2026-09-27T00:30:00Z"))).toISOString(), "2026-09-26T18:00:00.000Z",
    "00:30 UTC is 06:30 in Dhaka, the same Dhaka day")
  assert.equal(new Date(live.dhakaMidnight(Date.parse("2026-09-26T17:30:00Z"))).toISOString(), "2026-09-25T18:00:00.000Z")
  assert.equal(live.dhakaIso(Date.parse("2026-09-27T04:05:00Z")), "2026-09-27T10:05:00+06:00")
  assert.equal(live.dhakaIso(justAfter), "2026-09-28T00:00:00+06:00")
})

test("rollupSplit: rollups before the watermark, raw after it, clamped to [from, last whole minute of to]", () => {
  const { live } = loadLive()
  assert.equal(live.rollupSplit(MIDNIGHT, NOW, null), MIDNIGHT, "no watermark: all raw")
  assert.equal(live.rollupSplit(MIDNIGHT, NOW, NOW - 90_000), NOW - 90_000)
  assert.equal(live.rollupSplit(MIDNIGHT, NOW, MIDNIGHT - 3_600_000), MIDNIGHT, "a watermark before midnight: all raw")
  assert.equal(live.rollupSplit(MIDNIGHT - DAY, NOW - DAY + 30_000, NOW - 60_000), NOW - DAY, "yesterday: split at the last whole minute")
})

test("today = rollups + raw tail: the same totals wherever the watermark is, nothing counted twice", async () => {
  const hits = [
    hit({ received_at: at(MIDNIGHT - 60_000), visitor_id: "v0", session_id: "s0" }), // yesterday
    hit({ received_at: at(MIDNIGHT), visitor_id: "v1", session_id: "s1" }),
    hit({ received_at: at(MIDNIGHT + 3_600_000), event_name: "ViewContent", flags: 1, value: 1400, visitor_id: "v1", session_id: "s1" }),
    hit({ received_at: at(MIDNIGHT + 3_600_000 + 10_000), event_name: "ViewContent", flags: 2, value: 1400, visitor_id: "v1", session_id: "s1" }),
    hit({ received_at: at(NOW - 5 * MINUTE), visitor_id: "v2", session_id: "s2" }),
    hit({ received_at: at(NOW - 2 * MINUTE), event_name: "AddToCart", value: 1400, visitor_id: "v2", session_id: "s2" }),
    hit({ received_at: at(NOW - 2 * MINUTE), visitor_id: "v9", session_id: "s9", flags: 8 }), // staff
    hit({ received_at: at(NOW - 90_000), event_name: "Purchase", origin: "s", value: 1520, visitor_id: "v2", session_id: "s2", event_id: "fl-7" }),
    hit({ received_at: at(NOW - 30_000), visitor_id: "v3", session_id: "s3" }),
  ]
  const expected = { visitors: 3, sessions: 3, page_views: 3, product_views: 1, add_to_cart: 1, web_purchases: 1, revenue_web: 1520 }
  for (const watermark of [null, MIDNIGHT - 3_600_000, MIDNIGHT, MIDNIGHT + 3_600_000, NOW - 2 * MINUTE, NOW - MINUTE, floorMinute(NOW)]) {
    const { live } = loadLive()
    const w = liveWorld({ hits, watermark })
    const payload = await live.computeLive(container(w))
    const today = payload.today
    assert.deepEqual({ visitors: today.visitors, sessions: today.sessions, page_views: today.page_views, product_views: today.product_views,
      add_to_cart: today.add_to_cart, web_purchases: today.web_purchases, revenue_web: today.revenue_web }, expected,
    `watermark ${watermark === null ? "none" : new Date(watermark).toISOString()}`)
    assert.deepEqual(plain(payload.errors), [])
  }
})

test("yesterday at the same time uses yesterday midnight to now - 24 h", async () => {
  const hits = [
    hit({ received_at: at(MIDNIGHT - DAY + 60_000), visitor_id: "y1", session_id: "ys1" }),
    hit({ received_at: at(NOW - DAY - 60_000), visitor_id: "y2", session_id: "ys2" }),
    hit({ received_at: at(NOW - DAY + 60_000), visitor_id: "y3", session_id: "ys3" }), // after "now" yesterday
  ]
  const { live } = loadLive()
  const payload = await live.computeLive(container(liveWorld({ hits, watermark: floorMinute(NOW - 30_000) })))
  assert.equal(payload.yesterday_same_time.page_views, 2)
  assert.equal(payload.yesterday_same_time.visitors, 2)
  assert.equal(payload.yesterday_same_time.pace_projection, null)
  assert.equal(payload.today.page_views, 0)
})

test("visitors now: distinct visitor ids over non-internal browser hits in the last 5 and 30 minutes", async () => {
  const hits = [
    hit({ received_at: at(NOW - MINUTE), visitor_id: "v1", source: "meta_paid", path: "/product/x/" }),
    hit({ received_at: at(NOW - 2 * MINUTE), visitor_id: "v1", source: "meta_paid", path: "/product/x/" }),
    hit({ received_at: at(NOW - 3 * MINUTE), visitor_id: "staff", flags: 8, path: "/" }),
    hit({ received_at: at(NOW - 3 * MINUTE), visitor_id: "server", origin: "s", event_name: "Purchase", path: "/checkout/" }),
    hit({ received_at: at(NOW - 20 * MINUTE), visitor_id: "v4", source: "direct", path: "/" }),
    hit({ received_at: at(NOW - 40 * MINUTE), visitor_id: "v5", path: "/" }),
  ]
  const { live } = loadLive()
  const w = liveWorld({ hits, watermark: floorMinute(NOW - 30_000) })
  const payload = await live.computeLive(container(w))
  assert.equal(payload.now.visitors_5m, 1)
  assert.equal(payload.now.visitors_30m, 2)
  assert.deepEqual(plain(payload.now.by_source), [
    { source: "meta_paid", label: "Meta ads", visitors: 1 },
    { source: "direct", label: "Direct", visitors: 1 },
  ])
  assert.deepEqual(plain(payload.now.top_pages).map((p) => p.path).sort(), ["/", "/product/x/"])
  const sql = w.queries.find((q) => q.sql.includes("as v5")).sql
  assert.match(sql, /count\(distinct visitor_id\)/)
  assert.match(sql, /origin = 'b' and \(flags & 8\) = 0 and visitor_id is not null/)
})

test("pace matches a hand-computed fixture", () => {
  const { live } = loadLive()
  const history = []
  for (let d = 1; d <= 7; d++) {
    const dayStart = MIDNIGHT - d * DAY
    history.push({ id: `a${d}`, at: dayStart + 9 * 3_600_000, total: 1, cancelled: false })
    history.push({ id: `b${d}`, at: dayStart + 11 * 3_600_000, total: 1, cancelled: false })
    for (const hour of [15, 18, 21]) history.push({ id: `c${d}${hour}`, at: dayStart + hour * 3_600_000, total: 1, cancelled: false })
  }
  history.push({ id: "cancelled", at: MIDNIGHT - DAY + 8 * 3_600_000, total: 1, cancelled: true })
  history.push({ id: "too-old", at: MIDNIGHT - 8 * DAY + 3_600_000, total: 1, cancelled: false })
  history.push({ id: "at-noon", at: MIDNIGHT - 2 * DAY + 12 * 3_600_000, total: 1, cancelled: false })
  // 36 counted orders; 14 placed before 12:00 (09:00 and 11:00 each day); the 12:00 one is not "by now".
  // share = 14 / 36; 10 orders today -> 10 / (14 / 36) = 25.71 -> 26.
  assert.equal(live.paceProjection(10, history, NOW), 26)
  assert.equal(live.paceProjection(0, history, NOW), 0)
  assert.equal(live.paceProjection(5, [], NOW), null, "no history")
  assert.equal(live.paceProjection(5, history, MIDNIGHT + 60_000), null, "nothing was ever placed this early")
})

test("orders exclude drafts and imported orders, count cancelled apart and leave them out of revenue", async () => {
  const today = (h) => new Date(MIDNIGHT + h * 3_600_000).toISOString()
  const orders = [
    { id: "o_a", total: 1500, created_at: today(9), canceled_at: null, is_draft_order: false },
    { id: "o_draft", total: 9000, created_at: today(9), canceled_at: null, is_draft_order: true },
    { id: "o_import", total: 8000, created_at: today(10), canceled_at: null, is_draft_order: false },
    { id: "o_cancel", total: 900, created_at: today(10), canceled_at: today(11), is_draft_order: false },
    { id: "o_opcancel", total: 700, created_at: today(10), canceled_at: null, is_draft_order: false },
    { id: "o_f", total: "2000", created_at: today(11), canceled_at: null, is_draft_order: false },
    { id: "o_yday", total: 1000, created_at: new Date(MIDNIGHT - DAY + 3_600_000).toISOString(), canceled_at: null, is_draft_order: false },
    { id: "o_yday_late", total: 1000, created_at: new Date(NOW - DAY + 60_000).toISOString(), canceled_at: null, is_draft_order: false },
  ]
  const ops = new Map([
    ["o_import", { source: "florayn.com", workflow_status: "delivered" }],
    ["o_opcancel", { source: null, workflow_status: "cancelled" }],
    ["o_a", { source: null, workflow_status: "confirmed" }],
  ])
  const { live } = loadLive()
  const w = liveWorld({ orders, ops, watermark: floorMinute(NOW - 30_000) })
  const payload = await live.computeLive(container(w))
  assert.equal(payload.today.orders_all, 4)
  assert.equal(payload.today.orders_cancelled, 2)
  assert.equal(payload.today.revenue_all, 3500)
  assert.equal(payload.today.aov, 1750)
  assert.equal(payload.today.target, 300, "the owner's default daily target")
  assert.equal(payload.yesterday_same_time.orders_all, 1, "yesterday counts only up to this time")
  assert.equal(payload.yesterday_same_time.revenue_all, 1000)
  assert.deepEqual(w.orderReads, [{ from: MIDNIGHT, to: Infinity }, { from: MIDNIGHT - 7 * DAY, to: MIDNIGHT }],
    "today is from Dhaka midnight, the history the 7 days before")

  const facts = live.orderFacts(orders, ops)
  assert.deepEqual(plain(facts).map((f) => f.id), ["o_a", "o_cancel", "o_opcancel", "o_f", "o_yday", "o_yday_late"])
})

test("the poll_seconds cache: one shared result per host filter", async () => {
  const time = clock()
  const { live } = loadLive(time)
  const w = liveWorld({ hits: [hit({ received_at: at(NOW - MINUTE) })], watermark: floorMinute(NOW - 30_000) })
  const c = container(w)
  const [a, b] = await Promise.all([live.computeLive(c), live.computeLive(c)])
  assert.equal(a, b, "two calls share one object")
  assert.equal(a.poll_seconds, 15)
  time.advance(14_900)
  assert.equal(await live.computeLive(c), a, "shared for the whole 15 s poll interval")
  const other = await live.computeLive(c, { host: HOST })
  assert.notEqual(other, a, "another host filter has its own result")
  assert.equal(other.filter.key, `host:${HOST}`)
  time.advance(600)
  const fresh = await live.computeLive(c)
  assert.notEqual(fresh, a, "after poll_seconds it is computed again")
  assert.equal(fresh.generated_at, new Date(NOW + 15_500).toISOString())

  const slow = clock()
  const { live: slower } = loadLive(slow)
  const sw = liveWorld({ cfg: config({ dashboard: { daily_order_target: 300, poll_seconds: 45 } }) })
  const first = await slower.computeLive(container(sw))
  slow.advance(44_000)
  assert.equal(await slower.computeLive(container(sw)), first, "a 45 s poll interval shares for 45 s")
  slow.advance(1_000)
  assert.notEqual(await slower.computeLive(container(sw)), first)
})

test("each poll reads today's orders once; the history is read once a Dhaka day and only its cancellations every 5 minutes", async () => {
  const time = clock()
  const { live } = loadLive(time)
  const day = (d, h) => new Date(MIDNIGHT - d * DAY + h * 3_600_000).toISOString()
  const orders = [
    { id: "o_today", total: 1500, created_at: new Date(MIDNIGHT + 3_600_000).toISOString(), canceled_at: null, is_draft_order: false },
    { id: "o_y1", total: 1000, created_at: day(1, 2), canceled_at: null, is_draft_order: false },
    { id: "o_y2", total: 800, created_at: day(1, 3), canceled_at: null, is_draft_order: false },
    { id: "o_d3", total: 900, created_at: day(3, 9), canceled_at: null, is_draft_order: false },
  ]
  const w = liveWorld({ orders, ops: new Map(), watermark: floorMinute(NOW - 30_000) })
  const c = container(w)
  const first = await live.computeLive(c)
  assert.equal(first.yesterday_same_time.orders_all, 2)
  assert.equal(first.yesterday_same_time.revenue_all, 1800)
  assert.equal(w.orderReads.length, 2)

  time.advance(20_000)
  await live.computeLive(c)
  assert.deepEqual(w.orderReads.map((r) => r.from), [MIDNIGHT, MIDNIGHT - 7 * DAY, MIDNIGHT], "only today is read again")
  assert.equal(w.cancelReads.length, 0)

  // Yesterday's order is cancelled in the order manager; the history shows it within 5 minutes.
  w.ops.set("o_y2", { source: null, workflow_status: "cancelled" })
  time.advance(5 * MINUTE)
  const patched = await live.computeLive(c)
  assert.equal(w.orderReads.filter((r) => r.from !== MIDNIGHT).length, 1, "the history is not read again")
  assert.deepEqual([...w.cancelReads.at(-1)].sort(), ["o_d3", "o_y1", "o_y2"], "its cancellations are read by id")
  assert.equal(patched.yesterday_same_time.orders_cancelled, 1)
  assert.equal(patched.yesterday_same_time.revenue_all, 1000)
  w.ops.delete("o_y2")
  time.advance(5 * MINUTE)
  assert.equal((await live.computeLive(c)).yesterday_same_time.orders_cancelled, 0, "an undone cancellation too")

  // After Dhaka midnight the history is a new 7 days.
  time.set(MIDNIGHT + DAY + 60_000)
  await live.computeLive(c)
  assert.deepEqual(w.orderReads.slice(-2), [{ from: MIDNIGHT + DAY, to: Infinity }, { from: MIDNIGHT - 6 * DAY, to: MIDNIGHT + DAY }])
})

test("the outbox counts are shared for 60 s and today's unknown content ids too", async () => {
  const time = clock()
  const asked = []
  const { live } = loadLive(time, { "./health": { outboxHealth: async (_, options) => { asked.push(options); return [] } } })
  const w = liveWorld({ watermark: floorMinute(NOW - 30_000) })
  const c = container(w)
  const unknownReads = () => w.queries.filter((q) => q.sql.includes("(flags & 64) <> 0")).length
  await live.computeLive(c)
  assert.ok(asked[0].maxAgeMs >= 60_000, "outboxHealth may answer from its 60 s cache")
  assert.equal(unknownReads(), 1)
  time.advance(20_000)
  await live.computeLive(c)
  assert.equal(unknownReads(), 1, "the day's unknown ids are not recounted on every poll")
  time.advance(45_000)
  await live.computeLive(c)
  assert.equal(unknownReads(), 2)
})

test("renders with an empty database, and a missing table blanks only its part", async () => {
  const { live, kicks } = loadLive()
  const w = liveWorld()
  const payload = await live.computeLive(container(w))
  assert.deepEqual(plain(payload.errors), [])
  assert.equal(payload.today.visitors, 0)
  assert.equal(payload.today.pace_projection, null)
  assert.equal(payload.funnel.conversion, 0)
  assert.equal(payload.spark.length, 12 * 12 + 1, "5-minute points from midnight to noon")
  assert.equal(payload.spark[0].t, "2026-09-27T00:00:00+06:00")
  assert.deepEqual(plain(payload.tables), { sources: [], products: [], devices: [], case_types: [] })
  assert.equal(payload.health.rollup_lag_s, null)
  assert.equal(kicks.length, 1, "no watermark yet: the stale jobs are kicked")

  const { live: again } = loadLive()
  const broken = liveWorld()
  broken.broken = true
  broken.settingsFail = true
  const partial = await again.computeLive(container(broken))
  assert.ok(partial.errors.length >= 8)
  assert.match(partial.errors[0], /settings could not be read/)
  assert.equal(partial.today.page_views, 0)
  assert.equal(partial.poll_seconds, 15)
})

test("a rollup lag over 2 minutes kicks the stale jobs; a fresh watermark does not", async () => {
  const { live, kicks } = loadLive()
  await live.computeLive(container(liveWorld({ watermark: NOW - 60_000 })))
  assert.equal(kicks.length, 0)
  const { live: lagging, kicks: lagKicks } = loadLive()
  const payload = await lagging.computeLive(container(liveWorld({ watermark: NOW - 5 * MINUTE })))
  assert.equal(payload.health.rollup_lag_s, 300)
  assert.equal(lagKicks.length, 1)
})

test("tables and recent activity: labels, titles for the top rows, staff marked, no customer data", async () => {
  const day = "2026-09-27"
  const dayDim = [
    { day, dim: "product", key: "zebra-stark", event_name: "ProductView", host: HOST, count: 5, value: 7000 },
    { day, dim: "product", key: "zebra-stark", event_name: "AddToCart", host: HOST, count: 2, value: 2800 },
    { day, dim: "product", key: "zebra-stark", event_name: "Purchase", host: HOST, count: 1, value: 1400 },
    { day, dim: "product", key: "blue-wave", event_name: "ProductView", host: HOST, count: 9, value: 0 },
    { day, dim: "source", key: "meta_paid", event_name: "PageView", host: HOST, count: 4, value: 0 },
    { day, dim: "device", key: "iPhone 17 Pro Max", event_name: "ProductView", host: HOST, count: 3, value: 0 },
    { day, dim: "case_type", key: "Signature", event_name: "AddToCart", host: HOST, count: 2, value: 0 },
    { day: "2026-09-26", dim: "product", key: "old", event_name: "ProductView", host: HOST, count: 50, value: 0 },
  ]
  const hits = [
    hit({ received_at: at(NOW - 10_000), event_name: "AddToCart", handle: "zebra-stark", device: "iPhone 13", case_type: "Signature", value: 1400, source: "meta_paid" }),
    hit({ received_at: at(NOW - 20_000), event_name: "Purchase", origin: "s", items: 2, value: 2900, flags: 8 }),
    hit({ received_at: at(NOW - 30_000), event_name: "ViewContent", handle: "no-title-here", flags: 1 | 64 }),
    hit({ received_at: at(NOW - 40_000) }),
  ]
  const { live } = loadLive()
  const w = liveWorld({ hits, dayDim, watermark: floorMinute(NOW - 30_000), products: new Map([["zebra-stark", "Zebra Stark"]]),
    extraSessions: [{ session_id: "x1", visitor_id: "vx", day, started_at: at(MIDNIGHT + 1000), host: HOST, source: "meta_paid", flags: 0 }] })
  const payload = await live.computeLive(container(w))
  const products = plain(payload.tables.products)
  assert.deepEqual(products.map((row) => row.key), ["blue-wave", "zebra-stark"], "most viewed first; other days left out")
  assert.equal(products[1].label, "Zebra Stark")
  assert.equal(products[0].label, "Blue Wave", "no title: the handle in words")
  assert.deepEqual({ views: products[1].product_views, atc: products[1].add_to_cart, bought: products[1].purchases, revenue: products[1].revenue },
    { views: 5, atc: 2, bought: 1, revenue: 1400 })
  const sources = plain(payload.tables.sources)
  assert.equal(sources[0].label, "Meta ads")
  assert.equal(sources.find((row) => row.key === "meta_paid").sessions, 1)
  assert.equal(payload.tables.devices[0].key, "iPhone 17 Pro Max")
  const recent = plain(payload.recent)
  assert.deepEqual(recent.map((r) => [r.event, r.label, r.internal, r.ago_s]), [
    ["AddToCart", "Zebra Stark - iPhone 13 - Signature", false, 10],
    ["Purchase", "Order placed, 2 items", true, 20],
    ["ViewContent", "No Title Here", false, 30],
  ])
  assert.equal(recent[0].source_label, "Meta ads")
  assert.equal(payload.health.unknown_content_ids_today, 1)
  const serialized = JSON.stringify(payload)
  for (const field of ["visitor_id", "session_id", "\"ip\"", "\"ua\"", "phone", "email"]) assert.ok(!serialized.includes(field), field)
  const titleQuery = w.graph.find((g) => g.entity === "product")
  assert.ok(titleQuery.filters.handle.length <= 10 + 20, "names only for the top rows and the recent hits")
})

test("host filter: all hosts before live sending is armed, the live hosts after; unknown hosts are refused", async () => {
  const { live } = loadLive()
  const base = { test_hosts: [HOST], live_hosts: [LIVE_HOST, "www.florayn.com"], live_armed: false }
  assert.deepEqual(plain(live.resolveHostFilter(base, "")), { key: "all", hosts: null, label: "All hosts" })
  assert.deepEqual(plain(live.resolveHostFilter({ ...base, live_armed: true }, null)),
    { key: "live", hosts: [LIVE_HOST, "www.florayn.com"], label: "Live hosts" })
  assert.deepEqual(plain(live.resolveHostFilter({ ...base, live_armed: true }, "all")).hosts, null)
  assert.deepEqual(plain(live.resolveHostFilter(base, "NEW.florayn.com:443")).hosts, [HOST])
  assert.deepEqual(plain(live.resolveHostFilter(base, "test")).hosts, [HOST])
  assert.equal(live.resolveHostFilter(base, "evil.example"), null)

  const hits = [hit({ received_at: at(NOW - MINUTE), host: HOST, visitor_id: "t1" }), hit({ received_at: at(NOW - MINUTE), host: LIVE_HOST, visitor_id: "l1" })]
  const armed = liveWorld({ hits, watermark: floorMinute(NOW - 30_000), cfg: config({ live_armed: true }) })
  const payload = await live.computeLive(container(armed))
  assert.equal(payload.filter.key, "live")
  assert.equal(payload.now.visitors_5m, 1, "only the live host")
  assert.deepEqual(plain(payload.filter.options).map((o) => o.value), ["all", "live", "test", HOST, LIVE_HOST, "www.florayn.com"])
  await assert.rejects(live.computeLive(container(armed), { host: "evil.example" }), (error) => error instanceof live.LiveInputError)
})

test("staff links carry HMAC(secret, 'staff-link-v1') equal to the Appendix C vector, for every test and live host", () => {
  const secret = makeLoader({}, { process: { env: { TRACKING_INGEST_SECRET: VECTORS.keys.secret } } })("lib/tracking/secret.ts")
  const { live } = loadLive()
  const token = secret.staffLinkToken()
  assert.equal(token, VECTORS.keys.staff_link)
  const links = plain(live.staffLinks({ test_hosts: [HOST], live_hosts: [LIVE_HOST, "www.florayn.com", "NEW.florayn.com"] }, token))
  assert.deepEqual(links, [
    { host: HOST, list: "test", url: `https://${HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=1`, off_url: `https://${HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=0` },
    { host: LIVE_HOST, list: "live", url: `https://${LIVE_HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=1`, off_url: `https://${LIVE_HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=0` },
    { host: "www.florayn.com", list: "live", url: `https://www.florayn.com/api/t/staff/?t=${VECTORS.keys.staff_link}&on=1`, off_url: `https://www.florayn.com/api/t/staff/?t=${VECTORS.keys.staff_link}&on=0` },
  ])
})

// ---------------------------------------------------------------- routes

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test("GET /admin/tracking/live: private no-store, kicks stale jobs, 400 for an unknown host", async () => {
  class LiveInputError extends Error {}
  const kicks = []
  const calls = []
  const route = makeLoader({
    "../../../../lib/tracking/jobs": { kickStaleJobs: (scope) => kicks.push(scope) },
    "../../../../lib/tracking/live": {
      LiveInputError,
      async computeLive(scope, options) {
        calls.push(options)
        if (options.host === "evil.example") throw new LiveInputError("Pick one of the listed hosts, or all hosts.")
        return { ok: true }
      },
    },
  })("api/admin/tracking/live/route.ts")
  const res = fakeRes()
  await route.GET({ scope: "scope", query: {} }, res)
  assert.equal(res.headers["cache-control"], "private, no-store")
  assert.deepEqual(res.body, { ok: true })
  assert.deepEqual(kicks, ["scope"])
  assert.deepEqual(plain(calls[0]), { host: null })
  const bad = fakeRes()
  await route.GET({ scope: "scope", query: { host: "evil.example" } }, bad)
  assert.equal(bad.statusCode, 400)
})

test("GET /admin/tracking/report: 7d or 30d only, cached 5 minutes, one row per Dhaka day", async () => {
  const { live } = loadLive()
  const route = makeLoader({ "../../../../lib/tracking/live": live })("api/admin/tracking/report/route.ts")
  const bad = fakeRes()
  await route.GET({ scope: {}, query: { range: "90d" } }, bad)
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.headers["cache-control"], "private, no-store")

  const dayDim = [
    { day: "2026-09-27", dim: "source", key: "direct", event_name: "PageView", host: HOST, count: 10, value: 0 },
    { day: "2026-09-26", dim: "source", key: "meta_paid", event_name: "Purchase", host: HOST, count: 2, value: 3000 },
    { day: "2026-09-26", dim: "landing", key: "/", event_name: "Purchase", host: HOST, count: 2, value: 3000 },
    { day: "2026-09-20", dim: "source", key: "direct", event_name: "PageView", host: HOST, count: 99, value: 0 },
  ]
  const w = liveWorld({ dayDim, extraSessions: [
    { session_id: "a", visitor_id: "v1", day: "2026-09-27", started_at: at(NOW - 3_600_000), host: HOST, source: "direct", landing_path: "/", flags: 1 },
    { session_id: "b", visitor_id: "v1", day: "2026-09-26", started_at: at(NOW - DAY), host: HOST, source: "meta_paid", landing_path: "/shop/", flags: 1 | 2 | 4 | 8 },
  ] })
  const res = fakeRes()
  await route.GET({ scope: container(w), query: { range: "7d" } }, res)
  assert.equal(res.statusCode, 200)
  const report = plain(res.body)
  assert.equal(report.days.length, 7)
  assert.equal(report.from_day, "2026-09-21")
  assert.equal(report.to_day, "2026-09-27")
  assert.deepEqual(report.days.at(-1), { day: "2026-09-27", visitors: 1, sessions: 1, page_views: 10, product_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0, revenue: 0 })
  assert.equal(report.days.at(-2).purchases, 2)
  assert.equal(report.totals.page_views, 10, "the 20th is outside 7 days")
  assert.equal(report.totals.visitors, 1)
  assert.equal(report.totals.revenue, 3000)
  assert.equal(report.funnel.sessions, 2)
  assert.equal(report.funnel.purchase, 1)
  assert.deepEqual(report.tables.landing.map((row) => [row.key, row.sessions ?? 0, row.purchases]), [["/", 1, 2], ["/shop/", 1, 0]])
  const queries = w.queries.length
  const cached = fakeRes()
  await route.GET({ scope: container(w), query: { range: "7d" } }, cached)
  assert.equal(w.queries.length, queries, "the second call is served from the 5-minute cache")
  const month = fakeRes()
  await route.GET({ scope: container(w), query: { range: "30d" } }, month)
  assert.equal(month.body.days.length, 30)
  assert.equal(month.body.totals.page_views, 109)
})

test("GET /admin/tracking/staff-link: 409 without the secret, one link per host with it", async () => {
  const { live } = loadLive()
  const env = {}
  const route = makeLoader({
    "../../../../lib/tracking/live": live,
    "../../../../lib/tracking/settings": { loadTrackingSettings: async () => ({ config: { test_hosts: [HOST], live_hosts: [LIVE_HOST] } }) },
  }, { process: { env } })("api/admin/tracking/staff-link/route.ts")
  const missing = fakeRes()
  await route.GET({ scope: {} }, missing)
  assert.equal(missing.statusCode, 409)
  assert.equal(missing.headers["cache-control"], "private, no-store")
  env.TRACKING_INGEST_SECRET = VECTORS.keys.secret
  const res = fakeRes()
  await route.GET({ scope: {} }, res)
  assert.deepEqual(plain(res.body.links).map((link) => link.url), [
    `https://${HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=1`,
    `https://${LIVE_HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&on=1`,
  ])
})

// ---------------------------------------------------------------- the admin page

const PAGE = path.join(SRC, "admin/routes/live/page.tsx")
const COMPONENTS = ["admin/components/tracking/live-spark.tsx", "admin/components/tracking/live-tables.tsx"].map((f) => path.join(SRC, f))

test("the Live page: sidebar entry with an existing icon, no chart library or new dependency, definitions and staff links", () => {
  const source = fs.readFileSync(PAGE, "utf8")
  assert.match(source, /defineRouteConfig\(\{\s*label: "Live",\s*icon: ChartActivity,?\s*\}\)/)
  assert.equal(typeof require("@medusajs/icons").ChartActivity, "object", "the icon exists in @medusajs/icons")
  const allowed = /^(react|react-router-dom|@medusajs\/ui|@medusajs\/icons|@medusajs\/admin-sdk|\.{1,2}\/.*)$/
  for (const file of [PAGE, ...COMPONENTS]) {
    const text = fs.readFileSync(file, "utf8")
    for (const [, spec] of text.matchAll(/from "([^"]+)"/g)) assert.match(spec, allowed, `${path.basename(file)} imports ${spec}`)
    assert.doesNotMatch(text, /recharts|chart\.js|d3-|nivo|victory|apexcharts/i)
    // Only types may come from lib/: a runtime import would pull server code (knex) into the admin bundle.
    for (const [line] of text.matchAll(/^import (?!type )[^\n]*from "(?:\.\.\/)+lib\/[^"]+"/gm)) assert.fail(`runtime import from lib in ${file}: ${line}`)
  }
  const pkg = require("../package.json")
  assert.deepEqual(Object.keys(pkg.dependencies).filter((name) => /chart|d3|recharts|nivo/i.test(name)), [])
  assert.match(source, /ad-blocked visitors appear only through the server Purchase/)
  assert.match(source, /\/admin\/tracking\/staff-link/)
  assert.match(source, /Exclude this browser/)
  assert.match(source, /credentials: "include"/)
})

/** React with hooks that return preset state, collect effects and never re-render. */
function hookedReact(presets) {
  const React = require("react")
  const effects = []
  const setters = []
  let index = 0
  return {
    effects,
    setters,
    react: {
      ...React,
      useState(initial) {
        const i = index++
        return [Object.hasOwn(presets, i) ? presets[i] : initial, (value) => setters.push([i, value])]
      },
      useEffect(fn) { effects.push(fn) },
      useCallback(fn) { return fn },
      useRef(value) { return { current: value } },
    },
  }
}

function fakeBrowser(payload) {
  const listeners = new Map()
  const intervals = []
  const cleared = []
  const fetches = []
  const document = {
    visibilityState: "visible",
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
  }
  return {
    document, listeners, intervals, cleared, fetches,
    globals: {
      document,
      setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length },
      clearInterval(id) { cleared.push(id) },
      async fetch(url, init) {
        fetches.push({ url, init })
        return { ok: true, status: 200, json: async () => (url.includes("staff-link") ? { links: [] } : payload) }
      },
    },
  }
}

// useState order in LivePage: host, tab, live, error, report, reportError, reportBusy, links, linkError.
function loadPage(presets, browser) {
  const hooked = hookedReact(presets)
  const page = makeLoader({
    react: hooked.react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-router-dom": require("react-router-dom"),
    "@medusajs/ui": require("@medusajs/ui"),
    "@medusajs/icons": require("@medusajs/icons"),
    "@medusajs/admin-sdk": { defineRouteConfig: (value) => value },
  }, browser.globals)("admin/routes/live/page.tsx")
  return { page, hooked }
}

async function emptyPayload() {
  const { live } = loadLive()
  return live.computeLive(container(liveWorld()))
}

test("the Live page renders an empty database: zeros, definitions and the staff links", async () => {
  const payload = await emptyPayload()
  const links = plain((() => {
    const { live } = loadLive()
    return live.staffLinks({ test_hosts: [HOST], live_hosts: [LIVE_HOST] }, VECTORS.keys.staff_link)
  })())
  const browser = fakeBrowser(payload)
  const { page } = loadPage({ 2: payload, 7: links }, browser)
  assert.deepEqual(plain(page.config).label, "Live")
  const React = require("react")
  const { renderToStaticMarkup } = require("react-dom/server")
  const { MemoryRouter } = require("react-router-dom")
  const { TooltipProvider } = require("@medusajs/ui")
  // Radix warns that useLayoutEffect does nothing on the server; that is expected here.
  const error = console.error
  console.error = (message, ...rest) => { if (!String(message).includes("useLayoutEffect")) error(message, ...rest) }
  let html
  try {
    html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, page.default())))
  } finally {
    console.error = error
  }
  for (const text of ["On the shop now (last 5 minutes)", "0 of 300 orders today", "Pace: not enough order history yet",
    "No visits yet today.", "No product views yet today.", "Nothing has been queued for Meta or TikTok yet.",
    "What these numbers mean", "ad-blocked visitors appear only through the server Purchase", "Exclude this browser",
    `https://${HOST}/api/t/staff/?t=${VECTORS.keys.staff_link}&amp;on=1`, "<svg"]) {
    assert.ok(html.includes(text), `the page shows ${text}`)
  }
  assert.doesNotMatch(html, /Some parts could not be read/)

  const loading = loadPage({}, fakeBrowser(payload))
  assert.match(renderToStaticMarkup(loading.page.default()), /Loading the live numbers/)
})

test("the Live page renders a busy day: health, feed, tables, recent activity and the 7-day report", async () => {
  const outbox = [{ platform: "meta", env: "test", destination: "2247389409441720", last_sent_at: new Date(NOW - 60_000).toISOString(),
    last_error: null, last_error_at: null, counts: { pending: 2, sending: 0, retry: 1, blocked: 0, failed: 0, expired: 0, skipped: 3, dry_run: 0, sent_24h: 40 } }]
  const { live } = loadLive(clock(), {
    "./health": { outboxHealth: async () => outbox },
    "./catalog-feed": {
      feedMeta: async () => [{ platform: "meta", kind: "published", item_count: 1200, published_at: new Date(NOW - 3_600_000).toISOString(), status: "published" }],
      lastFeedFetches: async () => ({ meta: { platform: "meta", fetched_at: new Date(NOW - 7_200_000).toISOString(), status: 200, user_agent: null, bytes: 1 } }),
    },
  })
  const day = "2026-09-27"
  const hits = [
    hit({ received_at: at(NOW - 10_000), event_name: "AddToCart", handle: "zebra-stark", device: "iPhone 13", case_type: "Signature", value: 1400, source: "meta_paid" }),
    hit({ received_at: at(NOW - 20_000), event_name: "Purchase", origin: "s", items: 2, value: 2900, flags: 8 }),
    hit({ received_at: at(NOW - 3 * 3_600_000), visitor_id: "v7", session_id: "s7" }),
  ]
  const w = liveWorld({ hits, watermark: floorMinute(NOW - 30_000), dayDim: [
    { day, dim: "product", key: "zebra-stark", event_name: "ProductView", host: HOST, count: 5, value: 7000 },
    { day, dim: "source", key: "meta_paid", event_name: "Purchase", host: HOST, count: 1, value: 2900 },
  ], orders: [{ id: "o1", total: 2900, created_at: new Date(NOW - 3_600_000).toISOString(), canceled_at: null, is_draft_order: false }] })
  const payload = await live.computeLive(container(w))
  const report = await live.computeReport(container(w), "7d")
  const React = require("react")
  const { renderToStaticMarkup } = require("react-dom/server")
  const { MemoryRouter } = require("react-router-dom")
  const { TooltipProvider } = require("@medusajs/ui")
  const render = (presets) => {
    const { page } = loadPage(presets, fakeBrowser(payload))
    const error = console.error
    console.error = (message, ...rest) => { if (!String(message).includes("useLayoutEffect")) error(message, ...rest) }
    try {
      return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, page.default())))
    } finally {
      console.error = error
    }
  }
  const html = render({ 2: payload, 8: "TRACKING_INGEST_SECRET is not set on the server, so staff links cannot be made yet." })
  for (const text of ["1 of 300 orders today", "Meta TEST", "Catalog feed: Meta 1,200 items", "Zebra Stark - iPhone 13 - Signature",
    "Staff", "Meta ads", "TRACKING_INGEST_SECRET is not set"]) {
    assert.ok(html.includes(text), `the page shows ${text}`)
  }
  // The 7-day tab (Radix renders only the active tab's content).
  const reportHtml = render({ 1: "7d", 2: payload, 4: { key: "7d|", data: report } })
  for (const text of ["Sep 21 to Sep 27", "By day", "Landing pages", "Women / Men"]) assert.ok(reportHtml.includes(text), `the report shows ${text}`)
})

test("the Live page polls every poll_seconds only while visible and on Today, and stops when hidden", async () => {
  const payload = await emptyPayload()
  const browser = fakeBrowser(payload)
  const { page, hooked } = loadPage({ 2: payload }, browser)
  page.default()
  // Effects in order: first load, polling, report tab, staff links.
  assert.equal(hooked.effects.length, 4)
  hooked.effects[0]()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(browser.fetches[0].url, "/admin/tracking/live")
  assert.equal(browser.fetches[0].init.credentials, "include")

  const cleanup = hooked.effects[1]()
  assert.equal(browser.intervals.length, 1)
  assert.equal(browser.intervals[0].ms, payload.poll_seconds * 1000)
  const onVisibility = browser.listeners.get("visibilitychange")
  browser.document.visibilityState = "hidden"
  onVisibility()
  assert.deepEqual(browser.cleared, [1], "hidden: the timer stops")
  const fetchesWhileHidden = browser.fetches.length
  browser.document.visibilityState = "visible"
  onVisibility()
  assert.equal(browser.fetches.length, fetchesWhileHidden + 1, "visible again: catch up at once")
  assert.equal(browser.intervals.length, 2, "and poll again")
  cleanup()
  assert.equal(browser.listeners.has("visibilitychange"), false)
  assert.deepEqual(browser.cleared, [1, 2])

  const hiddenStart = fakeBrowser(payload)
  hiddenStart.document.visibilityState = "hidden"
  const second = loadPage({ 2: payload }, hiddenStart)
  second.page.default()
  second.hooked.effects[1]()
  assert.equal(hiddenStart.intervals.length, 0, "a hidden tab never starts polling")

  const report = fakeBrowser(payload)
  const onReport = loadPage({ 1: "7d", 2: payload }, report)
  onReport.page.default()
  assert.equal(onReport.hooked.effects[1](), undefined)
  assert.equal(report.intervals.length, 0, "no live polling on the 7 and 30 day tabs")
  onReport.hooked.effects[2]()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(report.fetches[0].url, "/admin/tracking/report?range=7d")
})
