const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/server/* (TRACKING.md 3.4, 4.2-4.4, 4.7, 4.8): keys against the
// Appendix C vectors, host rules against the same vectors the backend uses,
// the pixel load rules, cookies, the rate limiter, the ingest forwarder, the
// checkout tracking headers, and the proof that no client module can import
// this server-only folder.
const root = path.join(__dirname, "..")
const src = path.join(root, "src")
const serverDir = path.join(src, "lib/tracking/server")
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/tracking-vectors.json"), "utf8"))
const SECRET = vectors.keys.secret
const EDGE = "e".repeat(40)
const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(setImmediate) }

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
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Transpiles storefront modules on demand into one vm context. `stubs` are
 * keyed by package name ("next/headers") or by src path ("lib/medusa");
 * node: builtins are real.
 */
function createLoader({ env = {}, stubs = {}, globals = {} } = {}) {
  const processStub = { env: { NODE_ENV: "production", ...env } }
  const context = vm.createContext({
    console, Buffer, URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Request, Response, AbortSignal,
    setTimeout, clearTimeout, process: processStub, fetch: async () => { throw new Error("no fetch stub") }, ...globals,
  })
  const cache = new Map()
  function load(file) {
    const key = srcKey(file)
    if (key in stubs) return stubs[key]
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const require = (spec) => {
      if (spec in stubs) return stubs[spec]
      if (spec.startsWith("node:")) return require_(spec)
      const target = resolveImport(file, spec)
      if (!target) throw new Error(`Unexpected import ${spec} in ${key}`)
      return load(target)
    }
    vm.runInContext(`(function (exports, require, module) {${compile(file)}\n})`, context, { filename: file })(module.exports, require, module)
    return module.exports
  }
  return { load: (relative) => load(path.join(src, relative)), env: processStub.env, context }
}
const require_ = require

const MEDUSA = { MEDUSA_BACKEND_URL: "https://api.test", MEDUSA_PUBLISHABLE_KEY: "pk_test" }

class FakePlainDataObject {
  constructor(host, query_params, cookies, referer, x_forwarded_for, remote_address, scheme = null, request_uri = null) {
    Object.assign(this, { host, query_params, cookies, referer, x_forwarded_for, remote_address, scheme, request_uri })
  }
}
const builderCalls = []
class FakeParamBuilder {
  constructor(domains) { this.domains = domains }
  processRequestFromContext(data) {
    builderCalls.push({ domains: this.domains, data, isPlainDataObject: data instanceof FakePlainDataObject })
    const out = [{ name: "_fbi", value: "203.0.113.7.AQYBAQIA", maxAge: 1, domain: "x" }]
    if (!data.cookies._fbp) out.push({ name: "_fbp", value: "fb.2.1790467200000.123456789.AQYBAQIA", maxAge: 1, domain: "x" })
    if (data.query_params.fbclid) out.push({ name: "_fbc", value: `fb.2.1790467200000.${data.query_params.fbclid}.AQYBAQIA`, maxAge: 1, domain: "x" })
    return out
  }
}
const PARAM_BUILDER = { ParamBuilder: FakeParamBuilder, PlainDataObject: FakePlainDataObject }

function serverLoader(options = {}) {
  return createLoader({
    ...options,
    env: { TRACKING_INGEST_SECRET: SECRET, TRACKING_EDGE_SECRET: EDGE, ...options.env },
    stubs: { "lib/medusa": MEDUSA, "capi-param-builder-nodejs": PARAM_BUILDER, ...options.stubs },
  })
}

/** Objects merge, arrays replace (Appendix C). */
function deepMerge(base, patch) {
  const out = JSON.parse(JSON.stringify(base))
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object"
      ? deepMerge(out[key], value) : value
  }
  return out
}

// ---------------------------------------------------------------- guard

test("every server module calls the runtime guard at load, and it throws in a browser", () => {
  for (const name of fs.readdirSync(serverDir).filter((file) => file.endsWith(".ts") && file !== "guard.ts")) {
    const text = fs.readFileSync(path.join(serverDir, name), "utf8")
    assert.match(text, /^import \{ assertServer \} from "\.\/guard"$/m, `${name} imports the guard`)
    assert.match(text, /^assertServer\(\)$/m, `${name} calls assertServer() at top level`)
  }
  const inBrowser = createLoader({ globals: { window: {} } })
  assert.throws(() => inBrowser.load("lib/tracking/server/keys.ts"), /server-only/)
  assert.doesNotThrow(() => createLoader().load("lib/tracking/server/guard.ts").assertServer())
})

test("no \"use client\" module, or anything it imports, reaches lib/tracking/server/", () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(src)
  const isClient = (file) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(fs.readFileSync(file, "utf8"))
  const isServerActions = (file) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(fs.readFileSync(file, "utf8"))
  const clients = files.filter(isClient)
  assert.ok(clients.length > 10, "found the client components")
  const specifiers = (file) => {
    const text = fs.readFileSync(file, "utf8")
    const found = []
    const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g
    for (const match of text.matchAll(pattern)) found.push(match[1] || match[2] || match[3])
    return found
  }
  const seen = new Set()
  const queue = clients.map((file) => [file, [srcKey(file)]])
  while (queue.length) {
    const [file, chain] = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of specifiers(file)) {
      const target = resolveImport(file, spec)
      if (!target) continue
      assert.ok(!path.resolve(target).startsWith(serverDir + path.sep),
        `client code reaches ${srcKey(target)} via ${[...chain, srcKey(target)].join(" -> ")}`)
      // A "use server" module reaches the browser only as action references (lib/cart.ts
      // submitOrder reads the checkout tracking headers), so its own imports stay on the server.
      if (isServerActions(target)) continue
      queue.push([target, [...chain, srcKey(target)]])
    }
  }
  assert.ok(seen.size >= clients.length)
})

// ---------------------------------------------------------------- keys

test("derived keys equal the Appendix C vectors", () => {
  const keys = serverLoader().load("lib/tracking/server/keys.ts")
  assert.equal(keys.derivedIngestKey(), vectors.keys.ingest)
  assert.equal(keys.staffLinkToken(), vectors.keys.staff_link)
  assert.equal(keys.staffCookieValue(), vectors.keys.staff_cookie)
  assert.equal(keys.icEventId(vectors.keys.ic.cart_id), vectors.keys.ic.id)
  assert.match(keys.icEventId("cart_other"), /^ic-[0-9a-f]{24}$/)
  assert.equal(keys.icEventId(""), null)
  assert.equal(keys.ingestSecret(), SECRET)
  assert.equal(keys.sha256Hex("v1.1790467200.0123456789abcdef"), vectors.hashes.sha256["v1.1790467200.0123456789abcdef"])
  assert.equal(keys.isStaffCookie(vectors.keys.staff_cookie), true)
  assert.equal(keys.isStaffCookie(vectors.keys.staff_link), false)
  assert.equal(keys.isStaffCookie(undefined), false)
})

test("keys fail closed when the secret is unset or shorter than 32 chars", () => {
  for (const secret of [undefined, "", "x".repeat(31)]) {
    const keys = serverLoader({ env: { TRACKING_INGEST_SECRET: secret } }).load("lib/tracking/server/keys.ts")
    assert.equal(keys.ingestSecret(), null)
    assert.equal(keys.derivedIngestKey(), null)
    assert.equal(keys.staffLinkToken(), null)
    assert.equal(keys.staffCookieValue(), null)
    assert.equal(keys.icEventId("cart_01TESTCART0001"), null)
    assert.equal(keys.isStaffCookie(""), false)
    assert.equal(keys.isStaffCookie(null), false)
  }
})

test("edgeOk: the exact edge secret of 32+ chars, and the dev escape only outside production", () => {
  const headers = (value) => new Headers(value === undefined ? {} : { "x-florayn-edge": value })
  const keys = serverLoader().load("lib/tracking/server/keys.ts")
  assert.equal(keys.edgeOk(headers(EDGE)), true)
  assert.equal(keys.edgeOk(headers(`${EDGE}x`)), false)
  assert.equal(keys.edgeOk(headers("f".repeat(40))), false)
  assert.equal(keys.edgeOk(headers(undefined)), false)
  const short = serverLoader({ env: { TRACKING_EDGE_SECRET: "s".repeat(31) } }).load("lib/tracking/server/keys.ts")
  assert.equal(short.edgeOk(headers("s".repeat(31))), false, "a short edge secret counts as unset")
  const unset = serverLoader({ env: { TRACKING_EDGE_SECRET: undefined } }).load("lib/tracking/server/keys.ts")
  assert.equal(unset.edgeOk(headers("")), false)
  const prodEscape = serverLoader({ env: { TRACKING_DEV_TRUST_EDGE: "1", NODE_ENV: "production" } }).load("lib/tracking/server/keys.ts")
  assert.equal(prodEscape.edgeOk(headers(undefined)), false, "never in next start")
  const dev = serverLoader({ env: { TRACKING_DEV_TRUST_EDGE: "1", NODE_ENV: "development", TRACKING_EDGE_SECRET: undefined } })
    .load("lib/tracking/server/keys.ts")
  assert.equal(dev.edgeOk(headers(undefined)), true)
  const devOff = serverLoader({ env: { TRACKING_DEV_TRUST_EDGE: "true", NODE_ENV: "development" } }).load("lib/tracking/server/keys.ts")
  assert.equal(devOff.edgeOk(headers(undefined)), false, "only the literal 1")
  assert.equal(keys.timingSafeEqualStr("abc", "abc"), true)
  assert.equal(keys.timingSafeEqualStr("abc", "abd"), false)
  assert.equal(keys.timingSafeEqualStr("abc", "abcd"), false)
  assert.equal(keys.timingSafeEqualStr(null, "abc"), false)
})

// ---------------------------------------------------------------- config

function loadConfig(fetchImpl) {
  return serverLoader({ globals: { fetch: fetchImpl ?? (async () => { throw new Error("offline") }) } })
    .load("lib/tracking/server/config.ts")
}

test("hostRole and destinationFor equal every Appendix C vector", () => {
  const config = loadConfig()
  for (const [patch, host, expected] of vectors.host_role) {
    assert.equal(config.hostRole(deepMerge(config.DEFAULT_TRACKING_CONFIG, patch), host), expected, `${JSON.stringify(patch)} ${host}`)
  }
  for (const vector of vectors.destination) {
    const merged = deepMerge(config.DEFAULT_TRACKING_CONFIG, vector.patch)
    assert.deepEqual(plain(config.destinationFor(merged, vector.host, vector.platform)), vector.expect,
      `${JSON.stringify(vector.patch)} ${vector.host} ${vector.platform}`)
  }
  assert.equal(config.normHost(" NEW.Florayn.com:8000 "), "new.florayn.com")
  assert.equal(config.hostRole(config.DEFAULT_TRACKING_CONFIG, ""), null)
})

test("the defaults are the public subset of 3.1 with every platform off", () => {
  const { DEFAULT_TRACKING_CONFIG: base, destinationFor, parsePublicConfig } = loadConfig()
  assert.deepEqual(plain(base), {
    test_hosts: ["new.florayn.com"], live_hosts: ["florayn.com", "www.florayn.com"], live_armed: false,
    meta: { enabled: false, test_id: "2247389409441720", live_id: "650439547920083", browser: "all", aam_off_confirmed: { test: false, live: false } },
    tiktok: { enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only", spa_off_confirmed: false },
    google: { enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D", browser: "ads_only" },
    privacy: { share: false, consent_version: 1, consent_text: "" },
  })
  for (const platform of ["meta", "tiktok", "google"]) {
    for (const host of ["new.florayn.com", "florayn.com"]) assert.equal(destinationFor(base, host, platform), null)
  }
  assert.deepEqual(plain(parsePublicConfig(null)), plain(base))
  assert.deepEqual(plain(parsePublicConfig("junk")), plain(base))
  const junk = parsePublicConfig({
    test_hosts: "x", live_hosts: ["FLORAYN.com:443", 7], live_armed: "yes",
    meta: { enabled: 1, browser: "sometimes", aam_off_confirmed: { test: true } },
    privacy: { share: true, consent_version: 0, consent_text: 5 },
  })
  assert.deepEqual(plain(junk.test_hosts), ["new.florayn.com"])
  assert.deepEqual(plain(junk.live_hosts), ["florayn.com"])
  assert.equal(junk.live_armed, false)
  assert.equal(junk.meta.enabled, false)
  assert.equal(junk.meta.browser, "all")
  assert.deepEqual(plain(junk.meta.aam_off_confirmed), { test: true, live: false })
  assert.deepEqual(plain(junk.privacy), { share: true, consent_version: 1, consent_text: "" })
})

test("getTrackingConfig reads /store/tracking-config through the data cache and falls back to all-off", async () => {
  const calls = []
  const live = { ...JSON.parse(JSON.stringify(loadConfig().DEFAULT_TRACKING_CONFIG)), live_armed: true }
  live.meta.enabled = true
  const config = loadConfig(async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ config: live }) }
  })
  const result = await config.getTrackingConfig()
  assert.equal(result.live_armed, true)
  assert.equal(result.meta.enabled, true)
  assert.equal(calls[0].url, "https://api.test/store/tracking-config")
  assert.deepEqual(plain(calls[0].init), {
    headers: { "x-publishable-api-key": "pk_test" },
    next: { revalidate: 300, tags: ["content", "content:tracking"] },
  })
  const failing = loadConfig(async () => ({ ok: false, json: async () => ({ config: live }) }))
  assert.deepEqual(plain(await failing.getTrackingConfig()), plain(failing.DEFAULT_TRACKING_CONFIG))
  const offline = loadConfig()
  assert.deepEqual(plain(await offline.getTrackingConfig()), plain(offline.DEFAULT_TRACKING_CONFIG))
  const badJson = loadConfig(async () => ({ ok: true, json: async () => { throw new Error("bad json") } }))
  assert.equal((await badJson.getTrackingConfig()).meta.enabled, false)
})

test("pixelsFor applies aam_off_confirmed[env], spa_off_confirmed, ads_only and the staff/optout rules", () => {
  const config = loadConfig()
  const base = config.DEFAULT_TRACKING_CONFIG
  const make = (patch) => deepMerge(base, patch)
  const TEST = "new.florayn.com"
  const LIVE = "florayn.com"

  assert.deepEqual(plain(config.pixelsFor(base, TEST, {})), { meta: null, tiktok: null, google: null })

  const meta = make({ meta: { enabled: true } })
  assert.deepEqual(plain(config.pixelsFor(meta, TEST, {}).meta), { id: "2247389409441720", load: false }, "AAM not confirmed for test")
  const metaOk = make({ meta: { enabled: true, aam_off_confirmed: { test: true } } })
  assert.deepEqual(plain(config.pixelsFor(metaOk, TEST, {}).meta), { id: "2247389409441720", load: true })
  const armed = make({ live_armed: true, meta: { enabled: true, aam_off_confirmed: { test: true } } })
  assert.equal(config.pixelsFor(armed, LIVE, {}).meta.load, false, "the live dataset needs its own confirmation")
  assert.equal(config.pixelsFor(make({ live_armed: true, meta: { enabled: true, aam_off_confirmed: { live: true } } }), LIVE, {}).meta.load, true)
  assert.equal(config.pixelsFor(make({ meta: { enabled: true, browser: "off", aam_off_confirmed: { test: true } } }), TEST, {}).meta.load, false)
  const adsOnly = make({ meta: { enabled: true, browser: "ads_only", aam_off_confirmed: { test: true } } })
  assert.equal(config.pixelsFor(adsOnly, TEST, {}).meta.load, false)
  assert.equal(config.pixelsFor(adsOnly, TEST, { _fbc: "fb.1.1.x" }).meta.load, true)
  assert.equal(config.pixelsFor(adsOnly, TEST, {}, ["_fbc"]).meta.load, true, "a click cookie set by this response counts")
  assert.equal(config.pixelsFor(adsOnly, TEST, { _fbp: "fb.1.1.x" }).meta.load, false, "_fbp is not an ad click")

  const tiktok = make({ live_armed: true, tiktok: { enabled: true } })
  assert.deepEqual(plain(config.pixelsFor(tiktok, LIVE, { ttclid: "E.C.P" }).tiktok), { id: "D9ODDBJC77U97D5Q7MQG", load: false },
    "SPA page views not confirmed off")
  const tiktokOk = make({ live_armed: true, tiktok: { enabled: true, spa_off_confirmed: true } })
  assert.equal(config.pixelsFor(tiktokOk, LIVE, {}).tiktok.load, false, "ads_only without ttclid")
  assert.equal(config.pixelsFor(tiktokOk, LIVE, { ttclid: "E.C.P" }).tiktok.load, true)
  assert.equal(config.pixelsFor(tiktokOk, LIVE, {}, ["ttclid"]).tiktok.load, true)
  assert.equal(config.pixelsFor(tiktokOk, TEST, { ttclid: "E.C.P" }).tiktok, null, "no TikTok test pixel yet")

  const google = make({ live_armed: true, google: { enabled: true } })
  assert.equal(config.pixelsFor(google, TEST, { _fl_gclid: "x" }).google, null, "Google is live-only")
  assert.deepEqual(plain(config.pixelsFor(google, LIVE, {}).google), { id: "AW-18147096523", label: "0p0wCKu2w70cEMvvms1D", load: false })
  assert.equal(config.pixelsFor(google, LIVE, { _fl_gclid: "x" }).google.load, true)
  assert.equal(config.pixelsFor(google, LIVE, {}, ["_fl_gclid"]).google.load, true)
  assert.equal(config.pixelsFor(google, LIVE, { gclid: "raw" }).google.load, false, "only our own _fl_gclid cookie counts")

  const everything = make({
    live_armed: true, meta: { enabled: true, aam_off_confirmed: { live: true } },
    tiktok: { enabled: true, browser: "all", spa_off_confirmed: true }, google: { enabled: true, browser: "all" },
  })
  const all = config.pixelsFor(everything, LIVE, {})
  assert.deepEqual([all.meta.load, all.tiktok.load, all.google.load], [true, true, true])
  const staff = config.pixelsFor(everything, LIVE, { _fl_staff: vectors.keys.staff_cookie })
  assert.deepEqual([staff.meta.load, staff.tiktok.load, staff.google.load], [false, false, false])
  assert.ok(staff.meta.id, "staff still learn the ids, never load them")
  const fakeStaff = config.pixelsFor(everything, LIVE, { _fl_staff: "0".repeat(64) })
  assert.equal(fakeStaff.meta.load, true, "a forged staff cookie is ignored")
  const optout = config.pixelsFor(everything, LIVE, { _fl_optout: "1" })
  assert.deepEqual([optout.meta.load, optout.tiktok.load, optout.google.load], [false, false, false])
})

test("checkoutConsent is the consent line only while sharing is on", () => {
  const config = loadConfig()
  const base = config.DEFAULT_TRACKING_CONFIG
  assert.equal(config.checkoutConsent(base), null)
  assert.equal(config.checkoutConsent(deepMerge(base, { privacy: { share: false, consent_text: "We send hashes.", consent_version: 3 } })), null)
  assert.equal(config.checkoutConsent(deepMerge(base, { privacy: { share: true, consent_text: "  " } })), null)
  assert.deepEqual(plain(config.checkoutConsent(deepMerge(base, { privacy: { share: true, consent_text: " We send hashes. ", consent_version: 3 } }))),
    { text: "We send hashes.", version: 3 })
})

// ---------------------------------------------------------------- cookies

function loadCookies() {
  const loader = serverLoader()
  return { cookies: loader.load("lib/tracking/server/cookies.ts"), config: loader.load("lib/tracking/server/config.ts") }
}

test("visitor and session ids, the new-visitor rule and the base64url cookie values", () => {
  const { cookies } = loadCookies()
  const now = 1790467200456
  const vid = cookies.newVisitorId(now)
  const sid = cookies.newSessionId(now)
  assert.match(vid, /^v1\.1790467200\.[0-9a-f]{16}$/)
  assert.match(sid, /^s1\.1790467200\.[0-9a-f]{8}$/)
  assert.notEqual(cookies.newVisitorId(now), vid)
  assert.equal(cookies.isVisitorId(vid), true)
  assert.equal(cookies.isVisitorId("v1.1790467200.0123456789ABCDEF"), false)
  assert.equal(cookies.isSessionId(sid), true)
  assert.equal(cookies.isSessionId(vid), false)
  assert.equal(cookies.isNewVisitor("v1.1790467200.0123456789abcdef", "s1.1790467200.01234567"), true)
  assert.equal(cookies.isNewVisitor("v1.1790467100.0123456789abcdef", "s1.1790467200.01234567"), false)

  const src = { s: "meta_paid", c: "sept-sale", k: "0123abcd" }
  const encoded = cookies.encodeCookieJson(src)
  assert.match(encoded, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(plain(cookies.decodeSource(encoded)), src)
  assert.equal(cookies.decodeSource(cookies.encodeCookieJson({ s: "Meta Paid", c: null, k: "" })), null)
  assert.equal(cookies.decodeSource(cookies.encodeCookieJson({ s: "direct", c: "c".repeat(81), k: "" })), null)
  assert.equal(cookies.decodeSource("not+base64"), null)
  assert.equal(cookies.decodeSource(undefined), null)
  assert.deepEqual(plain(cookies.decodeSource(cookies.encodeCookieJson({ s: "direct", k: "" }))), { s: "direct", c: null, k: "" })
  const gclid = { k: "gbraid", v: "0AAAAA", t: 1790467200 }
  assert.deepEqual(plain(cookies.decodeGoogleClick(cookies.encodeCookieJson(gclid))), gclid)
  assert.equal(cookies.decodeGoogleClick(cookies.encodeCookieJson({ k: "fbclid", v: "x", t: 1 })), null)
  assert.equal(cookies.clickHash("AbC"), crypto.createHash("sha256").update("AbC").digest("hex").slice(0, 8))
})

test("cookie serialisation: host-only by default, Domain without www on live hosts", () => {
  const { cookies, config } = loadCookies()
  const base = config.DEFAULT_TRACKING_CONFIG
  assert.equal(cookies.cookieDomain(base, "new.florayn.com"), null)
  assert.equal(cookies.cookieDomain(base, "florayn.com"), "florayn.com")
  assert.equal(cookies.cookieDomain(base, "WWW.florayn.com:443"), "florayn.com")
  assert.equal(cookies.cookieDomain(base, "evil.example"), null)
  assert.equal(cookies.serializeCookie("_fl_vid", "v1.1.x", { maxAge: 34560000, httpOnly: true, domain: null }),
    "_fl_vid=v1.1.x; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax")
  assert.equal(cookies.serializeCookie("_fbp", "fb.1", { maxAge: 7776000, httpOnly: false, domain: "florayn.com" }),
    "_fbp=fb.1; Path=/; Max-Age=7776000; Domain=florayn.com; Secure; SameSite=Lax")
  assert.deepEqual(plain(cookies.MAX_AGE), { visitor: 34560000, session: 1800, vendor: 7776000, flag: 34560000 })
  assert.equal(cookies.isCookieSafe("E.C.P.abc-_123"), true)
  for (const unsafe of ["a b", "a;b", "a,b", "a\"b", "a\\b", ""]) assert.equal(cookies.isCookieSafe(unsafe), false, unsafe)

  const cleared = cookies.expireCookies(base, "new.florayn.com", ["_fbp"])
  assert.deepEqual(plain(cleared), [
    "_fbp=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
    "_fbp=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=new.florayn.com; Secure; SameSite=Lax",
    "_fbp=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=florayn.com; Secure; SameSite=Lax",
  ], "host-only, the host and its parent (where fbevents.js writes)")
  assert.equal(cookies.expireCookies(base, "www.florayn.com", ["x"]).length, 2, "host-only and florayn.com")
  assert.equal(cookies.expireCookies(base, "localhost", ["x"]).length, 1)
  assert.deepEqual(plain(cookies.TRACKING_COOKIES), ["_fl_vid", "_fl_sid", "_fl_src", "_fbp", "_fbc", "ttclid", "_fl_gclid", "_gcl_aw"])
})

test("sessions rotate on a new click id or utm_campaign and otherwise slide", () => {
  const { cookies } = loadCookies()
  const HOST = "new.florayn.com"
  const sid = "s1.1790467200.01234567"
  const saved = (src) => ({ _fl_sid: sid, _fl_src: cookies.encodeCookieJson(src) })
  const landing = (q, ref = null) => ({ q, ref, path: "/product/x/" })
  const kept = cookies.resolveSession(saved({ s: "meta", c: null, k: cookies.clickHash("F1") }), landing({ fbclid: "F1" }), "UA", HOST)
  assert.equal(kept.sid, sid)
  assert.equal(kept.rotated, false)
  const noClick = cookies.resolveSession(saved({ s: "meta", c: null, k: "abcdef01" }), landing({}), "UA", HOST)
  assert.equal(noClick.sid, sid, "a landing without a click keeps the session")
  const newClick = cookies.resolveSession(saved({ s: "meta", c: null, k: cookies.clickHash("F1") }), landing({ fbclid: "F2" }), "UA", HOST)
  assert.equal(newClick.rotated, true)
  assert.notEqual(newClick.sid, sid)
  assert.deepEqual(plain(newClick.src), { s: "meta", c: null, k: cookies.clickHash("F2") })
  const newCampaign = cookies.resolveSession(saved({ s: "direct", c: "a", k: "" }), landing({ utm_campaign: "b", utm_source: "fb", utm_medium: "paid" }), "UA", HOST)
  assert.deepEqual(plain(newCampaign.src), { s: "meta_paid", c: "b", k: "" })
  const sameCampaign = cookies.resolveSession(saved({ s: "meta_paid", c: "b", k: "" }), landing({ utm_campaign: "b" }), "UA", HOST)
  assert.equal(sameCampaign.rotated, false)
  const expired = cookies.resolveSession({}, landing({}, "https://www.google.com"), "UA", HOST)
  assert.equal(expired.rotated, true)
  assert.deepEqual(plain(expired.src), { s: "google_organic", c: null, k: "" })
  const broken = cookies.resolveSession({ _fl_sid: sid, _fl_src: "garbage" }, null, "UA", HOST)
  assert.equal(broken.rotated, true)
  assert.equal(broken.src.s, "direct")

  const slid = cookies.slideSession(saved({ s: "tiktok_paid", c: null, k: "" }))
  assert.deepEqual([slid.sid, slid.src.s, slid.rotated], [sid, "tiktok_paid", false])
  const restarted = cookies.slideSession({ _fl_src: cookies.encodeCookieJson({ s: "meta", c: null, k: "" }) })
  assert.equal(restarted.rotated, true)
  assert.deepEqual(plain(restarted.src), { s: "direct", c: null, k: "" }, "a session that expired restarts as direct")
})

test("vendorIds reads the click ids back within the 4.4 caps", () => {
  const { cookies } = loadCookies()
  const gclid = cookies.encodeCookieJson({ k: "gclid", v: "Cj0KCQ", t: 1790467200 })
  assert.deepEqual(plain(cookies.vendorIds({ _fbp: "fb.1.1.2", _fbc: "fb.1.1.F", _ttp: "ttp", ttclid: "E.C.P", _fl_gclid: gclid })), {
    fbp: "fb.1.1.2", fbc: "fb.1.1.F", ttp: "ttp", ttclid: "E.C.P", gclid: "Cj0KCQ", gbraid: null, wbraid: null,
  })
  const long = plain(cookies.vendorIds({ _fbp: "f".repeat(121), _fbc: "c".repeat(601), _ttp: "t".repeat(101), ttclid: "x".repeat(1001) }))
  assert.deepEqual(long, { fbp: null, fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null, wbraid: null }, "too long is dropped, never cut")
})

test("the real Parameter Builder gives only _fbp and _fbc, with our attributes", () => {
  const loader = serverLoader({ stubs: { "capi-param-builder-nodejs": require_("capi-param-builder-nodejs") } })
  const cookies = loader.load("lib/tracking/server/cookies.ts")
  const landing = { q: { fbclid: "IwAR0abc_DEF-123", utm_source: "facebook" }, ref: "https://l.facebook.com", path: "/product/x/" }
  const fresh = cookies.metaCookies(null, "new.florayn.com", landing, {}, "203.0.113.7")
  assert.deepEqual(plain(fresh.map((cookie) => cookie.name).sort()), ["_fbc", "_fbp"])
  assert.match(fresh.find((cookie) => cookie.name === "_fbp").value, /^fb\.2\.\d{13}\.\d+\.[A-Za-z0-9_-]+$/)
  assert.match(fresh.find((cookie) => cookie.name === "_fbc").value, /^fb\.2\.\d{13}\.IwAR0abc_DEF-123\.[A-Za-z0-9_-]+$/)
  const live = cookies.metaCookies("florayn.com", "florayn.com", landing, {}, null)
  assert.match(live.find((cookie) => cookie.name === "_fbp").value, /^fb\.1\./, "sub-domain index from our own Domain")
  const pixelOwn = { _fbp: "fb.1.1790467200000.1234567890", _fbc: "fb.1.1790467200000.IwAR0abc_DEF-123" }
  assert.deepEqual(plain(cookies.metaCookies(null, "new.florayn.com", landing, pixelOwn, null)), [],
    "the pixel's own cookies are not rewritten, and the same fbclid is not new")
  const other = cookies.metaCookies(null, "new.florayn.com", { ...landing, q: { fbclid: "IwAR0other" } }, pixelOwn, null)
  assert.deepEqual(plain(other.map((cookie) => cookie.name)), ["_fbc"], "a different fbclid replaces _fbc")
  assert.deepEqual(plain(cookies.metaCookies(null, "new.florayn.com", { ...landing, q: { fbclid: "bad;value" } }, pixelOwn, null)), [],
    "a value that is not cookie-safe is never set")
})

// ---------------------------------------------------------------- rate limit

test("rate limits: 120 events a minute per visitor with a burst of 60, 1,200 per IP, LRU capped", () => {
  let now = 0
  const { createRateLimiter, VISITOR_LIMIT, IP_LIMIT, MAX_KEYS } = serverLoader().load("lib/tracking/server/rate-limit.ts")
  assert.deepEqual(plain({ VISITOR_LIMIT, IP_LIMIT, MAX_KEYS }), {
    VISITOR_LIMIT: { perMinute: 120, burst: 60 }, IP_LIMIT: { perMinute: 1200, burst: 1200 }, MAX_KEYS: 50000,
  })
  const limiter = createRateLimiter({ now: () => now })
  assert.equal(limiter.take("v1", "203.0.113.7", 25), 25)
  assert.equal(limiter.take("v1", "203.0.113.7", 25), 25)
  assert.equal(limiter.take("v1", "203.0.113.7", 25), 10, "the burst of 60 is used up")
  assert.equal(limiter.take("v1", "203.0.113.7", 25), 0)
  now += 1000
  assert.equal(limiter.take("v1", "203.0.113.7", 25), 2, "2 events a second refill")
  now += 60_000
  assert.equal(limiter.take("v1", null, 100), 60, "never more than the burst")
  let passed = 0
  for (let second = 0; second < 60; second += 1) {
    now += 1000
    passed += limiter.take("v1", null, 25)
  }
  assert.equal(passed, 120, "a steady sender gets 120 a minute")
  assert.equal(limiter.take("v2", null, 25), 25, "each visitor has its own bucket")

  const shared = createRateLimiter({ now: () => now })
  let total = 0
  for (let visitor = 0; visitor < 30; visitor += 1) total += shared.take(`nat${visitor}`, "198.51.100.1", 60)
  assert.equal(total, 1200, "one IP (carrier NAT) caps at 1,200")
  assert.equal(shared.take("fresh", "198.51.100.2", 60), 60)

  const small = createRateLimiter({ now: () => now, maxKeys: 3 })
  for (const visitor of ["a", "b", "c", "d"]) small.take(visitor, null, 60)
  assert.equal(small.size(), 3)
  assert.equal(small.take("a", null, 60), 60, "the least recently used key was evicted")
  assert.equal(small.take("d", null, 60), 0, "a recent key keeps its bucket")
  assert.equal(small.take("x", null, -5), 0)
})

// ---------------------------------------------------------------- forwarder

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
    pending: () => timers.filter((timer) => !timer.done).length,
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
  src: "meta_paid", camp: "sept-sale", fbp: "fb.1.1.2", fbc: null, ttp: null, ttclid: null, gclid: null, gbraid: null,
  wbraid: null, country: "BD", device: "mobile", audience: "women", new: true, staff: false,
}
const pageView = (i, extra = {}) => ({ n: "PageView", id: `3f9c2a1e-5b7d-4c8e-9a0b-${String(i).padStart(12, "0")}`, t: 1790467200000 + i, p: "/shop/", ...extra })

function forwarder({ responses = [], key = "k".repeat(64) } = {}) {
  const clock = fakeClock()
  const posts = []
  const { createForwarder, FORWARD_LIMITS } = serverLoader().load("lib/tracking/server/forward.ts")
  const instance = createForwarder({
    fetch: async (url, init) => {
      posts.push({ url, init, body: JSON.parse(init.body), bytes: Buffer.byteLength(init.body) })
      const next = responses.length ? responses.shift() : { ok: true, status: 202 }
      if (next instanceof Error) throw next
      return next
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    endpoint: () => "https://api.test/tracking/ingest",
    key: () => key,
  })
  return { instance, clock, posts, FORWARD_LIMITS }
}

test("the forwarder coalesces for 250 ms, groups by (host, ctx) and sends the exact 4.3 envelope", async () => {
  const { instance, clock, posts } = forwarder()
  const done = instance.forwardEvents("new.florayn.com", CTX, [pageView(1)])
  instance.forwardEvents("new.florayn.com", { ...CTX }, [pageView(2)])
  instance.forwardEvents("new.florayn.com", { ...CTX, audience: "men" }, [pageView(3, { p: "/men/" })])
  instance.bumpStat("sf.untrusted", 3)
  await settle()
  assert.equal(posts.length, 0, "nothing before 250 ms")
  await clock.advance(249)
  assert.equal(posts.length, 0)
  await clock.advance(1)
  await done
  assert.equal(posts.length, 1)
  const [post] = posts
  assert.equal(post.url, "https://api.test/tracking/ingest")
  assert.equal(post.init.method, "POST")
  assert.deepEqual(plain(post.init.headers), { "content-type": "application/json", "x-florayn-ingest-key": "k".repeat(64) })
  assert.ok(post.init.signal, "a 3 s timeout signal")
  assert.deepEqual(post.body, {
    v: 1,
    stats: { "sf.untrusted": 3 },
    batches: [
      { host: "new.florayn.com", ctx: CTX, events: [pageView(1), pageView(2)] },
      { host: "new.florayn.com", ctx: { ...CTX, audience: "men" }, events: [pageView(3, { p: "/men/" })] },
    ],
  })
})

test("the forwarder flushes at 100 events and splits at 200 events and 256 KB", async () => {
  const { instance, posts, FORWARD_LIMITS } = forwarder()
  assert.deepEqual(plain(FORWARD_LIMITS), {
    coalesceMs: 250, coalesceEvents: 100, maxEvents: 200, maxBytes: 262144, timeoutMs: 3000,
    capEvents: 3000, capWindowMs: 10000, statsIdleMs: 60000, maxStatKeys: 50,
  })
  await instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 450 }, (_, i) => pageView(i)))
  assert.deepEqual(posts.map((post) => post.body.batches.reduce((n, batch) => n + batch.events.length, 0)), [200, 200, 50])
  assert.deepEqual(posts.flatMap((post) => post.body.batches.flatMap((batch) => batch.events.map((event) => event.t))),
    Array.from({ length: 450 }, (_, i) => 1790467200000 + i), "order kept")

  posts.length = 0
  const big = Array.from({ length: 150 }, (_, i) => pageView(i, { d: { pad: "x".repeat(4000) } }))
  await instance.forwardEvents("new.florayn.com", CTX, big)
  assert.ok(posts.length >= 3, `split by size into ${posts.length} requests`)
  for (const post of posts) {
    assert.ok(post.bytes <= 256 * 1024, `${post.bytes} bytes`)
    assert.ok(post.body.batches.every((batch) => batch.host === "new.florayn.com" && batch.events.length))
  }
  assert.equal(posts.reduce((n, post) => n + post.body.batches[0].events.length, 0), 150)
})

test("the global cap drops past 3,000 events per 10 s and counts sf.cap_dropped", async () => {
  const { instance, clock, posts } = forwarder()
  await instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 3500 }, (_, i) => pageView(i)))
  const sent = posts.reduce((n, post) => n + post.body.batches.reduce((m, batch) => m + batch.events.length, 0), 0)
  assert.equal(sent, 3000)
  assert.deepEqual(posts[0].body.stats, { "sf.cap_dropped": 500 })
  assert.ok(posts.slice(1).every((post) => JSON.stringify(post.body.stats) === "{}"), "stats ride once")
  posts.length = 0
  await instance.forwardEvents("new.florayn.com", CTX, [pageView(1)])
  await clock.advance(250)
  assert.equal(posts.length, 0, "still inside the 10 s window: dropped, nothing queued")
  await clock.advance(60_000)
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body, { v: 1, stats: { "sf.cap_dropped": 1 }, batches: [] }, "the drop is counted")
  posts.length = 0
  const next = instance.forwardEvents("new.florayn.com", CTX, [pageView(2)])
  await clock.advance(250)
  await next
  assert.equal(posts[0].body.batches[0].events.length, 1, "a new window")
})

test("counters go alone after 60 s without traffic", async () => {
  const { instance, clock, posts } = forwarder()
  instance.bumpStat("sf.bot")
  instance.bumpStat("sf.bot", 2)
  instance.bumpStat("sf.untrusted")
  instance.bumpStat("Bad Key", 1)
  instance.bumpStat("sf.invalid", 0)
  await clock.advance(59_999)
  assert.equal(posts.length, 0)
  await clock.advance(1)
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body, { v: 1, stats: { "sf.bot": 3, "sf.untrusted": 1 }, batches: [] })
  await clock.advance(120_000)
  assert.equal(posts.length, 1, "nothing more to send")
})

test("one retry, then counted as sf.forward_failed; never throws; nothing without the secret", async () => {
  const flaky = forwarder({ responses: [new Error("reset"), { ok: true, status: 202 }] })
  await flaky.instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 100 }, (_, i) => pageView(i)))
  assert.equal(flaky.posts.length, 2, "retried once")
  assert.equal(flaky.posts[0].init.body, flaky.posts[1].init.body)

  const down = forwarder({ responses: [{ ok: false, status: 503 }, new Error("timeout")] })
  down.instance.bumpStat("sf.bot", 4)
  await down.instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 100 }, (_, i) => pageView(i)))
  assert.equal(down.posts.length, 2)
  await down.clock.advance(60_000)
  assert.equal(down.posts.length, 3)
  assert.deepEqual(down.posts[2].body, { v: 1, stats: { "sf.bot": 4, "sf.forward_failed": 100 }, batches: [] },
    "failed counters are kept and the lost events counted")

  const rejected = forwarder({ responses: [{ ok: false, status: 401 }] })
  await rejected.instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 100 }, (_, i) => pageView(i)))
  assert.equal(rejected.posts.length, 1, "a 401 is not retried")

  const off = forwarder({ key: null })
  off.instance.bumpStat("sf.untrusted")
  await off.instance.forwardEvents("new.florayn.com", CTX, Array.from({ length: 120 }, (_, i) => pageView(i)))
  await off.clock.advance(120_000)
  assert.equal(off.posts.length, 0)
  assert.equal(off.clock.pending(), 0, "no timers kept alive without the secret")

  const { instance } = forwarder()
  assert.equal(await instance.forwardEvents("new.florayn.com", CTX, []), undefined)
  const circular = {}
  circular.self = circular
  assert.equal(await instance.forwardEvents("new.florayn.com", circular, [pageView(1)]), undefined, "never rejects")
})

test("the default forwarder posts to MEDUSA_BACKEND_URL/tracking/ingest with the derived key", async () => {
  const posts = []
  const loader = serverLoader({ globals: { fetch: async (url, init) => { posts.push({ url, init }); return { ok: true, status: 202 } } } })
  const forward = loader.load("lib/tracking/server/forward.ts")
  await forward.forwardEvents("new.florayn.com", CTX, Array.from({ length: 100 }, (_, i) => pageView(i)))
  assert.equal(posts.length, 1)
  assert.equal(posts[0].url, "https://api.test/tracking/ingest")
  assert.equal(posts[0].init.headers["x-florayn-ingest-key"], vectors.keys.ingest)
  assert.ok(!posts[0].init.body.includes(SECRET), "the raw secret never goes over the wire")
})

// ---------------------------------------------------------------- checkout context

const CHECKOUT_KEYS = ["v", "host", "page_url", "edge", "ip", "ua", "vid", "sid", "src", "camp", "fbp", "fbc", "ttp", "ttclid",
  "gclid", "gbraid", "wbraid", "country", "device", "audience", "new", "staff", "optout", "consent_version"]

function loadCheckout({ env = {}, headers = {}, cookies = {}, config } = {}) {
  const reads = { headers: 0, cookies: 0 }
  const nextHeaders = {
    headers: async () => { reads.headers += 1; return new Headers(headers) },
    cookies: async () => { reads.cookies += 1; return { getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })) } },
  }
  const loader = serverLoader({
    env,
    stubs: { "next/headers": nextHeaders },
    globals: { fetch: async () => ({ ok: true, json: async () => ({ config }) }) },
  })
  return { module: loader.load("lib/tracking/server/checkout-context.ts"), reads }
}

const decode = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"))

function loadBackendContract() {
  const file = path.join(root, "../backend/src/lib/tracking/contract.ts")
  const exports = {}
  vm.runInNewContext(`(function (exports) {${compile(file)}\n})`, { URLSearchParams })(exports)
  return exports
}

const EDGE_HEADERS = {
  host: "new.florayn.com", "x-florayn-edge": EDGE, "cf-connecting-ip": "2001:db8::7", "cf-ipcountry": "BD",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "x-forwarded-for": "198.51.100.9",
}
const SHOPPER = {
  _fl_vid: "v1.1790467200.0123456789abcdef", _fl_sid: "s1.1790467200.01234567",
  _fl_src: Buffer.from(JSON.stringify({ s: "meta_paid", c: "sept-sale", k: "0123abcd" })).toString("base64url"),
  _fbp: "fb.1.1790467200000.1234567890", _fbc: "fb.1.1790467200000.IwAR0abc", _ttp: "ttp-1", ttclid: "E.C.P.abc",
  _fl_gclid: Buffer.from(JSON.stringify({ k: "wbraid", v: "1BBBB", t: 1790467200 })).toString("base64url"),
  fl_audience: "men",
}

test("checkoutTrackingHeaders returns null only without the secret", async () => {
  for (const secret of [undefined, "short"]) {
    const { module, reads } = loadCheckout({ env: { TRACKING_INGEST_SECRET: secret }, headers: EDGE_HEADERS, cookies: SHOPPER })
    assert.equal(await module.checkoutTrackingHeaders(), null)
    assert.deepEqual(reads, { headers: 0, cookies: 0 })
  }
  const { module } = loadCheckout({ headers: {}, cookies: {} })
  const bare = await module.checkoutTrackingHeaders()
  assert.ok(bare, "a request with nothing still sends a context")
  assert.equal(bare["x-florayn-ingest-key"], vectors.keys.ingest)
  const context = decode(bare["x-florayn-tracking"])
  assert.deepEqual(Object.keys(context), CHECKOUT_KEYS)
  assert.equal(context.edge, false)
  assert.equal(context.vid, null)
  assert.equal(module.checkoutTrackingHeaders.length, 0, "takes no arguments from the Server Action")
  assert.equal(module.icEventId(vectors.keys.ic.cart_id), vectors.keys.ic.id, "icEventId is re-exported for the checkout page")
})

test("checkoutTrackingHeaders builds the 4.4 context from headers() and cookies() only", async () => {
  const config = { privacy: { share: false, consent_version: 4, consent_text: "" } }
  const { module, reads } = loadCheckout({ headers: EDGE_HEADERS, cookies: SHOPPER, config })
  const result = await module.checkoutTrackingHeaders()
  assert.deepEqual(reads, { headers: 1, cookies: 1 })
  assert.deepEqual(Object.keys(result), ["x-florayn-ingest-key", "x-florayn-tracking"])
  const context = decode(result["x-florayn-tracking"])
  assert.deepEqual(context, {
    v: 1, host: "new.florayn.com", page_url: "https://new.florayn.com/checkout/", edge: true, ip: "2001:db8::7",
    ua: EDGE_HEADERS["user-agent"], vid: SHOPPER._fl_vid, sid: SHOPPER._fl_sid, src: "meta_paid", camp: "sept-sale",
    fbp: SHOPPER._fbp, fbc: SHOPPER._fbc, ttp: "ttp-1", ttclid: "E.C.P.abc", gclid: null, gbraid: null, wbraid: "1BBBB",
    country: "BD", device: "mobile", audience: "men", new: true, staff: false, optout: false, consent_version: null,
  })
  const backend = loadBackendContract()
  assert.deepEqual(plain(backend.parseCheckoutContext(context)), context, "the backend parser keeps every value")

  const source = fs.readFileSync(path.join(serverDir, "checkout-context.ts"), "utf8")
  assert.doesNotMatch(source, /^["']use server["']/m, "not a Server Action file")
  assert.deepEqual([...source.matchAll(/from "(next\/[^"]+)"/g)].map((match) => match[1]), ["next/headers"])
})

test("the checkout context carries a consent version only when the consent line is shown", async () => {
  const version = async (privacy) => {
    const { module } = loadCheckout({ headers: EDGE_HEADERS, cookies: SHOPPER, config: { privacy } })
    return decode((await module.checkoutTrackingHeaders())["x-florayn-tracking"]).consent_version
  }
  // Sharing on with a sentence: the line renders under Place order, so its version goes.
  assert.equal(await version({ share: true, consent_version: 4, consent_text: "We send hashed contact details." }), 4)
  // No line on screen: sharing off, or on without a sentence. The backend then never hashes this order's contact details.
  assert.equal(await version({ share: false, consent_version: 4, consent_text: "We send hashed contact details." }), null)
  assert.equal(await version({ share: true, consent_version: 4, consent_text: "   " }), null)
  assert.equal(await version(undefined), null, "the all-off defaults")
})

test("staff, opted-out and edge-less checkouts keep their flags", async () => {
  const staff = await loadCheckout({
    headers: { ...EDGE_HEADERS, "x-florayn-edge": "wrong".padEnd(40, "x") },
    cookies: { ...SHOPPER, _fl_staff: vectors.keys.staff_cookie, _fl_optout: "1" },
  }).module.checkoutTrackingHeaders()
  const context = decode(staff["x-florayn-tracking"])
  assert.equal(context.edge, false)
  assert.equal(context.ip, null, "no edge, no IP (X-Forwarded-For is never read)")
  assert.equal(context.country, null)
  assert.equal(context.staff, true)
  assert.equal(context.optout, true)
  assert.equal(context.vid, SHOPPER._fl_vid, "the backend decides; the context still goes")
  const forged = decode((await loadCheckout({ headers: EDGE_HEADERS, cookies: { _fl_staff: "0".repeat(64) } })
    .module.checkoutTrackingHeaders())["x-florayn-tracking"])
  assert.equal(forged.staff, false)
  const returning = decode((await loadCheckout({ headers: EDGE_HEADERS, cookies: { ...SHOPPER, _fl_vid: "v1.1790000000.0123456789abcdef", fl_audience: "x" } })
    .module.checkoutTrackingHeaders())["x-florayn-tracking"])
  assert.equal(returning.new, false)
  assert.equal(returning.audience, null)
})

test("the tracking header stays under 4 KB and drops over-cap values", async () => {
  const huge = {
    ...SHOPPER,
    _fbc: `fb.1.1790467200000.${"F".repeat(575)}`,
    ttclid: "T".repeat(1000),
    _ttp: "p".repeat(100),
    _fl_gclid: Buffer.from(JSON.stringify({ k: "gclid", v: "G".repeat(300), t: 1 })).toString("base64url"),
    _fl_src: Buffer.from(JSON.stringify({ s: "x".repeat(40), c: "c".repeat(80), k: "" })).toString("base64url"),
  }
  const { module } = loadCheckout({ headers: { ...EDGE_HEADERS, host: `${"h".repeat(190)}.florayn.com`, "user-agent": "U".repeat(600) }, cookies: huge })
  const result = await module.checkoutTrackingHeaders()
  assert.ok(result["x-florayn-tracking"].length <= 4096, `${result["x-florayn-tracking"].length} chars`)
  const context = decode(result["x-florayn-tracking"])
  assert.equal(context.ua.length, 400)
  assert.equal(context.host, null, "a host over 100 chars is dropped")
  assert.equal(context.page_url, null, "and a page_url over 200")
  assert.equal(context.vid, SHOPPER._fl_vid, "ids survive the shedding")
  assert.equal(context.sid, SHOPPER._fl_sid)

  const encoded = module.encodeTrackingHeader({
    v: 1, host: "new.florayn.com", page_url: "https://new.florayn.com/checkout/", edge: true, ip: "203.0.113.7",
    ua: "U".repeat(400), vid: SHOPPER._fl_vid, sid: SHOPPER._fl_sid, src: "x".repeat(40), camp: "c".repeat(80),
    fbp: "f".repeat(120), fbc: "c".repeat(600), ttp: "t".repeat(100), ttclid: "T".repeat(1000), gclid: "g".repeat(300),
    gbraid: "b".repeat(300), wbraid: "w".repeat(300), country: "BD", device: "mobile", audience: "women",
    new: true, staff: false, optout: false, consent_version: 1,
  })
  assert.ok(encoded.length <= 4096)
  const shed = decode(encoded)
  assert.equal(shed.ttp, null, "the least useful values go first")
  assert.equal(shed.vid, SHOPPER._fl_vid)
  assert.equal(shed.ip, "203.0.113.7")
})
