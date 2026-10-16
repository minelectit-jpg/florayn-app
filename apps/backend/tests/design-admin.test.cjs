const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      console,
      Date,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected import ${name}`)
      },
    },
    { filename }
  )
  return exports
}

const utils = {
  Modules: { PRODUCT: "product", STORE: "store" },
  ContainerRegistrationKeys: { QUERY: "query" },
}
const { listLiveDesigns, getDesignDetail } = load("lib/design-admin.ts", {
  "@medusajs/framework/utils": utils,
  "./audience": load("lib/audience.ts"),
  "../modules/catalog": { CATALOG_MODULE: "catalog" },
  "./mockup-settings": load("lib/mockup-settings.ts", { "@medusajs/framework/utils": utils }),
})
const plain = (value) => JSON.parse(JSON.stringify(value))
const noColours = { catalog: { listPhoneColourGalleries: async () => [] }, store: { listStores: async () => [] } }

test("listLiveDesigns groups products by design, counting forms + variants", async () => {
  const products = [
    { id: "p1", title: "Timeless", handle: "timeless", thumbnail: "t.jpg", status: "published", created_at: "2026-09-20", metadata: { design_slug: "timeless", design_name: "Timeless", form: "phone", theme: "Cars" } },
    { id: "p2", title: "Timeless - AirPods", handle: "timeless-airpods", thumbnail: "ta.jpg", status: "published", created_at: "2026-09-20", metadata: { design_slug: "timeless", form: "airpods" } },
    { id: "p3", title: "Legends", handle: "legends", thumbnail: "l.jpg", status: "draft", created_at: "2026-09-19", metadata: { design_slug: "legends", design_name: "Legends", form: "phone" } },
    { id: "px", title: "No design", handle: "misc", thumbnail: null, status: "published", created_at: "2026-09-18", metadata: {} },
  ]
  const productModule = {
    listProducts: async (_filter, config) => {
      if (config?.relations?.includes("variants")) {
        const counts = { p1: 3, p2: 1, p3: 1, px: 0 }
        return products.map((p) => ({ id: p.id, metadata: p.metadata, variants: Array.from({ length: counts[p.id] }, () => ({})) }))
      }
      return products
    },
  }
  const container = { resolve: (k) => (k === "product" ? productModule : (() => { throw new Error(k) })()) }

  const designs = await listLiveDesigns(container)
  assert.equal(designs.length, 2, "products without a design_slug are ignored")
  // Sorted by name: Legends before Timeless.
  assert.equal(designs.map((d) => d.slug).join(","), "legends,timeless")

  const timeless = designs.find((d) => d.slug === "timeless")
  assert.equal([...timeless.forms].sort().join(","), "airpods,phone")
  assert.equal(timeless.productCount, 2)
  assert.equal(timeless.variantCount, 4)
  assert.equal(timeless.status, "published")
  assert.equal(timeless.theme, "Cars")

  assert.equal(designs.find((d) => d.slug === "legends").status, "draft")
})

test("listLiveDesigns reports mixed status when a design's products differ", async () => {
  const products = [
    { id: "p1", handle: "amp", status: "published", created_at: "2026-09-20", metadata: { design_slug: "amp", form: "phone" } },
    { id: "p2", handle: "amp-airpods", status: "draft", created_at: "2026-09-20", metadata: { design_slug: "amp", form: "airpods" } },
  ]
  const productModule = {
    listProducts: async (_f, config) => (config?.relations ? products.map((p) => ({ id: p.id, metadata: p.metadata, variants: [] })) : products),
  }
  const container = { resolve: () => productModule }
  const [design] = await listLiveDesigns(container)
  assert.equal(design.status, "mixed")
})

test("getDesignDetail returns products + variant case-type/device/image, filtered to the slug", async () => {
  const query = {
    graph: async () => ({
      data: [
        {
          id: "p1", handle: "timeless", title: "Timeless", status: "published", thumbnail: "t.jpg",
          metadata: { design_slug: "timeless", design_name: "Timeless", form: "phone", theme: "Cars" },
          collection: { id: "col1", title: "Cars" },
          options: [
            { id: "o1", title: "Case Type", values: [{ value: "Signature" }, { value: "Elite Clear" }] },
            { id: "o2", title: "Device", values: [{ value: "iPhone 17 Pro Max" }] },
          ],
          variants: [
            { id: "v1", sku: "SKU-1", metadata: { images: ["i1.jpg"] }, options: [{ option_id: "o1", value: "Signature" }, { option_id: "o2", value: "iPhone 17 Pro Max" }] },
          ],
        },
        { id: "pX", handle: "other", metadata: { design_slug: "other" }, options: [], variants: [] },
      ],
    }),
  }
  const container = { resolve: (k) => (k === "query" ? query : noColours[k] ?? (() => { throw new Error(k) })()) }

  const detail = await getDesignDetail(container, "timeless")
  assert.equal(detail.slug, "timeless")
  assert.equal(detail.theme, "Cars")
  assert.equal(detail.collection.title, "Cars")
  assert.equal(detail.products.length, 1, "the other design is filtered out")
  const p = detail.products[0]
  assert.deepEqual(p.caseTypes, ["Signature", "Elite Clear"])
  assert.deepEqual(p.devices, ["iPhone 17 Pro Max"])
  assert.equal(p.variants[0].caseType, "Signature")
  assert.equal(p.variants[0].device, "iPhone 17 Pro Max")
  assert.equal(p.variants[0].image, "i1.jpg")
})

test("getDesignDetail returns null when no product matches the slug", async () => {
  const query = { graph: async () => ({ data: [{ id: "pX", handle: "other", metadata: { design_slug: "other" }, options: [], variants: [] }] }) }
  const container = { resolve: () => query }
  assert.equal(await getDesignDetail(container, "timeless"), null)
})

test("getDesignDetail adds each variant's phone colours and the palette of its models", async () => {
  const product = (id, slug, variants) => ({ id, handle: slug, title: slug, status: "draft", metadata: { design_slug: "muse", form: id === "p1" ? "phone" : "airpods" }, options: [], variants })
  const query = { graph: async () => ({ data: [
    product("p1", "muse", [
      { id: "v1", metadata: { images: ["https://img.test/black-1.webp"], device_slug: "iphone-18-pro-max", case_type_slug: "signature" }, options: [] },
      { id: "v2", metadata: { images: ["https://img.test/16.webp"], device_slug: "iphone-16", case_type_slug: "signature" }, options: [] },
    ]),
    product("p2", "muse-airpods", [{ id: "v3", metadata: { images: ["https://img.test/a.webp"], device_slug: "airpods-4", case_type_slug: "signature-earbuds" }, options: [] }]),
  ] }) }
  const reads = []
  const catalog = { listPhoneColourGalleries: async (filter, config) => {
    reads.push(plain({ filter, config }))
    return [
      { variant_id: "v1", colour_slug: "black", is_main: true, images: null },
      { variant_id: "v1", colour_slug: "silver", is_main: false, images: ["https://img.test/silver-1.webp"] },
      { variant_id: "gone", colour_slug: "silver", is_main: false, images: ["https://img.test/orphan.webp"] },
    ]
  } }
  const sets = [
    { device: "iphone-18-pro-max", base_url: "https://img.test/mockups/v1", colours: ["Black", "Silver", "Deep Blue"], default_colour: "Silver", enabled: false, swatches: { "Deep Blue": "#112233" } },
    { device: "iphone-17", base_url: "https://img.test/mockups/v2", colours: ["Black"], default_colour: "Black", enabled: true },
  ]
  const store = { listStores: async () => [{ id: "store", metadata: { florayn_mockups: { sets } } }] }
  const services = { query, catalog, store }
  const detail = plain(await getDesignDetail({ resolve: (k) => services[k] }, "muse"))
  assert.deepEqual(reads, [{ filter: { product_id: ["p1", "p2"] }, config: { select: ["variant_id", "colour_slug", "is_main", "images"], take: 20000 } }], "one bounded read for the design's products")
  const variants = detail.products.flatMap((p) => p.variants)
  assert.deepEqual(variants.find((v) => v.id === "v1").phoneColours, { main: "black", extra: { silver: ["https://img.test/silver-1.webp"] } })
  assert.deepEqual(variants.find((v) => v.id === "v2").phoneColours, { main: null, extra: {} })
  assert.deepEqual(variants.find((v) => v.id === "v1").images, ["https://img.test/black-1.webp"], "images stays the main gallery")
  assert.deepEqual(detail.palette, { "iphone-18-pro-max": { default: "silver", colours: [["black", "Black", "#1d1d1f"], ["silver", "Silver", "#e3e4e5"], ["deep-blue", "Deep Blue", "#112233"]] } }, "only this design's models with a set, even one switched off")
})
