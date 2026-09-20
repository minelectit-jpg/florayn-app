const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Execute server loaders against an in-memory catalog, never a deployed store.
function loadSource(relativePath, dependencies) {
  const filename = path.join(__dirname, "../src", relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(source, {
    exports,
    console,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
      if (name.startsWith("@/components/")) return { __esModule: true, default: name }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return exports
}

const uncachedReact = { cache: (fn) => fn }

test("sitemaps cover a catalog larger than 600 products without pricing or phantom devices", async () => {
  const devices = Array.from({ length: 9 }, (_, i) => ({
    id: `dev-${i}`, name: `Model ${i}`, slug: `model-${i}`, family: "iphone", brand: "Apple",
  }))
  const products = Array.from({ length: 621 }, (_, i) => ({
    id: `product-${i}`, handle: `design-${i}`, title: `Design ${i}`,
    options: [{ id: "device", title: "Device", values: devices.map((d) => ({ value: d.name })) }],
    // Model 8 is an unused option; Model 0 is sold in two case types.
    variants: [...devices.slice(0, 8), devices[0]].map((device, j) => ({
      id: `variant-${i}-${j}`, title: `Signature / ${device.name}`,
      options: [{ option_id: "device", value: device.name }],
    })),
  }))
  let calls = 0
  const { getSitemapUrls, SITEMAP_CHUNK_SIZE } = loadSource("lib/sitemap-urls.ts", {
    react: uncachedReact,
    "@/lib/catalog": { getDeviceCatalog: async () => devices },
    "@/lib/medusa": {
      listProducts: async (query, options) => {
        calls++
        assert.equal(options?.pricing, false, "omitting price fields alone still invokes Medusa pricing")
        assert.ok(query.limit <= 200, "catalog batches must fit the product data cache")
        assert.doesNotMatch(query.fields, /calculated_price|metadata|images/)
        return { products: products.slice(query.offset, query.offset + query.limit), count: products.length }
      },
    },
  })
  const urls = await getSitemapUrls()
  assert.equal(urls.length, 3 + 9 + 621 * 9)
  assert.ok(urls.includes("/product/design-620-model-7/"))
  assert.ok(!urls.includes("/product/design-0-model-8/"))
  assert.equal(urls.filter((url) => url === "/product/design-0-model-0/").length, 1)
  assert.equal(Math.ceil(urls.length / SITEMAP_CHUNK_SIZE), 2)
  assert.ok(calls > 1)
})

test("home prices only selected phone designs and keeps carousel order and real prices", async () => {
  const candidates = Array.from({ length: 24 }, (_, i) => ({
    id: `p-${i}`, handle: `design-${Math.floor(i / 2)}-${i % 2 ? "phone" : "airpods"}`,
    title: `Design ${Math.floor(i / 2)}`,
    metadata: { design_slug: `design-${Math.floor(i / 2)}`, form: i % 2 ? "phone" : "airpods" },
    variants: [{ id: `v-${i}`, title: "Alcantara / iPhone 17 Pro Max", calculated_price: { calculated_amount: 1900 + i, currency_code: "bdt" } }],
  }))
  const expected = [1, 3, 5, 7, 9].map((i) => candidates[i])
  let pricedCount = 0
  const { default: HomePage } = loadSource("app/page.tsx", {
    "@/lib/content": { getSiteContent: async () => ({ sections: [{ key: "picks", type: "product_carousel", config: { limit: 5 } }] }) },
    "@/lib/medusa": {
      CARD_FIELDS: "id,title,handle,metadata,*variants,*variants.calculated_price",
      listProducts: async (query, options) => {
        if (!query.id) {
          assert.equal(options?.pricing, false)
          assert.doesNotMatch(query.fields, /variants|calculated_price/)
          return { products: candidates, count: candidates.length }
        }
        assert.notEqual(options?.pricing, false, "the visible carousel still needs actual region prices")
        pricedCount = query.id.length
        assert.deepEqual(Array.from(query.id), expected.map((p) => p.id))
        return { products: [...expected].reverse(), count: expected.length }
      },
    },
  })
  const result = await HomePage()
  const cards = result.props.children[0].props.products
  assert.equal(pricedCount, 5)
  assert.deepEqual(Array.from(cards, (p) => p.id), expected.map((p) => p.id))
  assert.deepEqual(Array.from(cards, (p) => p.variants[0].calculated_price.calculated_amount), expected.map((p) => p.variants[0].calculated_price.calculated_amount))
})

test("collection loads compatibility before hydrating selected-device prices and images", async () => {
  const product = {
    id: "p-1", handle: "alcantara-phone", title: "Alcantara", metadata: { form: "phone" },
    options: [
      { id: "device", title: "Device", values: [{ value: "iPhone 17 Pro Max" }, { value: "iPhone 16" }] },
      { id: "case", title: "Case Type", values: [{ value: "Alcantara" }] },
    ],
    variants: [1900, 2200].map((amount, i) => ({
      id: `v-${i}`, title: `Alcantara / ${i ? "iPhone 16" : "iPhone 17 Pro Max"}`,
      metadata: { images: [`https://images.invalid/${i}.webp`] },
      calculated_price: { calculated_amount: amount, currency_code: "bdt" },
      options: [{ option_id: "case", value: "Alcantara" }, { option_id: "device", value: i ? "iPhone 16" : "iPhone 17 Pro Max" }],
    })),
  }
  const { buildVariantMatrix } = loadSource("lib/variant-matrix.ts", {})
  const { COLLECTION_FIELDS } = loadSource("lib/collection-products.ts", {
    "next/cache": { unstable_cache: (fn) => fn },
    "@/lib/medusa": {},
  })
  const { default: CollectionPage } = loadSource("app/collection/[slug]/page.tsx", {
    react: uncachedReact,
    "next/cache": { unstable_cache: (fn) => fn },
    "next/navigation": { notFound: () => { throw new Error("unexpected 404") } },
    "@/lib/catalog": { getDeviceCatalog: async () => [{ name: "iPhone 17 Pro Max", slug: "iphone-17-pro-max", family: "iphone" }] },
    "@/lib/collection-products": {
      COLLECTION_FIELDS,
      hydrateCollectionProducts: async (products, device) => {
        assert.equal(device, "iPhone 17 Pro Max")
        assert.equal(products[0].id, product.id)
        return { products: [product] }
      },
    },
    "@/lib/content": { getCollectionPage: async () => null },
    "@/lib/variant-matrix": { buildVariantMatrix },
    "@/lib/medusa": {
      sdk: { store: { collection: { list: async () => ({ collections: [{ id: "collection-1", title: "Alcantara" }] }) } } },
      listProducts: async (query, options) => {
        assert.equal(options?.pricing, false)
        assert.equal(query.collection_id, "collection-1")
        assert.doesNotMatch(query.fields, /variants\.calculated_price|variants\.metadata/)
        assert.doesNotMatch(query.fields, /description|\*collection|\*categories/)
        return { products: [product], count: 1 }
      },
    },
  })
  const result = await CollectionPage({ params: Promise.resolve({ slug: "alcantara" }), searchParams: Promise.resolve({ device: "iPhone 17 Pro Max" }) })
  const card = result.props.children[2].props.children[0]
  assert.equal(card.props.device, "iPhone 17 Pro Max")
  assert.equal(card.props.product.variants[0].calculated_price.calculated_amount, 1900)
  assert.equal(card.props.product.variants[1].calculated_price.calculated_amount, 2200)
  assert.equal(card.props.product.variants[0].metadata.images[0], "https://images.invalid/0.webp")
})

test("shop Quick Add resolves the chosen device and construction without invoking unused pricing", async () => {
  const device = { name: "iPhone 17 Pro Max", slug: "iphone-17-pro-max", family: "iphone" }
  const caseType = { name: "Signature", slug: "signature", price: 1400 }
  const { default: ShopView } = loadSource("components/shop-view.tsx", {
    "next/link": { __esModule: true, default: "Link" },
    "@/lib/catalog": {
      getDeviceCatalog: async () => [device],
      getCaseTypes: async () => [caseType],
      getShopCatalog: async () => [{ slug: "example", name: "Example", forms: ["phone"], caseTypes: ["signature"] }],
      shopCardImage: () => "https://images.invalid/selected.webp",
    },
    "@/lib/medusa": { listProducts: async (query, options) => {
      assert.equal(options?.pricing, false)
      assert.doesNotMatch(query.fields, /calculated_price/)
      assert.deepEqual(Array.from(query.handle), ["example"])
      return { products: [{ id: "p1", handle: "example", variants: [
        { id: "wrong-device", options: [{ value: "Signature" }, { value: "iPhone 14" }] },
        { id: "selected-variant", options: [{ value: "Signature" }, { value: device.name }] },
      ] }], count: 1 }
    } },
  })
  const tree = await ShopView({ deviceSlug: device.slug, caseTypeSlug: caseType.slug })
  const grid = tree.props.children[1].props
  assert.equal(grid.products[0].variants[0].id, "selected-variant")
  assert.equal(grid.products[0].variants[0].calculated_price.calculated_amount, 1400)
  assert.equal(grid.products[0].variants[0].metadata.images[0], "https://images.invalid/selected.webp")
})
