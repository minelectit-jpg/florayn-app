const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(relative) {
  const filename = path.join(__dirname, "../src", relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => name.startsWith("@/lib/") ? load(`lib/${name.slice(6)}.ts`) : require(name) })
  return exports
}
const { pickDefaultPhone } = load("lib/default-device.ts")

const iphones = ["iPhone 12", "iPhone 15 Pro Max", "iPhone 16", "iPhone 17", "iPhone 17 Pro", "iPhone 17 Pro Max"]
const samsungs = ["Samsung S25", "Samsung S26", "Samsung S26 Ultra"]
const catalog = [...iphones.map((name) => ({ name, family: "iphone" })), ...samsungs.map((name) => ({ name, family: "samsung" })), { name: "AirPods Pro 3", family: "airpods" }]
const everyCase = (devices) => Object.fromEntries(devices.map((d) => [d, ["Signature", "Armor"]]))

test("the base product page opens on the newest phone, whatever order the catalogue arrives in", () => {
  const devices = [...iphones, ...samsungs, "AirPods Pro 3"]
  assert.equal(pickDefaultPhone(devices, everyCase(devices), 2, catalog), "iPhone 17 Pro Max")
  assert.equal(pickDefaultPhone(devices, everyCase(devices), 2, [...catalog].reverse()), "iPhone 17 Pro Max")
})

test("it prefers the newest phone sold in every case type", () => {
  const devices = [...iphones]
  const byDevice = { ...everyCase(devices), "iPhone 17 Pro Max": ["Signature"] }
  assert.equal(pickDefaultPhone(devices, byDevice, 2, catalog), "iPhone 17 Pro")
  // With no phone in every case type, still the newest phone.
  assert.equal(pickDefaultPhone(devices, Object.fromEntries(devices.map((d) => [d, ["Signature"]])), 2, catalog), "iPhone 17 Pro Max")
})

test("a Samsung-only design opens on the newest Samsung; no phone falls back to the first device", () => {
  assert.equal(pickDefaultPhone(samsungs, everyCase(samsungs), 2, catalog), "Samsung S26 Ultra")
  assert.equal(pickDefaultPhone(["AirPods Pro 3"], everyCase(["AirPods Pro 3"]), 2, catalog), "AirPods Pro 3")
})
