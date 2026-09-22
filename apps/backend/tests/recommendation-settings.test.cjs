const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const filename = path.join(__dirname, "../src/lib/recommendation-settings.ts")
const loaded = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: loaded, require: () => ({ Modules: { STORE: "store" } }) })
const { validateRecommendationSettings, recommendationSettings, RECOMMENDATION_DEFAULTS } = loaded
const devices = [{ id: "phone", name: "iPhone 18 Pro Max", family: "iphone", is_active: true }, { id: "air", name: "AirPods Pro 4", family: "airpods", is_active: true }, { id: "max", name: "AirPods Max", family: "airpods", is_active: true }]
const types = [{ name: "Signature", devices: [devices[0]] }, { name: "Signature Earbuds", devices: devices.slice(1) }]
const input = { ...RECOMMENDATION_DEFAULTS, phone_model: devices[0].name, airpods_model: devices[1].name }
test("dynamic active models and AirPods Max share validated category settings", () => {
  assert.equal(validateRecommendationSettings(input, devices, types).phone_model, "iPhone 18 Pro Max")
  assert.equal(validateRecommendationSettings({ ...input, airpods_model: "AirPods Max" }, devices, types).airpods_case_type, "Signature Earbuds")
})
test("wrong family, incompatible case types, inactive and absent models cannot be saved", () => {
  for (const patch of [{ airpods_model: "iPhone 18 Pro Max" }, { phone_case_type: "Signature Earbuds" }, { phone_model: "missing" }, { phone_model: "" }]) assert.throws(() => validateRecommendationSettings({ ...input, ...patch }, devices, types))
  assert.throws(() => validateRecommendationSettings(input, devices.map(d => ({ ...d, is_active: false })), types))
})
test("existing bundle preference is retained until new matching defaults are saved", () => {
  assert.equal(recommendationSettings(null, "AirPods Pro 2").airpods_model, "AirPods Pro 2")
  assert.equal(recommendationSettings({ airpods_model: "AirPods Pro 4" }, "AirPods Pro 2").airpods_model, "AirPods Pro 4")
})
