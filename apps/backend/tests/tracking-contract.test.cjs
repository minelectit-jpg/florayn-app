const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, Buffer, URL, URLSearchParams, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const vectors = require("./fixtures/tracking-vectors.json")
const contract = load("lib/tracking/contract.ts")
const loadSecret = (env = {}) => load("lib/tracking/secret.ts", { "node:crypto": crypto }, { process: { env } })
const SECRET = vectors.keys.secret

test("the fixture is the Appendix C block of TRACKING.md, byte for byte", () => {
  // Line endings are normalised: a Windows checkout (core.autocrlf) rewrites both files.
  const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8").replace(/\r\n/g, "\n")
  const doc = read("../../../TRACKING.md")
  const appendix = doc.indexOf("## Appendix C")
  assert.ok(appendix > 0, "TRACKING.md has Appendix C")
  const start = doc.indexOf("```json\n", appendix) + "```json\n".length
  const block = doc.slice(start, doc.indexOf("\n```", start) + 1)
  assert.equal(read("fixtures/tracking-vectors.json"), block)
})

test("isPrivatePath equals every private_paths vector", () => {
  for (const [pathname, expected] of vectors.private_paths) {
    assert.equal(contract.isPrivatePath(pathname), expected, pathname)
  }
  assert.equal(contract.isPrivatePath("/order/x/?a=1#b"), true)
})

test("safePath equals every safe_path vector and is idempotent", () => {
  for (const [pathname, search, expected] of vectors.safe_path) {
    const result = contract.safePath(pathname, search)
    assert.equal(result, expected, `${pathname}${search}`)
    const at = result.indexOf("?")
    assert.equal(contract.safePath(at < 0 ? result : result.slice(0, at), at < 0 ? "" : result.slice(at)), result)
  }
  assert.equal(contract.safePath("/p/", `?case=${"x".repeat(81)}&device=a`), "/p/?device=a", "an over-long value is left out")
  const long = `/${"a".repeat(280)}/`
  assert.equal(contract.safePath(long, "?case=signature&device=iPhone+17"), long.slice(0, 300))
})

test("landingParams equals every landing_params vector", () => {
  for (const [search, expected] of vectors.landing_params) {
    assert.deepEqual(plain(contract.landingParams(search)), expected, search)
  }
  assert.deepEqual(plain(contract.landingParams(`?ttclid=${"x".repeat(1001)}&gclid=ok`)), { gclid: "ok" }, "a click id is never cut")
})

test("isBrowserEventId equals every event_ids vector; isVariantId", () => {
  for (const [name, id, expected] of vectors.event_ids) {
    assert.equal(contract.isBrowserEventId(name, id), expected, `${name} ${id}`)
  }
  assert.equal(contract.isVariantId("variant_01K6EXAMPLEVARIANT01"), true)
  assert.equal(contract.isVariantId("variant_short"), false)
  assert.equal(contract.isVariantId("prod_01ABCDEFGHIJ"), false)
  assert.equal(contract.isVariantId(5), false)
  assert.deepEqual(plain(contract.BROWSER_EVENTS), ["PageView", "ViewContent", "AddToCart", "InitiateCheckout"])
})

test("validateEvent equals every events vector and drops unknown d keys", () => {
  for (const vector of vectors.events) {
    const result = contract.validateEvent(vector.e)
    assert.equal(result !== null, vector.ok, vector.why ?? vector.e.n)
    if (vector.ok) assert.deepEqual(plain(result), vector.e)
  }
  const base = vectors.events[1].e
  const extra = plain(contract.validateEvent({ ...base, extra: 1, d: { ...base.d, email: "x@y.z", phone: "017", first: true } }))
  assert.deepEqual(extra, base, "unknown keys are dropped, not fatal")
  assert.equal(contract.validateEvent({ ...base, d: { ...base.d, handle: "x".repeat(121) } }), null)
  assert.equal(contract.validateEvent({ ...base, t: 1.5 }), null)
  assert.equal(contract.validateEvent({ ...base, p: "//evil.example/" }), null)
  assert.equal(contract.validateEvent({ ...base, p: "/men/account/" }), null)
  assert.equal(contract.validateEvent({ ...base, d: { ...base.d, items: new Array(51).fill(base.d.items[0]) } }), null)
  assert.equal(contract.validateEvent(null), null)
  assert.equal(contract.validateEvent([]), null)
})

test("derived keys equal the keys vectors with the test secret", () => {
  const secret = loadSecret({ TRACKING_INGEST_SECRET: SECRET })
  assert.equal(secret.ingestSecret(), SECRET)
  assert.equal(secret.derivedIngestKey(SECRET), vectors.keys.ingest)
  assert.equal(secret.staffLinkToken(), vectors.keys.staff_link)
  assert.equal(secret.hmacHex(SECRET, "staff-cookie-v1"), vectors.keys.staff_cookie)
  assert.equal(`ic-${secret.hmacHex(SECRET, `ic-v1:${vectors.keys.ic.cart_id}`).slice(0, 24)}`, vectors.keys.ic.id)
})

test("verifyIngestKey fails closed, accepts the previous secret and never throws", () => {
  const good = vectors.keys.ingest
  assert.equal(loadSecret({}).verifyIngestKey(good), false, "unset secret")
  assert.equal(loadSecret({ TRACKING_INGEST_SECRET: SECRET.slice(0, 31) }).verifyIngestKey(
    loadSecret().derivedIngestKey(SECRET.slice(0, 31))), false, "short secret")
  assert.equal(loadSecret({ TRACKING_INGEST_SECRET: SECRET.slice(0, 31) }).staffLinkToken(), null)
  const current = loadSecret({ TRACKING_INGEST_SECRET: SECRET })
  assert.equal(current.verifyIngestKey(good), true)
  assert.equal(current.verifyIngestKey(good.replace(/.$/, (c) => c === "0" ? "1" : "0")), false, "wrong key")
  for (const header of [good.slice(1), `${good}0`, "", undefined, null, 5, [good], { key: good }, "ü".repeat(64)]) {
    assert.doesNotThrow(() => current.verifyIngestKey(header))
    assert.equal(current.verifyIngestKey(header), false, String(header))
  }
  const rotating = loadSecret({ TRACKING_INGEST_SECRET: "f".repeat(40), TRACKING_INGEST_SECRET_PREVIOUS: SECRET })
  assert.equal(rotating.verifyIngestKey(good), true, "previous secret accepted while rotating")
  assert.equal(rotating.verifyIngestKey(rotating.derivedIngestKey("f".repeat(40))), true)
  const previousOnly = loadSecret({ TRACKING_INGEST_SECRET_PREVIOUS: SECRET })
  assert.equal(previousOnly.verifyIngestKey(good), false, "no current secret: nothing verifies")
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/tracking/secret.ts"), "utf8")
  assert.ok(source.includes("timingSafeEqual"))
  assert.equal(/console\./.test(source), false)
})

const CONTEXT = {
  v: 1, host: "new.florayn.com", page_url: "https://new.florayn.com/checkout/", edge: true,
  ip: "103.4.145.2", ua: "Mozilla/5.0", vid: "v1.1790467200.0123456789abcdef", sid: "s1.1790467200.01234567",
  src: "meta_paid", camp: "sept-sale", fbp: "fb.1.1790467200000.123", fbc: "fb.1.1790467200000.AbC",
  ttp: null, ttclid: null, gclid: null, gbraid: null, wbraid: null, country: "BD", device: "mobile",
  audience: "women", new: true, staff: false, optout: false, consent_version: 1,
}

test("parseCheckoutContext keeps the 4.4 keys within their caps and drops unknown keys", () => {
  assert.deepEqual(plain(contract.parseCheckoutContext({ ...CONTEXT, name: "Md Shamim", phone: "01712345678" })), CONTEXT)
  const caps = { host: 100, page_url: 200, ip: 45, ua: 400, vid: 40, sid: 40, src: 40, camp: 80, fbp: 120, fbc: 600,
    ttp: 100, ttclid: 1000, gclid: 300, gbraid: 300, wbraid: 300 }
  assert.deepEqual(plain(contract.CONTEXT_CAPS), caps)
  for (const [key, max] of Object.entries(caps)) {
    const fill = key === "ip" ? "1" : "a"
    assert.equal(contract.parseCheckoutContext({ ...CONTEXT, [key]: fill.repeat(max) })[key], fill.repeat(max), `${key} at cap`)
    assert.equal(contract.parseCheckoutContext({ ...CONTEXT, [key]: fill.repeat(max + 1) })[key], null, `${key} over cap`)
  }
  const odd = contract.parseCheckoutContext({
    host: "NEW.florayn.com", ip: "not an ip", ua: "bad\u0000ua", country: "bd", device: "phone", audience: "kids",
    edge: "true", new: 1, staff: "yes", optout: null, consent_version: 0, fbp: 5,
  })
  assert.deepEqual(plain(odd), {
    v: 1, host: "new.florayn.com", page_url: null, edge: false, ip: null, ua: null, vid: null, sid: null, src: null,
    camp: null, fbp: null, fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null, wbraid: null, country: null,
    device: null, audience: null, new: false, staff: false, optout: false, consent_version: null,
  })
  assert.equal(contract.parseCheckoutContext({ ...CONTEXT, country: "XX" }).country, "XX")
  assert.equal(contract.parseCheckoutContext({ ...CONTEXT, ip: "2001:db8::1" }).ip, "2001:db8::1")
  for (const raw of [null, undefined, "x", 5, [], { v: 2 }]) assert.equal(contract.parseCheckoutContext(raw), null, JSON.stringify(raw))
})

function envelope(counts) {
  const event = vectors.events[1].e
  return {
    v: 1,
    stats: { "sf.untrusted": 3, "sf.rate_dropped": 0 },
    batches: counts.map((count, index) => ({
      host: index ? "NEW.florayn.com" : "new.florayn.com",
      ctx: { ...CONTEXT, v: undefined, page_url: undefined, extra: "dropped" },
      events: new Array(count).fill(event),
    })),
  }
}

test("parseIngestEnvelope checks the 4.3 shape and caps a request at 200 events", () => {
  const parsed = contract.parseIngestEnvelope(envelope([150, 50]))
  assert.ok(parsed)
  assert.equal(parsed.batches.length, 2)
  assert.equal(parsed.batches[1].host, "new.florayn.com")
  assert.deepEqual(plain(parsed.stats), { "sf.untrusted": 3, "sf.rate_dropped": 0 })
  assert.equal(parsed.batches[0].ctx.extra, undefined)
  assert.equal(parsed.batches[0].ctx.vid, CONTEXT.vid)
  assert.equal(parsed.batches[0].events.length, 150)
  assert.equal(contract.parseIngestEnvelope(envelope([150, 51])), null, "201 events")
  assert.equal(contract.parseIngestEnvelope(envelope([201])), null)
  assert.ok(contract.parseIngestEnvelope({ v: 1, stats: { "sf.cap_dropped": 7 }, batches: [] }), "stats-only envelope")
  assert.ok(contract.parseIngestEnvelope({ v: 1, batches: [] }))
  const bad = [
    null, [], { v: 2, batches: [] }, { v: 1 }, { v: 1, batches: {} },
    { v: 1, stats: { "sf.untrusted": "3" }, batches: [] }, { v: 1, stats: { "sf.untrusted": -1 }, batches: [] },
    { v: 1, stats: { "sf.untrusted": 1.5 }, batches: [] }, { v: 1, stats: [], batches: [] },
    { v: 1, stats: { "Bad Key!": 1 }, batches: [] },
    { v: 1, batches: [{ host: "new.florayn.com", ctx: CONTEXT }] },
    { v: 1, batches: [{ ctx: CONTEXT, events: [] }] },
    { v: 1, batches: [{ host: "new.florayn.com", ctx: null, events: [] }] },
    { v: 1, batches: [{ host: "x".repeat(101), ctx: CONTEXT, events: [] }] },
    { v: 1, batches: ["batch"] },
  ]
  for (const raw of bad) assert.equal(contract.parseIngestEnvelope(raw), null, JSON.stringify(raw)?.slice(0, 80))
  // Events stay raw for validateEvent, which counts the invalid ones.
  const raw = contract.parseIngestEnvelope({ v: 1, batches: [{ host: "new.florayn.com", ctx: {}, events: [{ n: "Purchase" }] }] })
  assert.deepEqual(plain(raw.batches[0].events), [{ n: "Purchase" }])
})

test("contract.ts is pure: no runtime imports", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/tracking/contract.ts"), "utf8")
  assert.equal(/^import (?!type )/m.test(source), false)
  assert.equal(/require\(/.test(source), false)
})
