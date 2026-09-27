const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// The review's abuse finding against /api/t/e/ (TRACKING.md 4.2, 4.3): a
// script that sends a fresh _fl_vid on every batch and rotates its address
// inside one IPv6 /64 used to get a new per-IP bucket each time and could fill
// the whole 3,000 events per 10 s forward cap, so every real shopper's events
// were dropped. Now the per-IP bucket is per /64 (ipSource) and the forward
// cap is shared fairly between sources (FAIR_SHARE). The route-level version
// of the scenario is in tracking-endpoints.test.cjs.
const src = path.join(__dirname, "..", "src")
const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(setImmediate) }

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function resolveImport(from, spec) {
  let base
  if (spec.startsWith("@/")) base = path.join(src, spec.slice(2))
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(candidate)) return candidate
  return null
}

/** Transpiles the server modules into one vm context; lib/medusa is stubbed, node: builtins are real. */
function load(relative) {
  const stubs = { "lib/medusa": { MEDUSA_BACKEND_URL: "https://api.test", MEDUSA_PUBLISHABLE_KEY: "pk_test" } }
  const context = vm.createContext({
    console, Buffer, URL, TextDecoder, TextEncoder, AbortSignal, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "production", TRACKING_INGEST_SECRET: "s".repeat(64) } },
  })
  const cache = new Map()
  function loadFile(file) {
    const key = path.relative(src, file).replace(/\\/g, "/").replace(/\.tsx?$/, "")
    if (key in stubs) return stubs[key]
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const localRequire = (spec) => {
      if (spec.startsWith("node:")) return require(spec)
      const target = resolveImport(file, spec)
      if (!target) throw new Error(`Unexpected import ${spec} in ${key}`)
      return loadFile(target)
    }
    vm.runInContext(`(function (exports, require, module) {${compile(file)}\n})`, context, { filename: file })(module.exports, localRequire, module)
    return module.exports
  }
  return loadFile(path.join(src, relative))
}

/** A different address inside 2001:db8:1:2::/64 for each i, written the way CF-Connecting-IP would. */
const inAttackerNet = (i) => `2001:db8:1:2:${(i >> 16 & 0xffff).toString(16)}:${(i & 0xffff).toString(16)}:${crypto.randomBytes(2).toString("hex")}:1`
const freshVisitor = () => `v1.1790467200.${crypto.randomBytes(8).toString("hex")}`

// ---------------------------------------------------------------- the /64 key

test("ipSource keys an IPv6 address by its /64 however it is written, IPv4 as is", () => {
  const { ipSource } = load("lib/tracking/server/rate-limit.ts")
  for (const ip of ["2001:db8:1:2::1", "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff", "2001:db8:1:2:0:0:0:0", "2001:db8:1:2::", "2001:db8:1:2:a::192.0.2.1"]) {
    assert.equal(ipSource(ip), "2001:db8:1:2::/64", ip)
  }
  assert.equal(ipSource("2001:db8:1:3::1"), "2001:db8:1:3::/64", "the next /64 is another source")
  assert.equal(ipSource("2001:db8::1"), "2001:db8:0:0::/64")
  assert.equal(ipSource("::1"), "0:0:0:0::/64")
  assert.equal(ipSource("64:ff9b::192.0.2.1"), "64:ff9b:0:0::/64", "an embedded IPv4 tail fills two groups")
  assert.equal(ipSource("203.0.113.7"), "203.0.113.7", "IPv4 stays one address (carrier NAT has its own higher ceiling)")
  assert.equal(ipSource("::ffff:203.0.113.7"), "203.0.113.7", "an IPv4-mapped address is its IPv4 address")
  assert.equal(ipSource("not an ip"), "not an ip")
})

// ---------------------------------------------------------------- rate limiter

/** The finding's run: 720 requests of 25 events in 60 s, a new _fl_vid each, the address from `ipFor(i)`. */
function run(limiter, clock, ipFor) {
  let granted = 0
  for (let i = 0; i < 720; i += 1) {
    clock.now = i * (60_000 / 720)
    granted += limiter.take(freshVisitor(), ipFor(i), 25)
  }
  return granted
}

test("rotating addresses inside one /64 with a fresh visitor id each time gets no more than one address's budget", () => {
  const { createRateLimiter, IP_LIMIT } = load("lib/tracking/server/rate-limit.ts")
  const ceiling = IP_LIMIT.burst + IP_LIMIT.perMinute // the burst plus a minute of refill

  const fixedClock = { now: 0 }
  const fixed = run(createRateLimiter({ now: () => fixedClock.now }), fixedClock, () => "2001:db8:1:2::1")
  assert.ok(fixed <= ceiling, `one fixed address: ${fixed}`)

  const clock = { now: 0 }
  const limiter = createRateLimiter({ now: () => clock.now })
  const rotating = run(limiter, clock, inAttackerNet)
  assert.ok(rotating <= ceiling, `rotating inside the /64: ${rotating} (18,000 before the fix)`)
  assert.equal(rotating, fixed, "rotating gains nothing over one fixed address")

  // Other sources still get their own budget at the same moment.
  assert.equal(limiter.take(freshVisitor(), "2001:db8:1:3::1", 25), 25, "the neighbouring /64")
  assert.equal(limiter.take(freshVisitor(), "203.0.113.7", 25), 25, "an IPv4 shopper")
  assert.equal(limiter.take(freshVisitor(), inAttackerNet(9999), 25), 0, "the attacker's /64 is still empty")
})

// ---------------------------------------------------------------- forwarder fair share

test("fairShare is max-min water-filling over what each source offered", () => {
  const { fairShare, FAIR_SHARE, FORWARD_LIMITS } = load("lib/tracking/server/forward.ts")
  assert.deepEqual(plain(FAIR_SHARE), { reserveEvents: 300, minEvents: 25, maxSources: 10000 })
  assert.equal(FORWARD_LIMITS.capEvents, 3000, "the overall cap is unchanged")
  const budget = FORWARD_LIMITS.capEvents - FAIR_SHARE.reserveEvents
  const share = (offered) => fairShare(offered, budget, FAIR_SHARE.minEvents)
  assert.equal(share([]), Infinity)
  assert.equal(share([1200, 800, 5]), Infinity, "everything fits: no share")
  assert.equal(share([3500, 25, 25, 25]), 2625, "light sources keep all they offered")
  assert.equal(share([...Array(15).fill(1200), ...Array(50).fill(5)]), 163, "15 heavy sources split what is left")
  assert.equal(share(Array(4).fill(1000)), 675)
  assert.equal(share(Array(5000).fill(10)), 25, "never below one full batch")
})

function fakeClock(start = 1790467200000) {
  let now = start
  const timers = []
  return {
    now: () => now,
    setTimer(callback, ms) {
      const timer = { callback, at: now + ms, done: false }
      timers.push(timer)
      return timer
    },
    clearTimer(timer) { if (timer) timer.done = true },
    async advance(ms) {
      now += ms
      for (const timer of timers.filter((entry) => !entry.done && entry.at <= now)) {
        timer.done = true
        timer.callback()
      }
      await settle()
    },
  }
}

const CTX = {
  ip: "203.0.113.7", ua: "Mozilla/5.0", vid: "v1.1790467200.0123456789abcdef", sid: "s1.1790467200.01234567",
  src: "meta_paid", camp: null, fbp: null, fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null,
  wbraid: null, country: "BD", device: "mobile", audience: "women", new: false, staff: false,
}
let seq = 0
const pageView = () => ({ n: "PageView", id: crypto.randomUUID(), t: 1790467200000 + (seq += 1), p: "/shop/" })
const events = (n) => Array.from({ length: n }, pageView)

function forwarder() {
  const clock = fakeClock()
  const posts = []
  let dropped = 0
  const { createForwarder, FAIR_SHARE } = load("lib/tracking/server/forward.ts")
  const { ipSource } = load("lib/tracking/server/rate-limit.ts")
  const instance = createForwarder({
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      posts.push(body)
      dropped += body.stats["sf.cap_dropped"] ?? 0
      return { ok: true, status: 202 }
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    endpoint: () => "https://api.test/tracking/ingest",
    key: () => "k".repeat(64),
  })
  /** Events forwarded per source (ipSource of ctx.ip), then cleared. */
  const take = () => {
    const out = {}
    for (const post of posts.splice(0)) {
      for (const batch of post.batches) {
        const source = batch.ctx.ip ? ipSource(batch.ctx.ip) : "-"
        out[source] = (out[source] ?? 0) + batch.events.length
      }
    }
    return out
  }
  /** Sends what is queued and lets every in-flight post land. */
  const drain = async () => {
    await instance.flush()
    await settle()
  }
  return { instance, clock, take, drain, ipSource, dropped: () => dropped, FAIR_SHARE }
}

test("a /64 rotating its addresses is held to one fair share and every shopper still gets through", async () => {
  const { instance, clock, take, drain, ipSource } = forwarder()
  const ATTACKER = "2001:db8:1:2::/64"
  const shoppers = ["198.51.100.20", "198.51.100.21", "2001:db8:9:9::5"]
  const perWindow = []
  for (let window = 0; window < 4; window += 1) {
    const got = {}
    for (let second = 0; second < 10; second += 1) {
      // Worst case for the shoppers: the attacker's 14 batches of 25 arrive first every second.
      for (let batch = 0; batch < 14; batch += 1) {
        instance.forwardEvents("new.florayn.com", { ...CTX, ip: inAttackerNet(window * 1000 + second * 20 + batch), vid: freshVisitor() }, events(25))
      }
      if (second % 2 === 0) {
        for (const ip of shoppers) instance.forwardEvents("new.florayn.com", { ...CTX, ip }, events(5))
      }
      await clock.advance(1000)
      await drain()
      for (const [source, n] of Object.entries(take())) got[source] = (got[source] ?? 0) + n
    }
    perWindow.push(got)
  }

  // The first window after a quiet spell is first come, first served: the /64
  // fills the cap and the shoppers lose their last events (in production the
  // rate limiter already holds one /64 to 1,200 plus 200 a window).
  assert.equal(Object.values(perWindow[0]).reduce((sum, n) => sum + n, 0), 3000)
  for (const ip of shoppers) assert.ok(perWindow[0][ipSource(ip)] < 25, `${ip} lost events in the first window`)
  // From then on the last window's demand sets the share: 3,500 from the /64
  // and 25 from each shopper give the /64 at most 2,700 - 75 = 2,625.
  for (const got of perWindow.slice(1)) {
    const total = Object.values(got).reduce((sum, n) => sum + n, 0)
    assert.ok(total <= 3000, `the overall cap holds: ${total}`)
    assert.ok(got[ATTACKER] <= 2625, `the /64 gets one share: ${got[ATTACKER]}`)
    for (const ip of shoppers) assert.equal(got[ipSource(ip)], 25, `${ip} gets every event through`)
  }
})

test("many heavy sources split the cap and light ones are never starved; drops are counted", async () => {
  const { instance, clock, take, drain, dropped } = forwarder()
  const heavy = Array.from({ length: 15 }, (_, i) => `192.0.2.${i + 1}`)
  const shopper = "198.51.100.7"
  const perWindow = []
  for (let window = 0; window < 3; window += 1) {
    const got = {}
    for (let second = 0; second < 10; second += 1) {
      // 15 IPv4 addresses at 25 events a second each (3,750 per window), before the shopper.
      for (const ip of heavy) instance.forwardEvents("new.florayn.com", { ...CTX, ip, vid: freshVisitor() }, events(25))
      instance.forwardEvents("new.florayn.com", { ...CTX, ip: shopper }, events(3))
      await clock.advance(1000)
      await drain()
      for (const [source, n] of Object.entries(take())) got[source] = (got[source] ?? 0) + n
    }
    perWindow.push(got)
  }
  for (const got of perWindow.slice(1)) {
    assert.equal(got[shopper], 30, "the shopper's events all go")
    for (const ip of heavy) assert.ok(got[ip] <= 178, `${ip}: ${got[ip]}`) // floor((2,700 - 30) / 15)
  }
  const sent = perWindow.reduce((sum, got) => sum + Object.values(got).reduce((n, m) => n + m, 0), 0)
  assert.equal(sent + dropped(), 3 * (15 * 250 + 30), "every event is either forwarded or counted in sf.cap_dropped")
})

test("the share lapses after a quiet window; a flood of distinct sources keeps the cap and a batch per source", async () => {
  const { instance, clock, take, drain, FAIR_SHARE } = forwarder()
  const BUSY = "2001:db8:1:2::/64"
  instance.forwardEvents("new.florayn.com", { ...CTX, ip: "2001:db8:1:2::1" }, events(2900))
  instance.forwardEvents("new.florayn.com", { ...CTX, ip: "198.51.100.1" }, events(100))
  await drain()
  take()
  await clock.advance(10_000)
  // The next window: from 2,900 + 100 offered, the busy /64's share is 2,700 - 100.
  instance.forwardEvents("new.florayn.com", { ...CTX, ip: "2001:db8:1:2::99" }, events(2900))
  await drain()
  assert.equal(take()[BUSY], 2600)
  // After a whole quiet window the share is gone again.
  await clock.advance(20_000)
  instance.forwardEvents("new.florayn.com", { ...CTX, ip: "2001:db8:1:2::1" }, events(2900))
  await drain()
  assert.equal(take()[BUSY], 2900)

  // More distinct sources than maxSources, one event each: the cap still holds.
  await clock.advance(20_000)
  for (let i = 0; i < FAIR_SHARE.maxSources + 50; i += 1) {
    instance.forwardEvents("new.florayn.com", { ...CTX, ip: `2001:db8:${(i >> 16).toString(16)}:${(i & 0xffff).toString(16)}::1` }, events(1))
  }
  await drain()
  assert.equal(Object.values(take()).reduce((sum, n) => sum + n, 0), 3000)
  // The next window's share would be under one event; it stays one full batch.
  await clock.advance(10_000)
  instance.forwardEvents("new.florayn.com", { ...CTX, ip: "198.51.100.30" }, events(40))
  await drain()
  assert.equal(take()["198.51.100.30"], 25)
})
