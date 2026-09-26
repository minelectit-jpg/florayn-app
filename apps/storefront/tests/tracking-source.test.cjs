const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/server/source.ts against Appendix C `source` (TRACKING.md 6.7):
// the session source class decided once per session from the landing.
const root = path.join(__dirname, "..")
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function load() {
  const context = vm.createContext({ URL })
  const run = (file, modules) => {
    const exports = {}
    const require = (name) => {
      if (name in modules) return modules[name]
      throw new Error(`Unexpected import ${name} in ${file}`)
    }
    vm.runInContext(`(function (exports, require) {${compile(file)}\n})`, context, { filename: file })(exports, require)
    return exports
  }
  const guard = run("src/lib/tracking/server/guard.ts", {})
  return run("src/lib/tracking/server/source.ts", { "./guard": guard })
}

const { classifySource } = load()
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/tracking-vectors.json"), "utf8"))
const plain = (value) => JSON.parse(JSON.stringify(value))
const HOST = "new.florayn.com"
const UA = "Mozilla/5.0"

test("every Appendix C source vector", () => {
  assert.ok(vectors.source.length >= 17)
  for (const vector of vectors.source) {
    const { expect, ...input } = vector
    assert.deepEqual(plain(classifySource(input)), expect, JSON.stringify(input))
  }
})

test("fbclid without utm is meta, not meta_paid", () => {
  assert.deepEqual(plain(classifySource({ q: { fbclid: "AbC" }, ref: null, ua: UA, host: HOST })), { src: "meta", camp: null })
  assert.equal(classifySource({ q: { fbclid: "AbC", utm_source: "facebook", utm_medium: "paid" }, ref: null, ua: UA, host: HOST }).src,
    "meta_paid", "only a paid utm_medium makes it paid")
  assert.equal(classifySource({ q: { fbclid: "AbC", utm_medium: "social" }, ref: null, ua: UA, host: HOST }).src, "meta")
})

test("the first matching rule wins", () => {
  const all = { ttclid: "T", gclid: "G", fbclid: "F", utm_source: "facebook", utm_medium: "paid" }
  assert.equal(classifySource({ q: all, ref: "https://l.facebook.com", ua: UA, host: HOST }).src, "tiktok_paid")
  assert.equal(classifySource({ q: { gbraid: "G", fbclid: "F" }, ref: null, ua: UA, host: HOST }).src, "google_paid")
  assert.equal(classifySource({ q: { utm_source: "google", utm_medium: "CPC", fbclid: "F" }, ref: null, ua: UA, host: HOST }).src, "google_paid")
  assert.equal(classifySource({ q: {}, ref: "https://www.tiktok.com", ua: "Mozilla/5.0 [FBAN/FBIOS]", host: HOST }).src, "meta",
    "the Facebook in-app browser beats a TikTok referrer (rule 4 before rule 5)")
  assert.equal(classifySource({ q: {}, ref: "https://www.google.com.bd", ua: "WhatsApp/2.23", host: HOST }).src, "google_organic")
})

test("paid sources are slugs of utm_source", () => {
  const paid = (utmSource) => classifySource({ q: { utm_source: utmSource, utm_medium: "ppc" }, ref: null, ua: UA, host: HOST }).src
  for (const name of ["facebook", "FB", "instagram", "ig", "Meta"]) assert.equal(paid(name), "meta_paid", name)
  assert.equal(paid("TikTok"), "tiktok_paid")
  assert.equal(paid("Google"), "google_paid")
  assert.equal(paid(""), "unknown_paid")
  assert.equal(paid("!!!"), "unknown_paid")
  assert.equal(paid("a".repeat(50)), `${"a".repeat(30)}_paid`, "cut to 30 chars")
  assert.equal(paid("Sept_Promo-2"), "sept_promo-2_paid")
  assert.equal(classifySource({ q: { utm_source: "x", utm_medium: "PaidSocial" }, ref: null, ua: UA, host: HOST }).src, "x_paid")
  assert.equal(classifySource({ q: { utm_source: "x", utm_medium: "email" }, ref: null, ua: UA, host: HOST }).src, "direct")
})

test("referrers: only the host matters, and our own host is direct", () => {
  const from = (ref, host = HOST) => classifySource({ q: {}, ref, ua: UA, host }).src
  assert.equal(from("https://m.facebook.com"), "meta")
  assert.equal(from("https://www.instagram.com"), "meta")
  assert.equal(from("https://notfacebook.com"), "referral")
  assert.equal(from("https://facebook.com.evil.example"), "referral")
  assert.equal(from("https://vm.tiktok.com"), "tiktok")
  assert.equal(from("https://wa.me"), "messaging")
  assert.equal(from("https://www.messenger.com"), "messaging")
  assert.equal(from("https://NEW.florayn.com"), "direct")
  assert.equal(from("https://www.florayn.com", "florayn.com"), "direct", "www and the bare host are the same site")
  assert.equal(from("https://florayn.com", "new.florayn.com:443"), "referral")
  assert.equal(from("not a url"), "direct")
  assert.equal(from("javascript:alert(1)"), "direct")
  assert.equal(from(""), "direct")
  assert.equal(classifySource({ q: {}, ref: null, ua: "Mozilla/5.0 BytedanceWebview/d8a21c6", host: HOST }).src, "tiktok")
  assert.equal(classifySource({ q: {}, ref: null, ua: "Mozilla/5.0 Instagram 300.0", host: HOST }).src, "meta")
  assert.equal(classifySource({ q: {}, ref: null, ua: null, host: HOST }).src, "direct")
})

test("campaign is utm_campaign up to 80 chars, whatever the source", () => {
  assert.equal(classifySource({ q: { utm_campaign: "sept-sale" }, ref: null, ua: UA, host: HOST }).camp, "sept-sale")
  assert.equal(classifySource({ q: { utm_campaign: "c".repeat(120), ttclid: "T" }, ref: null, ua: UA, host: HOST }).camp, "c".repeat(80))
  assert.equal(classifySource({ q: { utm_campaign: "" }, ref: null, ua: UA, host: HOST }).camp, null)
  assert.equal(classifySource({ q: null, ref: null, ua: UA, host: HOST }).camp, null)
})
