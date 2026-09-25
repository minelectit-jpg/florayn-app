const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const source = fs.readFileSync(path.join(__dirname, "../src/lib/device-order.ts"), "utf8")
const lib = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: lib })
const { compareModelNames, sortNewestFirst } = lib
const plain = (value) => JSON.parse(JSON.stringify(value))

test("both apps share the same model order", () => {
  assert.equal(source, fs.readFileSync(path.join(__dirname, "../../storefront/src/lib/device-order.ts"), "utf8"))
})

test("iPhones run newest first: 17, then 16, then 15, with the bigger model leading each generation", () => {
  const seeded = ["iPhone 11", "iPhone 11 Pro", "iPhone 11 Pro Max", "iPhone 12 Mini", "iPhone 12", "iPhone 12 Pro", "iPhone 12 Pro Max", "iPhone 13 Mini", "iPhone 13", "iPhone 13 Pro", "iPhone 13 Pro Max", "iPhone 14", "iPhone 14 Plus", "iPhone 14 Pro", "iPhone 14 Pro Max", "iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max", "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 17", "iPhone 17 Air", "iPhone 17 Pro", "iPhone 17 Pro Max"]
  const sorted = [...seeded].sort(compareModelNames)
  assert.deepEqual(sorted.slice(0, 5), ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air", "iPhone 17", "iPhone 16 Pro Max"])
  assert.deepEqual(sorted.slice(-7), ["iPhone 12 Pro Max", "iPhone 12 Pro", "iPhone 12", "iPhone 12 Mini", "iPhone 11 Pro Max", "iPhone 11 Pro", "iPhone 11"])
  assert.deepEqual(sorted.filter((n) => n.startsWith("iPhone 14")), ["iPhone 14 Pro Max", "iPhone 14 Pro", "iPhone 14 Plus", "iPhone 14"])
  // A device added later goes to the top on its own.
  assert.equal(["iPhone 17 Pro Max", "iPhone 18 Pro", "iPhone 16e"].sort(compareModelNames)[0], "iPhone 18 Pro")
  assert.deepEqual(["iPhone 16e", "iPhone 16", "iPhone 16 Plus"].sort(compareModelNames), ["iPhone 16 Plus", "iPhone 16", "iPhone 16e"])
})

test("Samsung and AirPods follow their numbers; names without one keep their place last", () => {
  assert.deepEqual(["Samsung S23", "Samsung S26", "Samsung S26 Ultra", "Samsung S26 Plus", "Samsung S24 FE"].sort(compareModelNames), ["Samsung S26 Ultra", "Samsung S26 Plus", "Samsung S26", "Samsung S24 FE", "Samsung S23"])
  assert.deepEqual(["AirPods 1/2", "AirPods Pro", "AirPods Pro 3", "AirPods 4"].sort(compareModelNames), ["AirPods 4", "AirPods Pro 3", "AirPods 1/2", "AirPods Pro"])
  const rows = [{ n: "Card Wallet", g: "Wallets" }, { n: "iPhone 15", g: "iPhone" }, { n: "MagSafe Wallet", g: "Wallets" }, { n: "iPhone 17", g: "iPhone" }, { n: "Samsung S25", g: "Samsung" }]
  assert.deepEqual(plain(sortNewestFirst(rows, (r) => r.n, (r) => r.g).map((r) => r.n)), ["Card Wallet", "MagSafe Wallet", "iPhone 17", "iPhone 15", "Samsung S25"], "families keep their first-seen place; unnumbered names keep theirs")
})
