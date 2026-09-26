// Hash helpers for the ad platforms (lib/tracking/hash.ts) against the
// TRACKING.md Appendix C "hashes" vectors. The vectors are inlined on purpose:
// this suite must not depend on the shared fixture file.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")

// Transpiles a TS file and runs it in a vm sandbox; relative imports load the
// real neighbouring files, node:crypto is the only bare import allowed.
function makeLoader() {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(
      code,
      {
        exports,
        require: (name) => {
          if (name === "node:crypto") return crypto
          if (name.startsWith(".")) return loadFile(path.resolve(path.dirname(filename), `${name}.ts`))
          throw new Error(`Unexpected import ${name}`)
        },
      },
      { filename }
    )
    return exports
  }
  return (file) => loadFile(path.join(SRC, file))
}

const hash = makeLoader()("lib/tracking/hash.ts")
const HEX64 = /^[0-9a-f]{64}$/

// TRACKING.md Appendix C, "hashes" (verbatim).
const VECTORS = {
  meta_phone: [["01712345678", "8801712345678"], ["+880 1712-345678", "8801712345678"], ["8801712345678", "8801712345678"], ["12345", null]],
  sha256: {
    "8801712345678": "c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1",
    "+8801712345678": "650037f77977759c37e1a76c2e101bc1957b7f52f9567ecaa65a35586e05c08c",
    "dhaka": "de90643718108ec9a93cc6905f2b976297505a8abeac37b747132877fb32fb8d",
    "coxsbazar": "43dea41fc4e7f595cead44b14c4bfb1033a9af49026171bfc5b03a66b290ad37",
    "bd": "5e657ff6158d3e2a6d23e2a523917a2305acee9423365e268695c4b7b8919f4c",
    "md": "21262a3cb5337627b0fad9d891c16adb40706bd3e57534416dd02bbe5917d184",
    "shamim": "7d106eadf8eb2a503f5e46747f14ea252c024f8d23c162cfc3c77b498820452e",
    "mdshamim": "73d26e9dd7f6168bf46146cb39b2c4f1a8ddce6ce2c34d101c81855fb44f0258",
    "test@example.com": "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
    "johnsmith@gmail.com": "3586de92bb3636d0885a12eff961429a32e4ebd764b96f50d85d016f9338d586",
    "v1.1790467200.0123456789abcdef": "202f3b44f612b759b9abad5e5482e957203086352986edc2cb5ddae91847fdbd",
  },
  norm_city: [["Dhaka", "dhaka"], ["Cox's Bazar", "coxsbazar"]],
  meta_name: [["Md Shamim", "mdshamim"], [" MD. ", "md"]],
  norm_email: [["  Test@Example.com ", "test@example.com"], ["01712345678@no-email.florayn.local", null], ["not-an-email", null]],
  google_email: [["John.Smith@gmail.com", "johnsmith@gmail.com"], ["John.Smith@example.com", "john.smith@example.com"]],
}

// Every hash any test below produced, checked for shape at the end.
const produced = []
function sha(value) {
  const out = hash.sha256Hex(value)
  if (out !== null) produced.push(out)
  return out
}

test("sha256 vectors: every listed string hashes to the listed lowercase hex", () => {
  for (const [input, expected] of Object.entries(VECTORS.sha256)) {
    assert.equal(sha(input), expected, input)
    assert.equal(sha(input), crypto.createHash("sha256").update(input, "utf8").digest("hex"), input)
  }
})

test("meta_phone vectors: any BD mobile form becomes 8801XXXXXXXXX, junk is null", () => {
  for (const [input, expected] of VECTORS.meta_phone) assert.equal(hash.metaPhone(input), expected, input)
  assert.equal(sha(hash.metaPhone("01712345678")), VECTORS.sha256["8801712345678"])
  assert.equal(sha(hash.metaPhone("+880 1712-345678")), VECTORS.sha256["8801712345678"])
})

test("e164Phone adds the plus TikTok and Google want; its hash matches the vector", () => {
  assert.equal(hash.e164Phone("01712345678"), "+8801712345678")
  assert.equal(hash.e164Phone("8801712345678"), "+8801712345678")
  assert.equal(hash.e164Phone("12345"), null)
  assert.equal(sha(hash.e164Phone("01712345678")), VECTORS.sha256["+8801712345678"])
  // Meta's and TikTok/Google's phone hashes differ on purpose.
  assert.notEqual(sha(hash.metaPhone("01712345678")), sha(hash.e164Phone("01712345678")))
})

test("norm_city vectors and their hashes", () => {
  for (const [input, expected] of VECTORS.norm_city) {
    assert.equal(hash.normCity(input), expected, input)
    assert.equal(sha(hash.normCity(input)), VECTORS.sha256[expected], input)
  }
})

test("meta_name vectors and their hashes (all whitespace and punctuation removed)", () => {
  for (const [input, expected] of VECTORS.meta_name) {
    assert.equal(hash.metaName(input), expected, input)
    assert.equal(sha(hash.metaName(input)), VECTORS.sha256[expected], input)
  }
  assert.equal(sha(hash.metaName("Shamim")), VECTORS.sha256.shamim)
  // NFC: a decomposed accent hashes like the composed one.
  assert.equal(hash.metaName("José"), "josé")
  assert.equal(hash.metaName("José"), "josé")
  // Bengali letters and their vowel signs survive; the space does not.
  assert.equal(hash.metaName("মো শামীম"), "মোশামীম")
})

test("norm_email vectors: trimmed and lowercased, the checkout placeholder and junk are null", () => {
  for (const [input, expected] of VECTORS.norm_email) assert.equal(hash.normEmail(input), expected, input)
  assert.equal(sha(hash.normEmail("  Test@Example.com ")), VECTORS.sha256["test@example.com"])
  assert.equal(sha(hash.normEmail("01712345678@no-email.florayn.local")), null)
})

test("google_email vectors: dots dropped from the local part only for gmail/googlemail", () => {
  for (const [input, expected] of VECTORS.google_email) assert.equal(hash.googleEmail(input), expected, input)
  assert.equal(sha(hash.googleEmail("John.Smith@gmail.com")), VECTORS.sha256["johnsmith@gmail.com"])
  assert.equal(hash.googleEmail("j.o.h.n@GoogleMail.com"), "john@googlemail.com")
  assert.equal(hash.googleEmail("01712345678@no-email.florayn.local"), null)
})

test("the visitor id hashes to the external_id vector", () => {
  assert.equal(sha("v1.1790467200.0123456789abcdef"), VECTORS.sha256["v1.1790467200.0123456789abcdef"])
})

test("plainName keeps single spaces and drops punctuation (Google names)", () => {
  assert.equal(hash.plainName("  Md.   Shamim "), "md shamim")
  assert.equal(hash.plainName("O'Brien-Smith"), "obriensmith")
  assert.equal(hash.plainName("Md"), "md")
  assert.equal(sha(hash.plainName(" MD ")), VECTORS.sha256.md)
})

test("every helper returns null for empty or missing input", () => {
  for (const empty of ["", null, undefined]) {
    assert.equal(hash.sha256Hex(empty), null)
    assert.equal(hash.metaPhone(empty), null)
    assert.equal(hash.e164Phone(empty), null)
    assert.equal(hash.metaName(empty), null)
    assert.equal(hash.normCity(empty), null)
    assert.equal(hash.plainName(empty), null)
    assert.equal(hash.normEmail(empty), null)
    assert.equal(hash.googleEmail(empty), null)
  }
  // Nothing left after normalising is empty too.
  assert.equal(hash.metaName(" .. "), null)
  assert.equal(hash.normCity(" ' "), null)
  assert.equal(hash.plainName(" - "), null)
  assert.equal(hash.metaName(42), null)
})

test("isSha256Hex accepts only 64 lowercase hex (a Parameter Builder suffix is rejected)", () => {
  const good = VECTORS.sha256.bd
  assert.equal(hash.isSha256Hex(good), true)
  assert.equal(hash.isSha256Hex(`${good}.AQQCAQMC`), false)
  assert.equal(hash.isSha256Hex(good.toUpperCase()), false)
  assert.equal(hash.isSha256Hex(good.slice(1)), false)
  assert.equal(hash.isSha256Hex(null), false)
  assert.equal(hash.isSha256Hex(123), false)
})

test("every hash produced above is 64 lowercase hex", () => {
  assert.ok(produced.length >= 20)
  for (const out of produced) assert.match(out, HEX64)
})

test("hash.ts imports only node:crypto and the contact helpers", () => {
  const source = fs.readFileSync(path.join(SRC, "lib/tracking/hash.ts"), "utf8")
  const specifiers = [...source.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1])
  assert.deepEqual(specifiers.sort(), ["../contact", "node:crypto"])
})
