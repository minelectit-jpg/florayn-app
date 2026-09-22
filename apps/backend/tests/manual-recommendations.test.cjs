const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const loaded = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/manual-recommendations.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: loaded, require: () => ({ ContainerRegistrationKeys: { QUERY: "query" } }) })
test("manual recommendations preserve two independent ordered lists and reject invalid or excessive selections", () => {
  const settings = { recommended: ["variant_b", "variant_a"], featured: ["variant_a"] }
  assert.equal(JSON.stringify(loaded.manualRecommendations(settings)), JSON.stringify(settings))
  for (const invalid of [null, {}, { recommended: ["variant_a", "variant_a"], featured: [] }, { recommended: ["prod_bad"], featured: [] }, { recommended: Array.from({ length: 9 }, (_, i) => "variant_" + i), featured: [] }]) assert.throws(() => loaded.manualRecommendations(invalid))
  assert.equal(JSON.stringify(loaded.readManualRecommendations(null)), '{"recommended":[],"featured":[]}')
})
