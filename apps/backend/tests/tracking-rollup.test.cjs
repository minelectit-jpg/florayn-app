// Live dashboard rollup (lib/tracking/rollup.ts, jobs/tracking-rollup.ts,
// TRACKING.md 9): the window is [watermark, date_trunc('minute', now - 20 s)),
// tracking_minute is SET (a rerun is identical), sessions upsert with
// least/greatest/bit-or/+=, day_dim covers all 7 dims (Purchase items from
// the order), the watermark moves in the same transaction and the advisory
// lock keeps a second run out. There is no Postgres here: the fake database
// below applies each statement's documented semantics to in-memory tables and
// rolls back a failed transaction, and the SQL text is checked for them.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")
const HOST = "new.florayn.com"
const squash = (sql) => sql.replace(/\s+/g, " ").trim()
const at = (iso) => new Date(`2026-09-27T${iso}Z`)

function makeLoader(stubs, globals = {}) {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, {
      exports, console, JSON, ...globals,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name]
        if (name.startsWith(".")) return loadFile(path.resolve(path.dirname(filename), `${name}.ts`))
        throw new Error(`Unexpected import ${name} in ${filename}`)
      },
    }, { filename })
    return exports
  }
  return (file) => loadFile(path.join(SRC, file))
}

const UTILS = { ContainerRegistrationKeys: { PG_CONNECTION: "pg", QUERY: "query" } }

function loadRollup() {
  return makeLoader({ "@medusajs/framework/utils": UTILS })("lib/tracking/rollup.ts")
}

// ---------------------------------------------------------------- the fake database

function floorMinute(date) {
  return new Date(date.getTime() - (date.getTime() % 60_000))
}

function dhakaDate(date) {
  return new Date(date.getTime() + 6 * 3_600_000).toISOString().slice(0, 10)
}

function hit(overrides) {
  return {
    event_name: "PageView", event_id: `e-${Math.random()}`, origin: "b", visitor_id: "v1", session_id: "s1",
    source: "meta_paid", campaign: null, device_class: "mobile", audience: "women", host: HOST, path: "/",
    handle: null, variant_id: null, device: null, case_type: null, value: null, items: null, flags: 0,
    ...overrides,
  }
}

function world(overrides = {}) {
  return {
    dbNow: at("04:10:30"),
    hits: [],
    minute: new Map(),
    sessions: new Map(),
    dayDim: new Map(),
    state: new Map(),
    orderContexts: [],
    variants: new Map(),
    orders: new Map(),
    lockHeld: false,
    failOn: null,
    queryFails: false,
    log: [],
    ...overrides,
  }
}

function snapshot(w) {
  const copy = (map) => new Map([...map].map(([key, value]) => [key, structuredClone(value)]))
  return { minute: copy(w.minute), sessions: copy(w.sessions), dayDim: copy(w.dayDim), state: copy(w.state) }
}

function restore(w, snap) {
  Object.assign(w, snapshot(snap))
}

function inWindow(h, [from, to]) {
  return h.received_at >= from && h.received_at < to
}

function applyMinute(w, sql, range) {
  const set = /do update set count = excluded\.count, value = excluded\.value/.test(sql)
  if (!set) throw new Error("tracking_minute must be SET on conflict")
  const groups = new Map()
  for (const h of w.hits) {
    if (!inWindow(h, range) || (h.flags & 8)) continue
    const names = h.event_name === "ViewContent" && (h.flags & 1) ? [h.event_name, "ProductView"] : [h.event_name]
    for (const name of names) {
      const key = `${floorMinute(h.received_at).toISOString()}|${name}|${h.source ?? ""}|${h.host}`
      const group = groups.get(key) ?? { count: 0, value: 0 }
      group.count += 1
      group.value += h.value ?? 0
      groups.set(key, group)
    }
  }
  for (const [key, group] of groups) w.minute.set(key, { ...group })
  return { rowCount: groups.size }
}

const SESSION_EVENT = { ViewContent: 1, AddToCart: 2, InitiateCheckout: 4, Purchase: 8 }

function applySessions(w, sql, range) {
  for (const clause of ["least(tracking_session.started_at, excluded.started_at)", "greatest(tracking_session.last_at, excluded.last_at)",
    "flags = tracking_session.flags | excluded.flags", "pageviews = tracking_session.pageviews + excluded.pageviews",
    "purchase_value = tracking_session.purchase_value + excluded.purchase_value"]) {
    if (!sql.includes(clause)) throw new Error(`session upsert lacks ${clause}`)
  }
  const bySession = new Map()
  for (const h of w.hits) {
    if (!inWindow(h, range) || !h.session_id) continue
    const list = bySession.get(h.session_id) ?? []
    list.push(h)
    bySession.set(h.session_id, list)
  }
  for (const [id, list] of bySession) {
    list.sort((a, b) => a.received_at - b.received_at || a.event_id.localeCompare(b.event_id))
    const first = list[0]
    const landing = list.find((h) => h.event_name === "PageView" && h.path)
    const row = {
      visitor_id: list.map((h) => h.visitor_id).filter(Boolean).sort().at(-1) ?? "",
      day: dhakaDate(first.received_at),
      started_at: first.received_at,
      last_at: list.at(-1).received_at,
      source: first.source, landing_path: landing?.path ?? null, host: first.host, is_new_visitor: Boolean(first.flags & 16),
      flags: list.reduce((f, h) => f | (SESSION_EVENT[h.event_name] ?? 0) | (h.flags & 8 ? 16 : 0), 0),
      pageviews: list.filter((h) => h.event_name === "PageView").length,
      purchase_value: list.filter((h) => h.event_name === "Purchase").reduce((s, h) => s + (h.value ?? 0), 0),
    }
    const prev = w.sessions.get(id)
    w.sessions.set(id, prev ? {
      ...prev,
      started_at: new Date(Math.min(prev.started_at, row.started_at)),
      last_at: new Date(Math.max(prev.last_at, row.last_at)),
      flags: prev.flags | row.flags,
      pageviews: prev.pageviews + row.pageviews,
      purchase_value: prev.purchase_value + row.purchase_value,
      landing_path: prev.landing_path ?? row.landing_path,
    } : row)
  }
  return { rowCount: bySession.size }
}

function addDim(w, day, dim, key, event, host, count, value) {
  if (key === null || key === undefined || key === "") return
  const id = `${day}|${dim}|${key}|${event}|${host}`
  const prev = w.dayDim.get(id) ?? { count: 0, value: 0 }
  w.dayDim.set(id, { count: prev.count + count, value: prev.value + value })
}

function applyDayDims(w, sql, range) {
  for (const dim of ["product", "device", "case_type", "source", "audience", "device_class", "landing"]) {
    if (!sql.includes(`('${dim}',`)) throw new Error(`day_dim lacks the ${dim} dim`)
  }
  if (!sql.includes("count = tracking_day_dim.count + excluded.count")) throw new Error("day_dim must add")
  let n = 0
  for (const h of w.hits) {
    if (!inWindow(h, range) || (h.flags & 8)) continue
    const names = h.event_name === "ViewContent" && (h.flags & 1) ? [h.event_name, "ProductView"] : [h.event_name]
    const landing = w.sessions.get(h.session_id)?.landing_path?.split("?")[0] ?? null
    for (const name of names) {
      const item = h.event_name !== "Purchase"
      const day = dhakaDate(h.received_at)
      const v = h.value ?? 0
      addDim(w, day, "product", item ? h.handle : null, name, h.host, 1, v)
      addDim(w, day, "device", item ? h.device : null, name, h.host, 1, v)
      addDim(w, day, "case_type", item ? h.case_type : null, name, h.host, 1, v)
      addDim(w, day, "source", h.source || "unknown", name, h.host, 1, v)
      addDim(w, day, "audience", h.audience, name, h.host, 1, v)
      addDim(w, day, "device_class", h.device_class, name, h.host, 1, v)
      addDim(w, day, "landing", landing, name, h.host, 1, v)
      n += 1
    }
  }
  return { rowCount: n }
}

function answer(w, sql, bindings) {
  if (w.failOn && sql.includes(w.failOn)) {
    w.failOn = null
    throw new Error("injected failure")
  }
  if (sql.includes("pg_try_advisory_xact_lock")) {
    const locked = !w.lockHeld
    w.lockHeld = true
    return { rows: [{ locked }] }
  }
  if (sql.startsWith("set local statement_timeout")) return {}
  if (sql.startsWith("select value from tracking_state where key = ?")) {
    return { rows: w.state.has(bindings[0]) ? [{ value: structuredClone(w.state.get(bindings[0])) }] : [] }
  }
  if (sql.startsWith("insert into tracking_state")) {
    w.state.set(bindings[0], JSON.parse(bindings[1]))
    return { rowCount: 1 }
  }
  if (sql.includes("as until")) {
    return { rows: [{ until: floorMinute(new Date(w.dbNow.getTime() - 20_000)), initial: floorMinute(new Date(w.dbNow.getTime() - 3_600_000)) }] }
  }
  if (sql.includes("insert into tracking_minute")) return applyMinute(w, sql, bindings)
  if (sql.includes("insert into tracking_session")) return applySessions(w, sql, bindings)
  if (sql.includes("insert into tracking_day_dim") && sql.includes("cross join lateral")) return applyDayDims(w, sql, bindings)
  if (sql.includes("event_name = 'Purchase' and (flags & 8) = 0")) {
    return { rows: w.hits.filter((h) => inWindow(h, bindings) && h.event_name === "Purchase" && !(h.flags & 8)) }
  }
  if (sql.startsWith("select order_id, display_id from tracking_order_context")) {
    return { rows: w.orderContexts.filter((c) => bindings.includes(c.display_id)) }
  }
  if (sql.startsWith("select variant_id, handle, device, case_type from tracking_variant")) {
    return { rows: bindings.filter((id) => w.variants.has(id)).map((id) => ({ variant_id: id, ...w.variants.get(id) })) }
  }
  if (sql.startsWith("insert into tracking_day_dim") && sql.includes("values (?::date")) {
    assert.match(sql, /count = tracking_day_dim\.count \+ excluded\.count/)
    for (let i = 0; i < bindings.length; i += 6) {
      const [day, dim, key, host, count, value] = bindings.slice(i, i + 6)
      addDim(w, day, dim, key, "Purchase", host, count, value)
    }
    return { rowCount: bindings.length / 6 }
  }
  throw new Error(`Unexpected SQL: ${sql.slice(0, 120)}`)
}

function fakePg(w) {
  function handle(via) {
    return {
      async raw(sql, bindings = []) {
        const s = squash(sql)
        w.log.push({ via, sql: s, bindings })
        return answer(w, s, bindings)
      },
      async transaction(fn) {
        const snap = snapshot(w)
        const top = via === "pg"
        try {
          return await fn(handle(top ? "trx" : "savepoint"))
        } catch (error) {
          restore(w, snap)
          throw error
        } finally {
          if (top) w.lockHeld = false
        }
      },
    }
  }
  return handle("pg")
}

function container(w) {
  const pg = fakePg(w)
  return {
    resolve(key) {
      if (key === "pg") return pg
      if (key === "query") {
        return {
          async graph({ entity, filters }) {
            assert.equal(entity, "order")
            if (w.queryFails) throw new Error("query down")
            return { data: filters.id.map((id) => w.orders.get(id)).filter(Boolean) }
          },
        }
      }
      throw new Error(`Unexpected resolve ${key}`)
    },
  }
}

/** The morning of 2026-09-27 (Dhaka 10:02-10:10): one shopper who views, adds and buys; one staff page view. */
function morning(overrides = {}) {
  const w = world(overrides)
  w.state.set("rollup:watermark", { done_through: "2026-09-27T04:02:00.000Z" })
  w.hits.push(
    hit({ event_id: "h0", received_at: at("04:01:59"), path: "/old/" }),
    hit({ event_id: "h1", received_at: at("04:02:10"), path: "/", flags: 32 | 16 }),
    hit({ event_id: "h2", event_name: "ViewContent", received_at: at("04:03:00"), path: "/product/zebra-stark/", handle: "zebra-stark",
      device: "iPhone 17 Pro Max", case_type: "Signature", variant_id: "variant_A", value: 1400, items: 1, flags: 1 }),
    hit({ event_id: "h3", event_name: "ViewContent", received_at: at("04:03:30"), path: "/product/zebra-stark/", handle: "zebra-stark",
      device: "iPhone 16", case_type: "Signature", variant_id: "variant_B", value: 1400, items: 1, flags: 2 }),
    hit({ event_id: "h4", event_name: "AddToCart", received_at: at("04:04:00"), path: "/product/zebra-stark/", handle: "zebra-stark",
      device: "iPhone 17 Pro Max", case_type: "Signature", variant_id: "variant_A", value: 1400, items: 1 }),
    hit({ event_id: "h5", received_at: at("04:05:00"), visitor_id: "v2", session_id: "s2", source: "direct", flags: 8 }),
    hit({ event_id: "fl-1001", event_name: "Purchase", origin: "s", received_at: at("04:06:00"), path: "/checkout/", value: 1520, items: 1 }),
    hit({ event_id: "h7", received_at: at("04:10:05"), visitor_id: "v3", session_id: "s3" }),
  )
  w.orderContexts.push({ order_id: "order_1", display_id: 1001 })
  w.orders.set("order_1", { id: "order_1", items: [{ variant_id: "variant_A", product_handle: "zebra-stark", quantity: 1, unit_price: 1400 }] })
  w.variants.set("variant_A", { handle: "zebra-stark", device: "iPhone 17 Pro Max", case_type: "Signature" })
  return w
}

const dim = (w, day, d, key, event) => w.dayDim.get(`${day}|${d}|${key}|${event}|${HOST}`)

// ---------------------------------------------------------------- tests

test("rollupWindow: [watermark, until), first run one hour back, capped at 6 hours, whole minutes", () => {
  const rollup = loadRollup()
  const until = at("04:10:00")
  const initial = at("03:10:00")
  const w1 = rollup.rollupWindow("2026-09-27T04:02:00.000Z", until, initial)
  assert.equal(w1.from.toISOString(), "2026-09-27T04:02:00.000Z")
  assert.equal(w1.to.toISOString(), "2026-09-27T04:10:00.000Z")
  const first = rollup.rollupWindow(null, until, initial)
  assert.equal(first.from.toISOString(), "2026-09-27T03:10:00.000Z")
  assert.equal(rollup.rollupWindow("2026-09-27T04:10:00.000Z", until, initial), null, "nothing closed yet")
  assert.equal(rollup.rollupWindow("2026-09-27T04:11:00.000Z", until, initial), null)
  const late = rollup.rollupWindow("2026-09-26T18:00:00.000Z", until, initial)
  assert.equal(late.to.getTime() - late.from.getTime(), rollup.MAX_WINDOW_MS)
  assert.equal(rollup.MAX_WINDOW_MS, 6 * 3_600_000)
})

test("the bounds query is date_trunc('minute', now() - 20 s) and one hour back for the first run", () => {
  const { BOUNDS_SQL, LOCK_SQL } = loadRollup()
  assert.match(squash(BOUNDS_SQL), /date_trunc\('minute', now\(\) - interval '20 seconds'\) as until/)
  assert.match(squash(BOUNDS_SQL), /date_trunc\('minute', now\(\) - interval '1 hour'\) as initial/)
  assert.equal(LOCK_SQL, "select pg_try_advisory_xact_lock(hashtext('florayn-tracking-rollup')) as locked")
})

test("a run folds the window into minutes, sessions and day dims and moves the watermark in the same transaction", async () => {
  const rollup = loadRollup()
  const w = morning()
  const result = await rollup.rollupOnce(container(w))
  assert.equal(result.status, "done")
  assert.equal(result.from, "2026-09-27T04:02:00.000Z")
  assert.equal(result.to, "2026-09-27T04:10:00.000Z")

  // Every statement ran inside the one transaction (the Purchase item step in its savepoint).
  assert.ok(w.log.every((entry) => entry.via !== "pg"), "nothing ran outside the transaction")
  assert.equal(w.log[0].sql, rollup.LOCK_SQL, "the lock is taken first")
  const order = w.log.map((entry) => entry.sql.includes("insert into tracking_minute") ? "minute"
    : entry.sql.includes("insert into tracking_session") ? "session"
      : entry.sql.includes("cross join lateral") ? "dims"
        : entry.sql.startsWith("insert into tracking_state") ? "watermark" : null).filter(Boolean)
  assert.deepEqual(order, ["minute", "session", "dims", "watermark"])
  const minuteCall = w.log.find((entry) => entry.sql.includes("insert into tracking_minute"))
  assert.deepEqual(Array.from(minuteCall.bindings, (d) => d.toISOString()), ["2026-09-27T04:02:00.000Z", "2026-09-27T04:10:00.000Z"])
  const watermarkWrite = w.log.find((entry) => entry.sql.startsWith("insert into tracking_state"))
  assert.equal(watermarkWrite.via, "trx")
  assert.deepEqual(w.state.get("rollup:watermark"), { done_through: "2026-09-27T04:10:00.000Z" })

  // Minutes: staff (h5), the rolled-up h0 and the still-open h7 are left out; ProductView = primary VC only.
  const minute = (m, event, source = "meta_paid") => w.minute.get(`2026-09-27T04:${m}:00.000Z|${event}|${source}|${HOST}`)
  assert.deepEqual(minute("02", "PageView"), { count: 1, value: 0 })
  assert.deepEqual(minute("03", "ViewContent"), { count: 2, value: 2800 })
  assert.deepEqual(minute("03", "ProductView"), { count: 1, value: 1400 })
  assert.deepEqual(minute("04", "AddToCart"), { count: 1, value: 1400 })
  assert.deepEqual(minute("06", "Purchase"), { count: 1, value: 1520 })
  assert.equal(minute("05", "PageView", "direct"), undefined, "staff hits are not counted")
  assert.equal(minute("01", "PageView"), undefined)
  assert.equal(w.minute.size, 5)

  // Sessions: first hit attributes, landing from the first PageView, flags and value.
  const s1 = w.sessions.get("s1")
  assert.equal(s1.day, "2026-09-27")
  assert.equal(s1.started_at.toISOString(), "2026-09-27T04:02:10.000Z")
  assert.equal(s1.last_at.toISOString(), "2026-09-27T04:06:00.000Z")
  assert.equal(s1.flags, 1 | 2 | 8)
  assert.equal(s1.pageviews, 1)
  assert.equal(s1.purchase_value, 1520)
  assert.equal(s1.landing_path, "/")
  assert.equal(s1.is_new_visitor, true)
  assert.equal(w.sessions.get("s2").flags, 16, "a staff session is kept, marked internal")
  assert.equal(w.sessions.has("s3"), false)

  // Day dims: all seven, Purchase products from the order items.
  const day = "2026-09-27"
  assert.deepEqual(dim(w, day, "product", "zebra-stark", "ViewContent"), { count: 2, value: 2800 })
  assert.deepEqual(dim(w, day, "product", "zebra-stark", "ProductView"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "product", "zebra-stark", "AddToCart"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "product", "zebra-stark", "Purchase"), { count: 1, value: 1400 }, "from the order's items")
  assert.deepEqual(dim(w, day, "device", "iPhone 17 Pro Max", "Purchase"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "case_type", "Signature", "Purchase"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "device", "iPhone 16", "ViewContent"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "source", "meta_paid", "Purchase"), { count: 1, value: 1520 })
  assert.deepEqual(dim(w, day, "audience", "women", "PageView"), { count: 1, value: 0 })
  assert.deepEqual(dim(w, day, "device_class", "mobile", "AddToCart"), { count: 1, value: 1400 })
  assert.deepEqual(dim(w, day, "landing", "/", "Purchase"), { count: 1, value: 1520 })
  assert.equal(dim(w, day, "source", "direct", "PageView"), undefined, "staff hits are not in day dims")
  assert.equal(result.purchase_items, 3)
})

test("tracking_minute is SET: rerunning the same window gives identical rows", async () => {
  const rollup = loadRollup()
  const w = morning()
  await rollup.rollupOnce(container(w))
  const first = new Map(w.minute)
  w.state.set("rollup:watermark", { done_through: "2026-09-27T04:02:00.000Z" })
  await rollup.rollupOnce(container(w))
  assert.deepEqual(w.minute, first)
  assert.match(squash(rollup.MINUTE_SQL), /on conflict \(bucket, event_name, source, host\) do update set count = excluded\.count, value = excluded\.value$/)
  assert.doesNotMatch(rollup.MINUTE_SQL, /tracking_minute\.count \+/)
  assert.match(squash(rollup.MINUTE_SQL), /\(flags & 8\) = 0/)
})

test("a failure rolls the whole run back, watermark included; the next run folds the same window once", async () => {
  const rollup = loadRollup()
  const w = morning({ failOn: "insert into tracking_day_dim (day, dim, key, event_name, host, count, value) select" })
  await assert.rejects(rollup.rollupOnce(container(w)), /injected failure/)
  assert.equal(w.minute.size, 0)
  assert.equal(w.sessions.size, 0)
  assert.deepEqual(w.state.get("rollup:watermark"), { done_through: "2026-09-27T04:02:00.000Z" })

  const again = await rollup.rollupOnce(container(w))
  assert.equal(again.status, "done")
  const clean = morning()
  await rollup.rollupOnce(container(clean))
  assert.deepEqual(w.minute, clean.minute)
  assert.deepEqual(w.sessions, clean.sessions)
  assert.deepEqual(w.dayDim, clean.dayDim)
})

test("sessions upsert with least/greatest/bit-or and pageviews += n across windows", async () => {
  const rollup = loadRollup()
  const w = morning()
  await rollup.rollupOnce(container(w))
  w.hits.push(hit({ event_id: "later-pv", received_at: at("04:12:00"), path: "/shop/" }),
    hit({ event_id: "later-ic", event_name: "InitiateCheckout", received_at: at("04:12:30"), path: "/checkout/", value: 1400, items: 1 }))
  w.dbNow = at("04:13:30")
  const result = await rollup.rollupOnce(container(w))
  assert.equal(result.from, "2026-09-27T04:10:00.000Z")
  const s1 = w.sessions.get("s1")
  assert.equal(s1.started_at.toISOString(), "2026-09-27T04:02:10.000Z", "least keeps the start")
  assert.equal(s1.last_at.toISOString(), "2026-09-27T04:12:30.000Z", "greatest moves the end")
  assert.equal(s1.flags, 1 | 2 | 4 | 8)
  assert.equal(s1.pageviews, 2)
  assert.equal(s1.landing_path, "/", "the landing page stays the first one")
  assert.equal(w.sessions.get("s3").pageviews, 1, "the hit that was still open is folded now")
  assert.deepEqual(dim(w, "2026-09-27", "landing", "/", "PageView"), { count: 3, value: 0 }, "s1's two page views and s3's one, all landed on /")
  assert.deepEqual(dim(w, "2026-09-27", "landing", "/", "InitiateCheckout"), { count: 1, value: 1400 }, "a later event keeps the session's landing page")

  const sql = squash(rollup.SESSION_SQL)
  assert.match(sql, /\(a\.started_at at time zone 'Asia\/Dhaka'\)::date/)
  assert.match(sql, /when 'Purchase' then 8 else 0 end \| case when \(flags & 8\) <> 0 then 16 else 0 end/)
})

test("the advisory lock keeps a second concurrent run out, and a locked run changes nothing", async () => {
  const rollup = loadRollup()
  const w = morning()
  const c = container(w)
  const [a, b] = await Promise.all([rollup.rollupOnce(c), rollup.rollupOnce(c)])
  assert.deepEqual([a.status, b.status].sort(), ["done", "locked"])
  const locked = w.log.filter((entry) => entry.sql === rollup.LOCK_SQL)
  assert.equal(locked.length, 2)

  const busy = morning({ lockHeld: true })
  const result = await rollup.rollupOnce(container(busy))
  assert.equal(result.status, "locked")
  assert.deepEqual(busy.log.map((entry) => entry.sql), [rollup.LOCK_SQL])
  assert.deepEqual(busy.state.get("rollup:watermark"), { done_through: "2026-09-27T04:02:00.000Z" })
})

test("nothing closed to fold: no writes; first run starts one hour back", async () => {
  const rollup = loadRollup()
  const idle = morning()
  idle.state.set("rollup:watermark", { done_through: "2026-09-27T04:10:00.000Z" })
  assert.equal((await rollup.rollupOnce(container(idle))).status, "idle")
  assert.equal(idle.log.filter((entry) => entry.sql.startsWith("insert")).length, 0)

  const fresh = morning()
  fresh.state.clear()
  const result = await rollup.rollupOnce(container(fresh))
  assert.equal(result.from, "2026-09-27T03:10:00.000Z")
  assert.equal(fresh.sessions.get("s1").pageviews, 2, "h0 (04:01:59) is inside the first hour")
  assert.equal(fresh.sessions.get("s1").landing_path, "/old/")
  assert.deepEqual(fresh.state.get("rollup:watermark"), { done_through: "2026-09-27T04:10:00.000Z" })
})

test("a failing order lookup only skips the Purchase items (savepoint); the rest commits", async () => {
  const rollup = loadRollup()
  const w = morning({ queryFails: true })
  const result = await rollup.rollupOnce(container(w))
  assert.equal(result.status, "done")
  assert.equal(result.purchase_items, 0)
  assert.equal(dim(w, "2026-09-27", "product", "zebra-stark", "Purchase"), undefined)
  assert.deepEqual(dim(w, "2026-09-27", "source", "meta_paid", "Purchase"), { count: 1, value: 1520 })
  assert.deepEqual(w.state.get("rollup:watermark"), { done_through: "2026-09-27T04:10:00.000Z" })
  assert.ok(w.log.some((entry) => entry.via === "savepoint"), "the item step runs in a savepoint")

  const broken = morning({ failOn: "from tracking_variant where variant_id in" })
  const second = await rollup.rollupOnce(container(broken))
  assert.equal(second.status, "done")
  assert.equal(broken.minute.size, 5)
})

test("purchaseItemDeltas: units and line totals per product, model and case; merged; unknown orders skipped", () => {
  const { purchaseItemDeltas, purchaseDisplayId, dhakaDay } = loadRollup()
  assert.equal(purchaseDisplayId("fl-1234"), 1234)
  assert.equal(purchaseDisplayId("fl-0"), null)
  assert.equal(purchaseDisplayId("order_01ABC"), null)
  const hits = [
    { event_id: "fl-1", host: HOST, received_at: at("17:59:00") },
    { event_id: "fl-2", host: HOST, received_at: at("18:01:00") },
    { event_id: "fl-3", host: HOST, received_at: at("18:02:00") },
  ]
  const orders = new Map([
    [1, { id: "o1", items: [{ variant_id: "variant_A", quantity: 2, unit_price: 1400 }, { variant_id: "variant_X", product_handle: "stickpad-pro", quantity: 1, unit_price: 500 }] }],
    [2, { id: "o2", items: [{ variant_id: "variant_A", quantity: 1, unit_price: "1400" }, { variant_id: "variant_A", quantity: 0, unit_price: 1400 }] }],
  ])
  const variants = new Map([["variant_A", { handle: "zebra-stark", device: "iPhone 13", case_type: "Signature" }]])
  const deltas = purchaseItemDeltas(hits, orders, variants)
  const find = (day, d, key) => deltas.find((x) => x.day === day && x.dim === d && x.key === key)
  assert.deepEqual({ ...find("2026-09-27", "product", "zebra-stark") }, { day: "2026-09-27", dim: "product", key: "zebra-stark", host: HOST, count: 2, value: 2800 })
  assert.equal(find("2026-09-27", "product", "stickpad-pro").count, 1, "falls back to the line's handle")
  assert.equal(find("2026-09-27", "device", "variant_X"), undefined)
  assert.deepEqual({ ...find("2026-09-28", "product", "zebra-stark") }, { day: "2026-09-28", dim: "product", key: "zebra-stark", host: HOST, count: 1, value: 1400 },
    "18:01 UTC is the next Dhaka day")
  assert.equal(deltas.filter((x) => x.day === "2026-09-28").length, 3)
  assert.equal(dhakaDay(Date.parse("2026-09-27T17:59:59.999Z")), "2026-09-27")
  assert.equal(dhakaDay(Date.parse("2026-09-27T18:00:00.000Z")), "2026-09-28")
})

test("day_dim SQL: seven dims, Dhaka day, staff excluded, Purchase items only from orders, += on conflict", () => {
  const { DAY_DIM_SQL, DAY_DIMS } = loadRollup()
  const sql = squash(DAY_DIM_SQL)
  assert.deepEqual([...DAY_DIMS], ["product", "device", "case_type", "source", "audience", "device_class", "landing"])
  for (const d of DAY_DIMS) assert.ok(sql.includes(`('${d}',`), d)
  assert.match(sql, /\(e\.received_at at time zone 'Asia\/Dhaka'\)::date/)
  assert.match(sql, /\(h\.flags & 8\) = 0/)
  assert.match(sql, /\('product', case when e\.event_name = 'Purchase' then null else e\.handle end\)/)
  assert.match(sql, /coalesce\(nullif\(e\.source, ''\), 'unknown'\)/)
  assert.match(sql, /do update set count = tracking_day_dim\.count \+ excluded\.count, value = tracking_day_dim\.value \+ excluded\.value$/)
  assert.doesNotMatch(DAY_DIM_SQL.replace(/--.*$/gm, ""), /'\?'/, "no literal ? for knex to take as a binding")
})

test("jobs/tracking-rollup.ts registers 'rollup' (staleAfterMs 180000), every minute, and runs through runTrackingJob", async () => {
  const calls = []
  const runRollup = async () => undefined
  const job = makeLoader({
    "../lib/tracking/jobs": {
      registerTrackingJob: (name, spec) => calls.push(["register", name, spec]),
      runTrackingJob: async (c, name, run) => calls.push(["run", c, name, run]),
    },
    "../lib/tracking/rollup": { runRollup },
  })("jobs/tracking-rollup.ts")
  assert.equal(calls[0][0], "register")
  assert.equal(calls[0][1], "rollup")
  assert.equal(calls[0][2].staleAfterMs, 180_000)
  assert.equal(calls[0][2].run, runRollup)
  assert.deepEqual(JSON.parse(JSON.stringify(job.config)), { name: "tracking-rollup", schedule: "* * * * *" })
  const c = { id: "container" }
  await job.default(c)
  assert.deepEqual(calls[1], ["run", c, "rollup", runRollup])
  // WP03's sweep_stale alert hard-codes the same threshold.
  assert.match(fs.readFileSync(path.join(SRC, "lib/tracking/alerts.ts"), "utf8"), /rollup: 180_000/)
})
