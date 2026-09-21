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
  vm.runInNewContext(
    code,
    {
      exports,
      console,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected import ${name}`)
      },
    },
    { filename }
  )
  return exports
}

const rebuildCalls = []
const utils = {
  ContainerRegistrationKeys: { QUERY: "query" },
  Modules: { PRODUCT: "product" },
  ProductStatus: { PUBLISHED: "published", DRAFT: "draft" },
}
const { editDesignMeta } = load("lib/edit-design.ts", {
  "@medusajs/framework/utils": utils,
  "@medusajs/medusa/core-flows": { createCollectionsWorkflow: () => ({ run: async () => ({ result: [{ id: "col_new" }] }) }) },
  "../modules/catalog": { CATALOG_MODULE: "catalog" },
  "./create-uploaded-design": { slugify: (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
  "./rebuild-cards": { rebuildCards: async (...args) => { rebuildCalls.push(args) } },
})

function makeContainer() {
  const products = [
    { id: "p1", handle: "timeless", status: "draft", title: "Timeless", metadata: { design_slug: "timeless", design_name: "Timeless", form: "phone" } },
    { id: "p2", handle: "timeless-airpods", status: "draft", title: "Timeless - AirPods", metadata: { design_slug: "timeless", form: "airpods" } },
    { id: "px", handle: "other", status: "draft", title: "Other", metadata: { design_slug: "other", form: "phone" } },
  ]
  const state = { productUpdates: null, designUpdates: [] }
  const productModule = {
    listProducts: async () => products,
    updateProducts: async (updates) => { state.productUpdates = updates; return updates },
  }
  const catalog = {
    listDesigns: async () => [{ id: "d1", slug: "timeless" }],
    updateDesigns: async (patch) => { state.designUpdates.push(patch) },
  }
  const query = { graph: async () => ({ data: [] }) }
  const container = {
    resolve: (k) => (k === "product" ? productModule : k === "catalog" ? catalog : k === "query" ? query : (() => { throw new Error(k) })()),
  }
  return { container, state }
}

test("rename + publish updates every product title/status but never price or variants", async () => {
  rebuildCalls.length = 0
  const { container, state } = makeContainer()
  const res = await editDesignMeta(container, "timeless", { name: "Retro Ride", status: "published" })

  assert.equal(res.updated, 2, "only the timeless products, not the other design")
  const byId = Object.fromEntries(state.productUpdates.map((u) => [u.id, u]))
  assert.equal(byId.p1.title, "Retro Ride")
  assert.equal(byId.p1.metadata.design_name, "Retro Ride")
  assert.equal(byId.p1.status, "published")
  assert.equal(byId.p2.title, "Retro Ride - AirPods Case", "non-phone forms keep their label suffix")
  // Nothing pricing/variant-related is ever written.
  for (const u of state.productUpdates) {
    assert.ok(!("prices" in u) && !("variants" in u), "meta edit must not touch prices/variants")
  }
  assert.equal(state.designUpdates[0].name, "Retro Ride")
  assert.equal(rebuildCalls.length, 1)
  assert.deepEqual(rebuildCalls[0][1].productIds.join(","), "p1,p2")
})

test("status-only edit leaves titles untouched", async () => {
  const { container, state } = makeContainer()
  await editDesignMeta(container, "timeless", { status: "draft" })
  for (const u of state.productUpdates) {
    assert.ok(!("title" in u), "no rename when only status changes")
    assert.equal(u.status, "draft")
  }
})

test("editing an unknown design throws", async () => {
  const { container } = makeContainer()
  await assert.rejects(() => editDesignMeta(container, "nope", { status: "draft" }), /No design found/)
})
