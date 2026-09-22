const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
function load(file, deps = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, require: (name) => { if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(name) } }, { filename })
  return exports
}
const plain = (v) => JSON.parse(JSON.stringify(v))
const validation = load("lib/product-manager-input.ts")
const input = () => ({ name: "Everyday", slug: "everyday", description: "A regular product", status: "draft", options: [{ title: "Color", values: ["Black", "White"] }, { title: "Size", values: ["S", "M"] }], variants: [
  { sku: "E-B-S", price: 500.25, stock: 0, images: [], options: { Color: "Black", Size: "S" } },
  { sku: "E-B-M", price: 600, stock: 7, images: ["https://images.invalid/1.webp"], options: { Color: "Black", Size: "M" } },
] })
test("regular products retain sparse combinations, exact BDT prices and zero inventory", () => {
  const parsed = validation.regularInput(input())
  assert.equal(parsed.variants.length, 2)
  assert.equal(parsed.variants[0].stock, 0)
  assert.equal(parsed.variants[0].price, 500.25)
  assert.equal(parsed.variants[1].title, "Black / M")
  assert.equal(parsed.status, "draft")
})
test("invalid combinations, duplicate SKUs, empty prices and unsafe images are rejected before creation", () => {
  for (const mutate of [
    (p) => { p.variants[1].options = p.variants[0].options },
    (p) => { p.variants[1].sku = p.variants[0].sku },
    (p) => { p.variants[0].price = "" },
    (p) => { p.variants[0].stock = -1 },
    (p) => { p.variants[0].images = ["javascript:alert(1)"] },
    (p) => { p.options[0].title = "__proto__" },
    (p) => { p.variants[0].options.Size = "XL" },
    (p) => { p.status = "published" },
  ]) { const p = input(); mutate(p); assert.throws(() => validation.regularInput(p)) }
})
test("single phone pair and dynamic model slugs are accepted without inventing missing pairs", () => {
  const pairs = { "new-shell": { "new-phone-model": ["https://images.invalid/new-unique.webp"] } }
  assert.deepEqual(plain(validation.uploadedPairs(pairs)), pairs)
  assert.throws(() => validation.uploadedPairs({ signature: { phone: [] } }))
  assert.throws(() => validation.uploadedPairs({ signature: { phone: "url" } }))
})
function stepHarness(product) {
  const steps = {}
  const utils = { ContainerRegistrationKeys: { QUERY: "query" }, Modules: { PRODUCT: "product", SALES_CHANNEL: "channel" }, MedusaError: class extends Error { static Types = { INVALID_DATA: "invalid", NOT_FOUND: "not_found" }; constructor(_, message) { super(message) } } }
  load("workflows/product-manager.ts", {
    "@medusajs/framework/utils": utils,
    "@medusajs/framework/workflows-sdk": { createStep: (name, fn) => { steps[name] = fn; return fn }, createWorkflow: () => ({}), StepResponse: class { constructor(value) { this.value = value } }, WorkflowResponse: class {}, transform: () => ({}) },
    "@medusajs/medusa/core-flows": {}, "../lib/product-manager-input": validation, "../lib/rebuild-cards": { rebuildCards: async () => {} },
  })
  const container = { resolve: () => ({ graph: async () => ({ data: [product] }) }) }
  return (patch) => steps["prepare-manager-variant-edit"](patch, { container }).then((v) => plain(v.value))
}
const product = () => ({ id: "p1", status: "published", thumbnail: "https://images.invalid/old.webp", options: [{ title: "Color" }], variants: [
  { id: "v1", sku: "ONE", metadata: { keep: "yes", images: ["https://images.invalid/old.webp"] }, prices: [{ id: "price1", currency_code: "bdt", amount: 400, rules_count: 0 }] },
  { id: "v2", sku: "TWO", metadata: { images: ["https://images.invalid/two.webp"] }, prices: [{ id: "price2", currency_code: "bdt", amount: 500, rules_count: 0 }] },
] })
test("variant editing preserves IDs, unrelated metadata and galleries while refreshing the cover", async () => {
  const p = product(); const prepare = stepHarness(p)
  const result = await prepare({ productId: p.id, variants: [{ id: "v1", images: ["https://images.invalid/replacement.webp"], price: 650 }] })
  assert.equal(result.variants[0].id, "v1")
  assert.equal(result.variants[0].metadata.keep, "yes")
  assert.equal(result.variants[0].prices[0].id, "price1")
  assert.equal(result.variants[0].prices[0].amount, 650)
  assert.equal(result.productUpdate.thumbnail, "https://images.invalid/replacement.webp")
  assert.deepEqual(result.productUpdate.images.map((i) => i.url), ["https://images.invalid/replacement.webp", "https://images.invalid/two.webp"])
  assert.equal(p.variants[0].metadata.images[0], "https://images.invalid/old.webp", "input objects are never mutated")
})
test("phone price overrides, foreign variants, duplicate IDs and empty published galleries cannot be saved", async () => {
  const p = product(); p.options = [{ title: "Case Type" }]
  const prepare = stepHarness(p)
  await assert.rejects(prepare({ productId: "p1", variants: [{ id: "v1", price: 1 }] }), /shared case-type price/)
  await assert.rejects(prepare({ productId: "p1", variants: [{ id: "foreign", sku: "X" }] }), /belonging/)
  await assert.rejects(prepare({ productId: "p1", variants: [{ id: "v1" }, { id: "v1" }] }), /unique variants/)
  await assert.rejects(prepare({ productId: "p1", variants: [{ id: "v1", sku: "TWO" }] }), /SKUs/)
  await assert.rejects(prepare({ productId: "p1", variants: [{ id: "v1", images: [] }] }), /at least one image/)
})
test("regular inventory endpoint uses the selected published product and exact variant inventory", async () => {
  const { GET } = load("api/store/stock/route.ts", { "@medusajs/framework/utils": { ContainerRegistrationKeys: { QUERY: "query" } } })
  let read, result
  const scope = { resolve: () => ({ graph: async (q) => { read = plain(q); return { data: [{ variants: [
    { id: "zero", manage_inventory: true, inventory_items: [] },
    { id: "ready", manage_inventory: true, inventory_items: [{ required_quantity: 2, inventory_item: { location_levels: [{ stocked_quantity: 12, reserved_quantity: 4 }] } }] },
    { id: "untracked", manage_inventory: false },
  ] }] } } }) }
  await GET({ query: { handle: "regular-product" }, scope }, { json: (value) => { result = plain(value) } })
  assert.deepEqual(read.filters, { handle: "regular-product", status: "published" })
  assert.deepEqual(result.stock, { "variant:zero": 0, "variant:ready": 4 })
})
test("unified list includes regular products using bounded reads of variant IDs only", async () => {
  const { listLiveDesigns } = load("lib/design-admin.ts", { "@medusajs/framework/utils": { Modules: {}, ContainerRegistrationKeys: { QUERY: "query" } } })
  const result = await listLiveDesigns({ resolve: () => ({ graph: async (q) => {
    assert.equal(q.pagination.take, 100)
    assert.ok(q.fields.includes("variants.id"))
    assert.ok(!q.fields.some((f) => /variants\.(metadata|prices)/.test(f)))
    return { data: [{ handle: "regular", title: "Regular", status: "draft", metadata: {}, variants: [{ id: "v1" }] }] }
  } }) }, true)
  assert.equal(result[0].kind, "regular")
  assert.equal(result[0].variantCount, 1)
})
