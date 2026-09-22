const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
function load(file, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, process: { env: {} }, URLSearchParams, ...globals })
  return exports
}
test("savings badge respects real clamps and never rounds above the offer", () => {
  const { savingsPercent, tierPricing } = load("bundles.ts")
  assert.equal(savingsPercent([tierPricing(1400, { quantity: 3, discount_amount: 800, min_pct: 0, max_pct: 20 })]), 19)
  assert.equal(savingsPercent([{ subtotal: 2250, discount: 450 }]), 20)
  assert.equal(savingsPercent([{ subtotal: 0, discount: 100 }, { subtotal: 100, discount: NaN }]), 0)
})
test("manual lists fetch only chosen IDs with regional prices and preserve exact image, link and section order", async () => {
  const calls = []
  const variants = ["a", "b"].map((id, i) => ({ id: "variant_" + id, title: "Option " + id, metadata: { images: ["image-" + id] }, calculated_price: { calculated_amount: 500 + i }, product: { id: "prod_" + id, title: "Product " + id, handle: id, thumbnail: "fallback" } }))
  const { getManualRecommendations } = load("manual-recommendations.ts", {
    require: () => ({ getRegionId: async () => "reg_bd", MEDUSA_BACKEND_URL: "http://fixture", MEDUSA_PUBLISHABLE_KEY: "pk_fixture" }),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ variants }) } },
  })
  assert.equal((await getManualRecommendations({})).recommended.length, 0)
  assert.equal(calls.length, 0)
  const result = await getManualRecommendations({ florayn_manual_recommendations: { recommended: ["variant_b", "variant_a"], featured: ["variant_a", "variant_missing"] } })
  assert.deepEqual(Array.from(result.recommended, (v) => v.id), ["variant_b", "variant_a"])
  assert.equal(result.featured.length, 1)
  assert.equal(result.featured[0].variants[0].image, "image-a")
  assert.equal(result.featured[0].price, 500)
  assert.equal(result.featured[0].variants[0].href, "/product/a/?variant=variant_a")
  assert.match(calls[0].url, /region_id=reg_bd/)
  assert.match(calls[0].url, /limit=3/)
  assert.deepEqual(Array.from(calls[0].options.next.tags), ["products"])
})
