const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const filename = path.join(__dirname, "../src/lib/product-recommendations.ts")
const exportsForTest = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsForTest })
const { recommendationItem, recommendationVariants, designHandle, DEFAULT_RECOMMENDATIONS } = exportsForTest
const variant = (model, type, price) => ({ id: `${model}-${type}`, options: [{ option_id: "model", value: model }, { option_id: "case", value: type }], calculated_price: { calculated_amount: price }, metadata: { images: [`https://image.invalid/${model}-${type}.webp`] } })
const product = (form, variants) => ({ id: form, handle: designHandle("bloom", form), title: "Bloom", thumbnail: "https://wrong.invalid/old-phone.webp", metadata: { form, design_slug: "bloom" }, options: [{ id: "model", title: "Device" }, { id: "case", title: "Case Type" }], variants })

test("design names ending in a form name retain their complete slug", () => {
  assert.equal(designHandle("night-watch", "phone"), "night-watch")
  assert.equal(designHandle("night-watch", "airpods"), "night-watch-airpods")
})

test("AirPods Max and every AirPods model remain variants of one AirPods product", () => {
  const item = recommendationItem(product("airpods", [variant("AirPods Max", "Signature Earbuds", 750), variant("AirPods Pro 3", "Signature Earbuds", 750)]), DEFAULT_RECOMMENDATIONS)
  assert.equal(item.handle, "bloom-airpods")
  assert.equal(item.variants[0].label, "AirPods Pro 3")
  assert.deepEqual(Array.from(item.variants, v => v.label).sort(), ["AirPods Max", "AirPods Pro 3"])
  assert.match(item.thumbnail, /AirPods Pro 3-Signature Earbuds/)
})
test("matching phone defaults use the configured model and construction with exact image, price and variant", () => {
  const p = product("phone", [variant("iPhone 12", "Signature", 1400), variant("iPhone 17 Pro Max", "Signature", 1400), variant("iPhone 17 Pro Max", "Armor Black", 1950)])
  const item = recommendationItem(p, { ...DEFAULT_RECOMMENDATIONS, phone_case_type: "Armor Black" })
  assert.equal(item.formLabel, "Phone Case")
  assert.equal(item.variants[0].id, "iPhone 17 Pro Max-Armor Black")
  assert.equal(item.price, 1950)
  assert.match(item.thumbnail, /iPhone 17 Pro Max-Armor Black/)
  assert.equal(item.variants[0].href, "/product/bloom-iphone-17-pro-max/?case=armor-black")
})
test("new models are chosen from admin preferences without another hard-coded model list", () => {
  const p = product("airpods", [variant("AirPods Pro 3", "Signature Earbuds", 750), variant("AirPods Pro 4", "Signature Earbuds", 850)])
  assert.equal(recommendationVariants(p, { ...DEFAULT_RECOMMENDATIONS, airpods_model: "AirPods Pro 4" })[0].label, "AirPods Pro 4")
  const phone = product("phone", [variant("iPhone 17 Pro Max", "Signature", 1400), variant("iPhone 18 Pro Max", "Signature", 1450)])
  assert.equal(recommendationVariants(phone, { ...DEFAULT_RECOMMENDATIONS, phone_model: "iPhone 18 Pro Max" })[0].price, 1450)
})
test("unavailable defaults fall back to an actual priced model and never the product-level phone thumbnail", () => {
  const item = recommendationItem(product("airpods", [variant("AirPods Max", "Signature Earbuds", 750)]), DEFAULT_RECOMMENDATIONS)
  assert.equal(item.variants[0].label, "AirPods Max")
  assert.match(item.thumbnail, /AirPods Max/)
  assert.equal(recommendationItem(product("airpods", [variant("AirPods Max", "Signature Earbuds", 0)]), DEFAULT_RECOMMENDATIONS), null)
})
