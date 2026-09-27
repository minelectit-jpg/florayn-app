const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// The /api/t/* route handlers (TRACKING.md 4.2) with the real server helpers
// and stubbed next/server (after), capi-param-builder-nodejs, lib/medusa and
// the forwarder: origin and size checks, bots, the inert answers without the
// edge header, the cookie table, the event batch pipeline and the staff and
// opt-out links.
const root = path.join(__dirname, "..")
const src = path.join(root, "src")
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/tracking-vectors.json"), "utf8"))
const SECRET = vectors.keys.secret
const EDGE = "e".repeat(40)
const TEST_HOST = "new.florayn.com"
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate) }

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

const srcKey = (file) => path.relative(src, file).replace(/\\/g, "/").replace(/\.tsx?$/, "")

function resolveImport(from, spec) {
  let base
  if (spec.startsWith("@/")) base = path.join(src, spec.slice(2))
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(candidate)) return candidate
  return null
}

/** One vm context per scenario; stubs keyed by package name or src path. */
function createLoader({ env, stubs, globals }) {
  const context = vm.createContext({
    console, Buffer, URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Request, Response, AbortSignal,
    setTimeout, clearTimeout, process: { env }, ...globals,
  })
  const cache = new Map()
  function load(file) {
    const key = srcKey(file)
    if (key in stubs) return stubs[key]
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const localRequire = (spec) => {
      if (spec in stubs) return stubs[spec]
      if (spec.startsWith("node:")) return require(spec)
      const target = resolveImport(file, spec)
      if (!target) throw new Error(`Unexpected import ${spec} in ${key}`)
      return load(target)
    }
    vm.runInContext(`(function (exports, require, module) {${compile(file)}\n})`, context, { filename: file })(module.exports, localRequire, module)
    return module.exports
  }
  return (relative) => load(path.join(src, relative))
}

class FakePlainDataObject {
  constructor(host, query_params, cookies, referer, x_forwarded_for, remote_address, scheme = null, request_uri = null) {
    Object.assign(this, { host, query_params, cookies, referer, x_forwarded_for, remote_address, scheme, request_uri })
  }
}

const BASE_CONFIG = {
  test_hosts: ["new.florayn.com"], live_hosts: ["florayn.com", "www.florayn.com"], live_armed: false,
  meta: { enabled: true, test_id: "2247389409441720", live_id: "650439547920083", browser: "all", aam_off_confirmed: { test: true, live: false } },
  tiktok: { enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only", spa_off_confirmed: false },
  google: { enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D", browser: "ads_only" },
  privacy: { share: false, consent_version: 2, consent_text: "" },
}
const LIVE_CONFIG = {
  ...BASE_CONFIG,
  live_armed: true,
  meta: { ...BASE_CONFIG.meta, aam_off_confirmed: { test: true, live: true } },
  tiktok: { ...BASE_CONFIG.tiktok, enabled: true, spa_off_confirmed: true },
  google: { ...BASE_CONFIG.google, enabled: true },
}

const responses = []

function scenario({ env = {}, config = BASE_CONFIG } = {}) {
  const forwarded = []
  const stats = {}
  const afterQueue = []
  const builderCalls = []
  class FakeParamBuilder {
    constructor(domains) { this.domains = domains }
    processRequestFromContext(data) {
      builderCalls.push({ domains: this.domains, data, isPlainDataObject: data instanceof FakePlainDataObject })
      const out = [{ name: "_fbi", value: "203.0.113.7.AQYBAQIA", maxAge: 1, domain: "x" }, { name: "_other", value: "x", maxAge: 1, domain: "x" }]
      if (!data.cookies._fbp) out.push({ name: "_fbp", value: "fb.2.1790467200000.123456789.AQYBAQIA", maxAge: 1, domain: "x" })
      if (data.query_params.fbclid) out.push({ name: "_fbc", value: `fb.2.1790467200000.${data.query_params.fbclid}.AQYBAQIA`, maxAge: 1, domain: "x" })
      return out
    }
  }
  const load = createLoader({
    env: { NODE_ENV: "production", TRACKING_INGEST_SECRET: SECRET, TRACKING_EDGE_SECRET: EDGE, ...env },
    stubs: {
      "next/server": { after: (callback) => afterQueue.push(callback), NextResponse: Response },
      "capi-param-builder-nodejs": { ParamBuilder: FakeParamBuilder, PlainDataObject: FakePlainDataObject },
      "lib/medusa": { MEDUSA_BACKEND_URL: "https://api.test", MEDUSA_PUBLISHABLE_KEY: "pk_test" },
      "lib/tracking/server/forward": {
        forwardEvents: async (host, ctx, events) => { forwarded.push(plain({ host, ctx, events })) },
        bumpStat: (key, n = 1) => { stats[key] = (stats[key] ?? 0) + n },
      },
    },
    globals: { fetch: async () => ({ ok: true, json: async () => ({ config }) }) },
  })
  const wrap = (route) => {
    const out = {}
    for (const [name, value] of Object.entries(route)) {
      out[name] = typeof value === "function"
        ? async (...args) => { const res = await value(...args); responses.push(res); return res }
        : value
    }
    return out
  }
  return {
    id: wrap(load("app/api/t/id/route.ts")),
    e: wrap(load("app/api/t/e/route.ts")),
    staff: wrap(load("app/api/t/staff/route.ts")),
    optout: wrap(load("app/api/t/optout/route.ts")),
    forwarded, stats, afterQueue, builderCalls,
    async runAfter() {
      const callbacks = afterQueue.splice(0)
      for (const callback of callbacks) await callback()
      await settle()
    },
  }
}

function request(pathname, { method = "POST", host = TEST_HOST, body, type = "application/json", edge = EDGE, cookies = {}, headers = {} } = {}) {
  const all = {
    host, origin: `https://${host}`, "sec-fetch-site": "same-origin", "user-agent": UA,
    "cf-connecting-ip": "203.0.113.7", "cf-ipcountry": "BD",
  }
  if (edge) all["x-florayn-edge"] = edge
  if (method === "POST" && type) all["content-type"] = type
  const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ")
  if (cookieHeader) all.cookie = cookieHeader
  Object.assign(all, headers)
  for (const name of Object.keys(all)) if (all[name] === undefined) delete all[name]
  const payload = method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body ?? {})) : undefined
  return new Request(`https://${host}${pathname}`, { method, headers: all, body: payload })
}

/** Set-Cookie values as { name, value, attrs } with lower-case attribute names. */
function setCookies(res) {
  return res.headers.getSetCookie().map((line) => {
    const [pair, ...rest] = line.split("; ")
    const at = pair.indexOf("=")
    const attrs = {}
    for (const part of rest) {
      const [key, ...value] = part.split("=")
      attrs[key.toLowerCase()] = value.length ? value.join("=") : true
    }
    return { name: pair.slice(0, at), value: pair.slice(at + 1), attrs, line }
  })
}
const byName = (cookies) => Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie]))

const landing = (q = {}, extra = {}) => ({ v: 1, landing: { q, ref: null, path: "/product/x/", ...extra } })
const uuid = () => crypto.randomUUID()
const pageView = (p = "/shop/", t = Date.now()) => ({ n: "PageView", id: uuid(), t, p })
const batch = (events, sentAt = Date.now()) => ({ v: 1, rv: "fl-runtime-v1", sent_at: sentAt, events })
const VID = "v1.1790467200.0123456789abcdef"
const SID = "s1.1790467200.01234567"
const SRC = Buffer.from(JSON.stringify({ s: "meta_paid", c: "sept-sale", k: "0123abcd" })).toString("base64url")
const VISITOR = { _fl_vid: VID, _fl_sid: SID, _fl_src: SRC }

// ---------------------------------------------------------------- shape

test("every route is force-dynamic and no middleware is added (next.config.ts only adds the private pages' Referrer-Policy, see private-referrer.test.cjs)", () => {
  const s = scenario()
  assert.equal(s.id.dynamic, "force-dynamic")
  assert.equal(s.e.dynamic, "force-dynamic")
  assert.equal(s.staff.dynamic, "force-dynamic")
  assert.equal(s.optout.dynamic, "force-dynamic")
  assert.equal(typeof s.id.POST, "function")
  assert.equal(typeof s.e.POST, "function")
  assert.equal(typeof s.staff.GET, "function")
  assert.equal(typeof s.optout.GET, "function")
  for (const file of ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file)
  }
})

// ---------------------------------------------------------------- guards before anything else

test("a wrong Origin with a cross-site sec-fetch-site gives 403 and no Set-Cookie", async () => {
  const s = scenario()
  const hostile = { origin: "https://evil.example", "sec-fetch-site": "cross-site" }
  for (const [route, path] of [[s.id, "/api/t/id/"], [s.e, "/api/t/e/"]]) {
    const res = await route.POST(request(path, { headers: hostile, body: landing(), cookies: VISITOR }))
    assert.equal(res.status, 403, path)
    assert.deepEqual(res.headers.getSetCookie(), [])
    const bare = await route.POST(request(path, { headers: { origin: undefined, "sec-fetch-site": undefined }, body: landing() }))
    assert.equal(bare.status, 403, "neither Origin nor sec-fetch-site")
  }
  const originOnly = await s.id.POST(request("/api/t/id/", { headers: { "sec-fetch-site": undefined }, body: landing() }))
  assert.equal(originOnly.status, 200, "the right Origin alone is enough")
  const fetchSiteOnly = await s.id.POST(request("/api/t/id/", { headers: { origin: undefined }, body: landing() }))
  assert.equal(fetchSiteOnly.status, 200, "same-origin sec-fetch-site alone is enough")
  const http = await s.id.POST(request("/api/t/id/", { headers: { origin: `http://${TEST_HOST}`, "sec-fetch-site": undefined }, body: landing() }))
  assert.equal(http.status, 403, "http:// only with the dev escape")
  assert.deepEqual(s.afterQueue, [])
})

test("bots get 204 without cookies", async () => {
  const s = scenario()
  for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "facebookexternalhit/1.1", "Mozilla/5.0 HeadlessChrome/120", "florayn-warm", "curl/8.0", ""]) {
    const res = await s.id.POST(request("/api/t/id/", { headers: { "user-agent": ua }, body: landing({ fbclid: "x" }) }))
    assert.equal(res.status, 204, ua)
    assert.deepEqual(res.headers.getSetCookie(), [])
    const events = await s.e.POST(request("/api/t/e/", { headers: { "user-agent": ua }, cookies: VISITOR, body: batch([pageView()]) }))
    assert.equal(events.status, 204)
    assert.deepEqual(events.headers.getSetCookie(), [])
  }
  assert.equal(s.stats["sf.bot"], 12)
  assert.deepEqual(s.afterQueue, [])
  assert.equal(s.builderCalls.length, 0)
})

test("bodies over 2 KB (id) and 64 KB (e) give 413; other content types 415", async () => {
  const s = scenario()
  const big = JSON.stringify({ v: 1, landing: { q: {}, ref: null, path: `/${"x".repeat(2100)}` } })
  assert.equal((await s.id.POST(request("/api/t/id/", { body: big }))).status, 413)
  assert.equal((await s.id.POST(request("/api/t/id/", { body: landing(), headers: { "content-length": "5000" } }))).status, 413,
    "a declared length is refused before reading")
  const exact = JSON.stringify({ v: 1, landing: null, pad: "x".repeat(2048 - 31) })
  assert.equal(Buffer.byteLength(exact), 2048)
  assert.equal((await s.id.POST(request("/api/t/id/", { body: exact }))).status, 200, "exactly 2 KB is fine")
  const huge = JSON.stringify(batch(Array.from({ length: 25 }, () => ({ ...pageView(), pad: "y".repeat(2700) }))))
  assert.ok(Buffer.byteLength(huge) > 64 * 1024)
  assert.equal((await s.e.POST(request("/api/t/e/", { body: huge, cookies: VISITOR }))).status, 413)
  assert.equal((await s.id.POST(request("/api/t/id/", { body: landing(), type: "application/x-www-form-urlencoded" }))).status, 415)
  assert.equal((await s.e.POST(request("/api/t/e/", { body: batch([pageView()]), type: "application/octet-stream", cookies: VISITOR }))).status, 415)
  assert.equal((await s.e.POST(request("/api/t/e/", { body: batch([pageView()]), type: "text/plain;charset=UTF-8", cookies: VISITOR }))).status, 204,
    "sendBeacon's text/plain is accepted")
  assert.equal((await s.id.POST(request("/api/t/id/", { body: "{not json" }))).status, 400)
})

// ---------------------------------------------------------------- inert

test("without a valid x-florayn-edge header /api/t/id/ answers on:false with no Set-Cookie and /api/t/e/ forwards nothing", async () => {
  for (const edge of [null, "f".repeat(40), EDGE.slice(1)]) {
    const s = scenario()
    const res = await s.id.POST(request("/api/t/id/", { edge, body: landing({ fbclid: "IwAR0abc", gclid: "G" }) }))
    assert.equal(res.status, 200)
    assert.deepEqual(res.headers.getSetCookie(), [])
    assert.deepEqual(await res.json(), {
      v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false, optout: false, share: false,
      consent_version: 2, landing: null, meta: null, tiktok: null, google: null,
    })
    const events = await s.e.POST(request("/api/t/e/", { edge, cookies: VISITOR, body: batch([pageView()]) }))
    assert.equal(events.status, 204)
    assert.deepEqual(events.headers.getSetCookie(), [])
    await s.runAfter()
    assert.deepEqual(s.forwarded, [])
    assert.equal(s.stats["sf.untrusted"], 2)
    assert.equal(s.builderCalls.length, 0)
  }
  const unset = scenario({ env: { TRACKING_EDGE_SECRET: undefined } })
  const res = await unset.id.POST(request("/api/t/id/", { edge: "", body: landing() }))
  assert.equal((await res.json()).on, false, "no edge secret configured: inert")
  const short = scenario({ env: { TRACKING_EDGE_SECRET: "s".repeat(31) } })
  assert.equal((await (await short.id.POST(request("/api/t/id/", { edge: "s".repeat(31), body: landing() }))).json()).on, false)
})

test("an unknown host, a missing ingest secret and an opted-out browser are inert", async () => {
  const s = scenario()
  const unknown = await s.id.POST(request("/api/t/id/", { host: "evil.example", body: landing() }))
  assert.equal((await unknown.json()).on, false)
  assert.deepEqual(unknown.headers.getSetCookie(), [])
  const unknownEvents = await s.e.POST(request("/api/t/e/", { host: "evil.example", cookies: VISITOR, body: batch([pageView()]) }))
  assert.equal(unknownEvents.status, 204)
  assert.equal(s.stats["sf.unknown_host"], 2)

  const noSecret = scenario({ env: { TRACKING_INGEST_SECRET: undefined } })
  const off = await noSecret.id.POST(request("/api/t/id/", { body: landing() }))
  assert.equal((await off.json()).on, false)
  assert.deepEqual(off.headers.getSetCookie(), [])
  assert.equal((await noSecret.e.POST(request("/api/t/e/", { cookies: VISITOR, body: batch([pageView()]) }))).status, 204)
  await noSecret.runAfter()
  assert.deepEqual(noSecret.forwarded, [])

  const optedOut = await s.id.POST(request("/api/t/id/", { cookies: { ...VISITOR, _fl_optout: "1" }, body: landing({ fbclid: "x" }) }))
  const answer = await optedOut.json()
  assert.equal(answer.on, false)
  assert.equal(answer.optout, true)
  assert.deepEqual(optedOut.headers.getSetCookie(), [])
  const optedOutEvents = await s.e.POST(request("/api/t/e/", { cookies: { ...VISITOR, _fl_optout: "1" }, body: batch([pageView()]) }))
  assert.equal(optedOutEvents.status, 204)
  assert.deepEqual(optedOutEvents.headers.getSetCookie(), [])
  assert.deepEqual(s.afterQueue, [], "optout traffic is never forwarded")
})

// ---------------------------------------------------------------- /api/t/id/

test("a new visitor gets the cookie table on the test host (host-only) and the full IdResponse", async () => {
  const s = scenario()
  const body = landing({ fbclid: "IwAR0abc", utm_source: "facebook", utm_campaign: "sept", case: "signature" },
    { ref: "https://l.facebook.com/l.php?u=https%3A%2F%2Fnew.florayn.com%2F" })
  const res = await s.id.POST(request("/api/t/id/", { body }))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("content-type"), "application/json")
  const cookies = byName(setCookies(res))
  assert.deepEqual(Object.keys(cookies).sort(), ["_fbc", "_fbp", "_fl_sid", "_fl_src", "_fl_vid"], "never _fbi or other builder cookies")
  for (const cookie of Object.values(cookies)) {
    assert.equal(cookie.attrs.path, "/")
    assert.equal(cookie.attrs.secure, true)
    assert.equal(cookie.attrs.samesite, "Lax")
    assert.equal(cookie.attrs.domain, undefined, `${cookie.name} is host-only on new.florayn.com`)
  }
  assert.match(cookies._fl_vid.value, /^v1\.\d{10}\.[0-9a-f]{16}$/)
  assert.deepEqual([cookies._fl_vid.attrs["max-age"], cookies._fl_vid.attrs.httponly], ["34560000", true])
  assert.match(cookies._fl_sid.value, /^s1\.\d{10}\.[0-9a-f]{8}$/)
  assert.deepEqual([cookies._fl_sid.attrs["max-age"], cookies._fl_sid.attrs.httponly], ["1800", true])
  assert.deepEqual([cookies._fl_src.attrs["max-age"], cookies._fl_src.attrs.httponly], ["1800", true])
  assert.deepEqual(JSON.parse(Buffer.from(cookies._fl_src.value, "base64url").toString()),
    { s: "meta", c: "sept", k: crypto.createHash("sha256").update("IwAR0abc").digest("hex").slice(0, 8) })
  assert.deepEqual([cookies._fbp.attrs["max-age"], cookies._fbp.attrs.httponly], ["7776000", undefined])
  assert.equal(cookies._fbc.value, "fb.2.1790467200000.IwAR0abc.AQYBAQIA")
  assert.equal(cookies._fbc.attrs.httponly, undefined)

  const answer = await res.json()
  assert.deepEqual(answer, {
    v: 1, on: true, env: "test",
    ext: crypto.createHash("sha256").update(cookies._fl_vid.value).digest("hex"),
    sid: cookies._fl_sid.value, src: "meta", staff: false, optout: false, share: false, consent_version: 2,
    landing: { url: "https://new.florayn.com/product/x/?fbclid=IwAR0abc&utm_source=facebook&utm_campaign=sept", click: "fbclid", src: "meta" },
    meta: { id: "2247389409441720", load: true }, tiktok: null, google: null,
  })

  assert.equal(s.builderCalls.length, 1)
  const [call] = s.builderCalls
  assert.equal(call.isPlainDataObject, true, "ParamBuilder receives a PlainDataObject")
  assert.deepEqual(plain(call.domains), ["new.florayn.com"])
  assert.deepEqual(plain(call.data), {
    host: "new.florayn.com", query_params: { fbclid: "IwAR0abc", utm_source: "facebook", utm_campaign: "sept" }, cookies: {},
    referer: "https://l.facebook.com", x_forwarded_for: "203.0.113.7", remote_address: null, scheme: "https", request_uri: "/product/x/",
  })
})

test("a returning visitor keeps the ids; a new ad click starts a new session", async () => {
  const s = scenario()
  const kept = await s.id.POST(request("/api/t/id/", { cookies: { ...VISITOR, _fbp: "fb.2.1.2.AQYBAQIA" }, body: landing({ case: "x" }) }))
  const cookies = byName(setCookies(kept))
  assert.deepEqual(Object.keys(cookies).sort(), ["_fl_sid", "_fl_src"], "only the session slides; _fl_vid and _fbp are kept")
  assert.equal(cookies._fl_sid.value, SID)
  const answer = await kept.json()
  assert.equal(answer.sid, SID)
  assert.equal(answer.src, "meta_paid")
  assert.equal(answer.ext, crypto.createHash("sha256").update(VID).digest("hex"))
  assert.equal(answer.landing.click, null)
  assert.equal(answer.landing.src, "direct", "this landing on its own")

  const clicked = await s.id.POST(request("/api/t/id/", { cookies: VISITOR, body: landing({ fbclid: "IwAR0new" }) }))
  const rotated = byName(setCookies(clicked))
  assert.notEqual(rotated._fl_sid.value, SID)
  assert.equal((await clicked.json()).src, "meta")

  const privateLanding = await s.id.POST(request("/api/t/id/", { body: { v: 1, landing: { q: { fbclid: "x" }, ref: null, path: "/order/order_01ABC/" } } }))
  const privateAnswer = await privateLanding.json()
  assert.equal(privateAnswer.on, true)
  assert.equal(privateAnswer.landing, null, "a private landing is never recorded")
  assert.equal(byName(setCookies(privateLanding))._fbc, undefined)
})

test("live hosts share Domain=florayn.com and set the TikTok and Google click cookies", async () => {
  for (const host of ["florayn.com", "www.florayn.com"]) {
    const s = scenario({ config: LIVE_CONFIG })
    const res = await s.id.POST(request("/api/t/id/", { host, body: landing({ gclid: "Cj0KCQ_x-1", ttclid: "E.C.P.abc" }) }))
    const cookies = byName(setCookies(res))
    assert.deepEqual(Object.keys(cookies).sort(), ["_fbp", "_fl_gclid", "_fl_sid", "_fl_src", "_fl_vid", "_gcl_aw", "ttclid"])
    for (const cookie of Object.values(cookies)) assert.equal(cookie.attrs.domain, "florayn.com", `${cookie.name} on ${host}`)
    assert.equal(cookies.ttclid.value, "E.C.P.abc")
    assert.deepEqual([cookies.ttclid.attrs["max-age"], cookies.ttclid.attrs.httponly], ["7776000", undefined])
    const google = JSON.parse(Buffer.from(cookies._fl_gclid.value, "base64url").toString())
    assert.deepEqual([google.k, google.v], ["gclid", "Cj0KCQ_x-1"])
    assert.equal(cookies._fl_gclid.attrs.httponly, true)
    assert.match(cookies._gcl_aw.value, /^GCL\.\d{10}\.Cj0KCQ_x-1$/)
    assert.equal(cookies._gcl_aw.attrs.httponly, undefined)
    const answer = await res.json()
    assert.equal(answer.env, "live")
    assert.deepEqual(answer.meta, { id: "650439547920083", load: true })
    assert.deepEqual(answer.tiktok, { id: "D9ODDBJC77U97D5Q7MQG", load: true }, "ads_only, ttclid set now")
    assert.deepEqual(answer.google, { id: "AW-18147096523", label: "0p0wCKu2w70cEMvvms1D", load: true })
    assert.equal(answer.src, "tiktok_paid")
    assert.equal(answer.landing.click, "ttclid", "the first click key in CLICK_KEYS order")
    assert.deepEqual(plain(s.builderCalls[0].domains), ["florayn.com"])
  }
  const s = scenario({ config: LIVE_CONFIG })
  const res = await s.id.POST(request("/api/t/id/", { body: landing({ gbraid: "0AAAAA" }) }))
  const cookies = byName(setCookies(res))
  assert.equal(cookies._fl_gclid, undefined, "Google is live-only")
  assert.equal(cookies._gcl_aw, undefined)
  assert.equal(cookies.ttclid, undefined)
  const answer = await res.json()
  assert.deepEqual([answer.tiktok, answer.google], [null, null])

  const braid = await scenario({ config: LIVE_CONFIG }).id.POST(request("/api/t/id/", { host: "florayn.com", body: landing({ gbraid: "0AAAAA" }) }))
  const braidCookies = byName(setCookies(braid))
  assert.ok(braidCookies._fl_gclid)
  assert.equal(braidCookies._gcl_aw, undefined, "_gcl_aw is for a gclid only")

  const unsafe = await scenario({ config: LIVE_CONFIG }).id.POST(request("/api/t/id/", { host: "florayn.com", body: landing({ ttclid: "a;b=c" }) }))
  assert.equal(byName(setCookies(unsafe)).ttclid, undefined, "a click id that is not cookie-safe is never set")
})

test("a staff browser is tracked for the dashboard only: no vendor cookies, no pixels", async () => {
  const s = scenario({ config: LIVE_CONFIG })
  const res = await s.id.POST(request("/api/t/id/", { host: "florayn.com", cookies: { _fl_staff: vectors.keys.staff_cookie }, body: landing({ fbclid: "x", ttclid: "y" }) }))
  const answer = await res.json()
  assert.equal(answer.on, true)
  assert.equal(answer.staff, true)
  assert.deepEqual([answer.meta.load, answer.tiktok.load, answer.google.load], [false, false, false])
  assert.deepEqual(Object.keys(byName(setCookies(res))).sort(), ["_fl_sid", "_fl_src", "_fl_vid"])
  assert.equal(s.builderCalls.length, 0)
})

// ---------------------------------------------------------------- /api/t/e/

test("/api/t/e/ without _fl_vid is a silent 204", async () => {
  const s = scenario()
  for (const cookies of [{}, { _fl_vid: "v1.bad" }, { _fl_sid: SID }]) {
    const res = await s.e.POST(request("/api/t/e/", { cookies, body: batch([pageView()]) }))
    assert.equal(res.status, 204)
    assert.equal(await res.text(), "")
    assert.deepEqual(res.headers.getSetCookie(), [])
  }
  assert.deepEqual(s.afterQueue, [])
})

test("the 204 goes first and the events are forwarded inside after() with the visitor's ctx", async () => {
  const s = scenario()
  const cookies = { ...VISITOR, _fbp: "fb.1.1790467200000.1234567890", fl_audience: "men", ttclid: "E.C.P.abc" }
  const events = [pageView("/shop/"), pageView("/cart/"), pageView("/men/product/x/?case=signature")]
  const res = await s.e.POST(request("/api/t/e/", { cookies, body: batch(events), type: "text/plain" }))
  assert.equal(res.status, 204)
  assert.equal(s.forwarded.length, 0, "nothing is forwarded before the response")
  assert.equal(s.afterQueue.length, 1)
  const slid = byName(setCookies(res))
  assert.deepEqual(Object.keys(slid).sort(), ["_fl_sid", "_fl_src"])
  assert.equal(slid._fl_sid.value, SID)
  assert.deepEqual([slid._fl_sid.attrs["max-age"], slid._fl_sid.attrs.httponly, slid._fl_sid.attrs.domain], ["1800", true, undefined])
  await s.runAfter()
  assert.equal(s.forwarded.length, 2, "one call per mode")
  const women = s.forwarded.find((call) => call.ctx.audience === "women")
  const men = s.forwarded.find((call) => call.ctx.audience === "men")
  assert.deepEqual(women.events.map((event) => event.p), ["/shop/"])
  assert.deepEqual(men.events.map((event) => event.p), ["/cart/", "/men/product/x/?case=signature"], "a shared page takes the remembered mode")
  assert.equal(women.host, TEST_HOST)
  assert.deepEqual(women.ctx, {
    ip: "203.0.113.7", ua: UA, vid: VID, sid: SID, src: "meta_paid", camp: "sept-sale",
    fbp: "fb.1.1790467200000.1234567890", fbc: null, ttp: null, ttclid: "E.C.P.abc", gclid: null, gbraid: null, wbraid: null,
    country: "BD", device: "mobile", audience: "women", new: true, staff: false,
  })
})

test("an expired session restarts as direct; staff traffic is forwarded flagged", async () => {
  const s = scenario()
  const res = await s.e.POST(request("/api/t/e/", { cookies: { _fl_vid: "v1.1790000000.0123456789abcdef", _fl_staff: vectors.keys.staff_cookie }, body: batch([pageView()]) }))
  const slid = byName(setCookies(res))
  assert.notEqual(slid._fl_sid.value, SID)
  assert.deepEqual(JSON.parse(Buffer.from(slid._fl_src.value, "base64url").toString()), { s: "direct", c: null, k: "" })
  await s.runAfter()
  assert.equal(s.forwarded[0].ctx.src, "direct")
  assert.equal(s.forwarded[0].ctx.sid, slid._fl_sid.value)
  assert.equal(s.forwarded[0].ctx.staff, true)
  assert.equal(s.forwarded[0].ctx.new, false)
})

test("invalid events are dropped one by one and counted", async () => {
  const s = scenario()
  const good = pageView("/product/x/?case=signature")
  const events = [
    good,
    { n: "Purchase", id: "fl-1234", t: Date.now(), p: "/checkout/", d: {} },
    { ...pageView(), p: "/order/order_01ABC/" },
    { ...pageView(), p: "/product/x/?review=tok" },
    { ...pageView(), id: "not-a-uuid" },
    "garbage",
    { n: "ViewContent", id: uuid(), t: Date.now(), p: "/product/x/", d: { items: [{ id: "variant_01K6EXAMPLEVARIANT01", q: 1, price: 1400 }], value: 1400, currency: "BDT", phone: "01712345678" } },
  ]
  await s.e.POST(request("/api/t/e/", { cookies: VISITOR, body: batch(events) }))
  await s.runAfter()
  const forwarded = s.forwarded.flatMap((call) => call.events)
  assert.deepEqual(forwarded.map((event) => event.id), [good.id, events[6].id])
  assert.equal(forwarded[1].d.phone, undefined, "unknown keys never reach the backend")
  assert.equal(s.stats["sf.invalid"], 5)

  const many = scenario()
  await many.e.POST(request("/api/t/e/", { cookies: VISITOR, body: batch(Array.from({ length: 30 }, () => pageView())) }))
  await many.runAfter()
  assert.equal(many.forwarded.flatMap((call) => call.events).length, 25, "at most 25 events a batch")
  assert.equal(many.stats["sf.invalid"], 5)

  const malformed = scenario()
  assert.equal((await malformed.e.POST(request("/api/t/e/", { cookies: VISITOR, body: { v: 2, sent_at: 1, events: [] } }))).status, 400)
  assert.equal((await malformed.e.POST(request("/api/t/e/", { cookies: VISITOR, body: { v: 1, events: [pageView()] } }))).status, 400)
})

test("the clock fix keeps the phone-measured age and drops events outside [-60 s, 10 min]", async () => {
  const s = scenario()
  const phone = Date.now() + 3_600_000 // the phone's clock is an hour fast
  const recent = pageView("/shop/", phone - 5_000)
  const ahead = pageView("/shop/", phone + 30_000)
  const tooFarAhead = pageView("/shop/", phone + 61_000)
  const oldest = pageView("/shop/", phone - 600_000)
  const tooOld = pageView("/shop/", phone - 601_000)
  const before = Date.now()
  await s.e.POST(request("/api/t/e/", { cookies: VISITOR, body: batch([recent, ahead, tooFarAhead, oldest, tooOld], phone) }))
  const after = Date.now()
  await s.runAfter()
  const byId = Object.fromEntries(s.forwarded.flatMap((call) => call.events).map((event) => [event.id, event.t]))
  assert.deepEqual(Object.keys(byId).sort(), [recent.id, ahead.id, oldest.id].sort())
  assert.ok(byId[recent.id] >= before - 5_000 && byId[recent.id] <= after - 5_000, "t = server now - age")
  assert.ok(byId[ahead.id] >= before && byId[ahead.id] <= after, "an event ahead of sent_at is now")
  assert.ok(byId[oldest.id] >= before - 600_000 && byId[oldest.id] <= after - 600_000)
  assert.equal(s.stats["sf.invalid"], 2)
})

test("rate limits drop above the per-visitor budget (burst 60, then 120 a minute)", async () => {
  const s = scenario()
  const statuses = []
  for (let round = 0; round < 4; round += 1) {
    const res = await s.e.POST(request("/api/t/e/", { cookies: VISITOR, body: batch(Array.from({ length: 25 }, () => pageView())) }))
    statuses.push(res.status)
  }
  await s.runAfter()
  const passed = s.forwarded.flatMap((call) => call.events).length
  assert.ok(passed >= 60 && passed <= 61, `${passed} passed`)
  assert.equal(s.stats["sf.rate_dropped"], 100 - passed)
  assert.deepEqual(statuses, [204, 204, 204, 204], "silent")
  const other = await s.e.POST(request("/api/t/e/", { cookies: { ...VISITOR, _fl_vid: "v1.1790467200.fedcba9876543210" }, body: batch([pageView()]) }))
  assert.equal(other.status, 204)
  await s.runAfter()
  assert.equal(s.forwarded.flatMap((call) => call.events).length, passed + 1, "another visitor has its own budget")
})

test("a fresh _fl_vid per batch from addresses rotating inside one IPv6 /64 gets one address's budget", async () => {
  const s = scenario()
  const count = () => s.forwarded.flatMap((call) => call.events).length
  const fresh = () => ({ ...VISITOR, _fl_vid: `v1.1790467200.${crypto.randomBytes(8).toString("hex")}` })
  const started = Date.now()
  for (let i = 0; i < 60; i += 1) {
    const res = await s.e.POST(request("/api/t/e/", {
      cookies: fresh(),
      headers: { "cf-connecting-ip": `2001:db8:1:2:${i.toString(16)}:${crypto.randomBytes(2).toString("hex")}::1` },
      body: batch(Array.from({ length: 25 }, () => pageView())),
    }))
    assert.equal(res.status, 204)
  }
  await s.runAfter()
  // The /64's burst is 1,200 events, plus 20 a second of refill while the loop ran (1,500 were offered).
  const ceiling = 1200 + Math.ceil(((Date.now() - started) * 1200) / 60_000)
  const passed = count()
  assert.ok(passed >= 1200 && passed <= ceiling, `${passed} passed (ceiling ${ceiling})`)
  assert.equal(s.stats["sf.rate_dropped"], 1500 - passed)
  assert.ok(s.forwarded.every((call) => call.ctx.ip.startsWith("2001:db8:1:2:")), "the ctx keeps each full address")

  for (const ip of ["2001:db8:1:3::1", "198.51.100.9"]) {
    await s.e.POST(request("/api/t/e/", { cookies: fresh(), headers: { "cf-connecting-ip": ip }, body: batch(Array.from({ length: 25 }, () => pageView())) }))
    await s.runAfter()
  }
  assert.equal(count(), passed + 50, "the next /64 and an IPv4 shopper still get through")
})

// ---------------------------------------------------------------- staff and opt-out links

test("staff: a known host and the right token set or clear _fl_staff; anything else is 404", async () => {
  const s = scenario()
  const get = (query, options = {}) => s.staff.GET(request(`/api/t/staff/${query}`, { method: "GET", ...options }))
  for (const bad of ["?t=nope&on=1", `?t=${vectors.keys.staff_link.slice(0, -1)}0&on=1`, "?on=1", `?t=${vectors.keys.staff_cookie}`]) {
    const res = await get(bad)
    assert.equal(res.status, 404, bad)
    assert.deepEqual(res.headers.getSetCookie(), [])
  }
  const unknown = await get(`?t=${vectors.keys.staff_link}&on=1`, { host: "evil.example" })
  assert.equal(unknown.status, 404)
  const noSecret = await scenario({ env: { TRACKING_INGEST_SECRET: undefined } }).staff.GET(
    request(`/api/t/staff/?t=${vectors.keys.staff_link}&on=1`, { method: "GET" }))
  assert.equal(noSecret.status, 404)

  const on = await get(`?t=${vectors.keys.staff_link}&on=1`)
  assert.equal(on.status, 200)
  assert.match(on.headers.get("content-type"), /^text\/html/)
  assert.equal(on.headers.get("referrer-policy"), "no-referrer", "the token never leaks through a referrer")
  const html = await on.text()
  assert.match(html, /href="\/"/)
  assert.doesNotMatch(html, new RegExp(vectors.keys.staff_link))
  const [staff] = setCookies(on)
  assert.deepEqual([staff.name, staff.value, staff.attrs.httponly, staff.attrs["max-age"], staff.attrs.domain],
    ["_fl_staff", vectors.keys.staff_cookie, true, "34560000", undefined])

  const live = await scenario({ config: LIVE_CONFIG }).staff.GET(request(`/api/t/staff/?t=${vectors.keys.staff_link}&on=1`, { method: "GET", host: "www.florayn.com" }))
  assert.equal(setCookies(live)[0].attrs.domain, "florayn.com")

  const off = await get(`?t=${vectors.keys.staff_link}&on=0`)
  assert.equal(off.status, 200)
  const cleared = setCookies(off)
  assert.ok(cleared.length >= 2)
  assert.ok(cleared.every((cookie) => cookie.name === "_fl_staff" && cookie.value === "" && cookie.attrs["max-age"] === "0"))
  assert.deepEqual(cleared.map((cookie) => cookie.attrs.domain ?? null), [null, "new.florayn.com", "florayn.com"])
})

test("optout: on=1 sets _fl_optout and expires every tracking cookie; on=0 clears it", async () => {
  const s = scenario()
  const on = await s.optout.GET(request("/api/t/optout/?on=1", { method: "GET", cookies: VISITOR }))
  assert.equal(on.status, 200)
  assert.match(await on.text(), /href="\/"/)
  const cookies = setCookies(on)
  const set = cookies.filter((cookie) => cookie.attrs["max-age"] !== "0")
  assert.deepEqual(set.map((cookie) => [cookie.name, cookie.value, cookie.attrs.httponly, cookie.attrs["max-age"]]),
    [["_fl_optout", "1", undefined, "34560000"]])
  const expired = cookies.filter((cookie) => cookie.attrs["max-age"] === "0")
  const names = ["_fl_vid", "_fl_sid", "_fl_src", "_fbp", "_fbc", "ttclid", "_fl_gclid", "_gcl_aw"]
  for (const name of names) {
    assert.deepEqual(expired.filter((cookie) => cookie.name === name).map((cookie) => cookie.attrs.domain ?? null),
      [null, "new.florayn.com", "florayn.com"], `${name}: host-only and Domain copies`)
  }
  assert.equal(expired.length, names.length * 3)

  const live = await scenario({ config: LIVE_CONFIG }).optout.GET(request("/api/t/optout/?on=1", { method: "GET", host: "www.florayn.com" }))
  const liveCookies = setCookies(live)
  assert.equal(liveCookies.find((cookie) => cookie.name === "_fl_optout").attrs.domain, "florayn.com")
  assert.deepEqual(liveCookies.filter((cookie) => cookie.name === "_fbp").map((cookie) => cookie.attrs.domain ?? null), [null, "florayn.com"])

  const off = await s.optout.GET(request("/api/t/optout/?on=0", { method: "GET" }))
  const cleared = setCookies(off)
  assert.ok(cleared.every((cookie) => cookie.name === "_fl_optout" && cookie.attrs["max-age"] === "0"))
  assert.equal(cleared.length, 3)
})

test("every response is private, no-store", () => {
  assert.ok(responses.length > 60, `${responses.length} responses checked`)
  for (const res of responses) assert.equal(res.headers.get("cache-control"), "private, no-store", `status ${res.status}`)
})
