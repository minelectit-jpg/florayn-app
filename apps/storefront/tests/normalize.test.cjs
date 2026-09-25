const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/lib/search/normalize.ts")
const lib = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: lib })
const { tokenize, matchesModel, compileSynonyms, modelTokens } = lib
const plain = (v) => JSON.parse(JSON.stringify(v))

test("typing shortcuts meet the model name halfway", () => {
  assert.deepEqual(plain(tokenize("iPhone15ProMax")), ["iphone", "15", "pro", "max"])
  assert.deepEqual(plain(tokenize("15pm")), ["15", "pro", "max"])
  assert.deepEqual(plain(tokenize("s24u")), ["s", "24", "ultra"])
  assert.deepEqual(plain(tokenize("S23+")), ["s", "23", "plus"])
  assert.deepEqual(plain(tokenize("AirPods 1/2")), ["airpod", "1/2"])
  assert.deepEqual(plain(tokenize("glass cases")), ["glass", "case"])
  assert.equal(matchesModel("iPhone 15 Pro Max", "15pm"), true)
  assert.equal(matchesModel("iPhone 15 Pro Max", "ip 15 promax"), true)
  assert.equal(matchesModel("Samsung S24 Ultra", "s24u"), true)
  assert.equal(matchesModel("Samsung S24 Ultra", "samsung 24 ultra"), true)
  assert.equal(matchesModel("Samsung S23 Plus", "s23+"), true)
  assert.equal(matchesModel("iPhone 17 Pro", "17 pr"), true, "the last word may be a prefix")
  assert.equal(matchesModel("iPhone 17 Air", "apple air"), true)
})

test("numbers never cross generations and brands never cross families", () => {
  assert.equal(matchesModel("iPhone 15", "16"), false)
  assert.equal(matchesModel("iPhone 16e", "15"), false)
  assert.equal(matchesModel("iPhone 15 Pro", "15 pro max"), false)
  assert.equal(matchesModel("iPhone 15", "samsung 15"), false)
  assert.equal(matchesModel("iPhone 15", "iphone 15 case"), true, "neutral words never block")
  assert.equal(matchesModel("iPhone 15", ""), true)
})

test("Bangla digits and words, and admin synonyms", () => {
  assert.equal(matchesModel("iPhone 15", "১৫"), true)
  const synonyms = compileSynonyms([[["আইফোন", "i phone", "ipone"], "iphone"], [["কভার", "back cover"], "case"]])
  assert.deepEqual(plain(tokenize("আইফোন ১৫ এর কভার", synonyms)).slice(0, 2), ["iphone", "15"])
  assert.equal(matchesModel("iPhone 15", "আইফোন ১৫", synonyms), true)
  assert.equal(matchesModel("iPhone 15 Pro", "i phone 15 pro back cover", synonyms), true)
  assert.equal(matchesModel("iPhone 13", "ipone 13", synonyms), true)
})

test("AirPods 1/2 answers to 1, 2 or 1/2", () => {
  assert.ok(modelTokens("AirPods 1/2").includes("2"))
  assert.equal(matchesModel("AirPods 1/2", "airpods 2"), true)
  assert.equal(matchesModel("AirPods 1/2", "1/2"), true)
})
