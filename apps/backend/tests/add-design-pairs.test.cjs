const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

const CASE_TYPES = [
  { slug: "signature", name: "Signature", sku_code: "SIG", price: 1400, price_groups: null },
  { slug: "elite-clear", name: "Elite Clear", sku_code: "ELC", price: 1600, price_groups: null },
  { slug: "signature-earbuds", name: "Signature Earbuds", sku_code: "SIG", price: 750, price_groups: null },
]
const DEVICES = [
  { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", sku_code: "I17PM", family: "iphone" },
  { slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", sku_code: "I16PM", family: "iphone" },
]

const calls = { updateProducts: [], variants: [], rebuild: [], blanks: [] }
const { addPairsToDesign } = load("lib/add-design-pairs.ts", {
  "@medusajs/framework/utils": { ContainerRegistrationKeys: { QUERY: "query" }, Modules: { PRODUCT: "product", INVENTORY: "inventory" } },
  "@medusajs/medusa/core-flows": {
    createInventoryItemsWorkflow: () => ({ run: async ({ input }) => { calls.blanks.push(input); return { result: input.items.map((it, i) => ({ id: `blank_${i}`, sku: it.sku })) } } }),
    createInventoryLevelsWorkflow: () => ({ run: async () => ({ result: [] }) }),
    createProductVariantsWorkflow: () => ({ run: async ({ input }) => { calls.variants.push(...input.product_variants); return { result: [] } } }),
  },
  "../modules/catalog": { CATALOG_MODULE: "catalog" },
  "../modules/catalog/data/case-types": { CASE_TYPES },
  "../modules/catalog/data/devices": { DEVICES },
  "./create-uploaded-design": { skuCodeFromSlug: (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "") },
  "./rebuild-cards": { rebuildCards: async (_c, arg) => { calls.rebuild.push(arg) } },
})

function makeContainer() {
  const product = {
    id: "prod_phone", handle: "timeless", metadata: { design_slug: "timeless", form: "phone" },
    images: [{ url: "sig.jpg" }],
    options: [
      { id: "opt_ct", title: "Case Type", values: [{ id: "val_sig", value: "Signature" }] },
      { id: "opt_dev", title: "Device", values: [{ id: "val_i17", value: "iPhone 17 Pro Max" }] },
    ],
    variants: [
      { id: "v_sig", options: [{ option_id: "opt_ct", value: "Signature" }, { option_id: "opt_dev", value: "iPhone 17 Pro Max" }] },
    ],
  }
  const productModule = {
    updateProducts: async (id, patch) => { calls.updateProducts.push({ id, patch }) },
  }
  const inventoryModule = { listInventoryItems: async () => [] } // no blanks yet -> created
  const catalog = { listCaseTypes: async () => CASE_TYPES, listDevices: async () => DEVICES }
  const query = {
    graph: async ({ entity }) => {
      if (entity === "product") return { data: [product] }
      if (entity === "stock_location") return { data: [{ id: "loc_1" }] }
      return { data: [] }
    },
  }
  const container = { resolve: (k) => (k === "query" ? query : k === "product" ? productModule : k === "inventory" ? inventoryModule : k === "catalog" ? catalog : (() => { throw new Error(k) })()) }
  return { container }
}

test.beforeEach(() => { calls.updateProducts = []; calls.variants = []; calls.rebuild = []; calls.blanks = [] })

test("adds a new case type: creates the option value + the variant, priced from the case type", async () => {
  const { container } = makeContainer()
  const res = await addPairsToDesign(container, "timeless", { "elite-clear": { "iphone-17-pro-max": ["elite.jpg"] } })

  assert.equal(res.variantsAdded, 1)
  assert.equal(res.skipped, 0)

  // The Case Type option now includes the existing Signature (by id) + new Elite Clear.
  const optUpdate = calls.updateProducts.find((u) => u.patch.options)
  assert.ok(optUpdate, "options were updated to add the missing value")
  const ctOpt = optUpdate.patch.options.find((o) => o.title === "Case Type")
  assert.equal(ctOpt.values.map((v) => v.value).sort().join(","), "Elite Clear,Signature")
  assert.ok(ctOpt.values.find((v) => v.value === "Signature").id === "val_sig", "existing value kept by id")

  // The new variant is created with the right options + case-type price + blank.
  assert.equal(calls.variants.length, 1)
  const nv = calls.variants[0]
  assert.equal(nv.product_id, "prod_phone")
  assert.equal(nv.title, "Elite Clear / iPhone 17 Pro Max")
  assert.equal(nv.options["Case Type"], "Elite Clear")
  assert.equal(nv.prices[0].amount, 1600)
  assert.equal(nv.inventory_items[0].inventory_item_id, "blank_0")
  assert.equal(calls.rebuild.length, 1)
})

test("skips a pair that already exists as a variant", async () => {
  const { container } = makeContainer()
  const res = await addPairsToDesign(container, "timeless", { signature: { "iphone-17-pro-max": ["dupe.jpg"] } })
  assert.equal(res.variantsAdded, 0)
  assert.equal(res.skipped, 1)
  assert.equal(calls.variants.length, 0)
})

test("adds only a new DEVICE under an existing case type, and extends the gallery", async () => {
  const { container } = makeContainer()
  const res = await addPairsToDesign(container, "timeless", { signature: { "iphone-16-pro-max": ["s16.jpg"] } })
  assert.equal(res.variantsAdded, 1)
  // Device option got the new value; Case Type kept Signature only.
  const optUpdate = calls.updateProducts.find((u) => u.patch.options)
  const devOpt = optUpdate.patch.options.find((o) => o.title === "Device")
  assert.equal(devOpt.values.map((v) => v.value).sort().join(","), "iPhone 16 Pro Max,iPhone 17 Pro Max")
  // Gallery extended with the new image.
  const imgUpdate = calls.updateProducts.find((u) => u.patch.images)
  assert.ok(imgUpdate.patch.images.some((i) => i.url === "s16.jpg"))
  assert.ok(imgUpdate.patch.images.some((i) => i.url === "sig.jpg"), "existing gallery image kept")
})

test("throws for an unknown design", async () => {
  const { container } = makeContainer()
  await assert.rejects(() => addPairsToDesign(container, "nope", { "elite-clear": { "iphone-17-pro-max": ["x.jpg"] } }), /No design found/)
})
