const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const file = path.join(__dirname, "../src/lib/product-view-data.ts")
const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exported = {}
vm.runInNewContext(code, { exports: exported, require: (name) => {
  if (name === "@/lib/variant-matrix") return { pairKey: (ct, dev) => `${ct}|${dev}` }
  throw new Error(name)
} })
test("Color and Size combinations retain every exact variant ID in the shared product-page matrix", () => {
  const product = { options: [{ id: "color", title: "Color" }, { id: "size", title: "Size" }], variants: [
    { id: "black-small", options: [{ option_id: "color", value: "Black" }, { option_id: "size", value: "S" }] },
    { id: "black-large", options: [{ option_id: "color", value: "Black" }, { option_id: "size", value: "L" }] },
  ] }
  const result = exported.buildSimpleMatrix(product)
  assert.equal(result.values.length, 2)
  assert.equal(result.optionTitle, "Color / Size")
  assert.equal(result.matrix.variantIdByPair["Color: Black / Size: S|"], "black-small")
  assert.equal(result.matrix.variantIdByPair["Color: Black / Size: L|"], "black-large")
  assert.equal(Object.values(result.matrix.variantIdByPair).includes("white-large"), false)
})
test("single products still use one selectable default variant and no device selector data", () => {
  const result = exported.buildSimpleMatrix({ variants: [{ id: "single", title: "Default" }] })
  assert.equal(result.values.length, 1)
  assert.equal(result.matrix.variantIdByPair["Default|"], "single")
  assert.equal(result.matrix.devices[0], "")
})
