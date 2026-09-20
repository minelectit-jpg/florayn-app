const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Execute server loaders against an in-memory catalog, never a deployed store.
function loadSource(relativePath, dependencies, globals = {}) {
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
    process: { env: {} },
    URLSearchParams,
    ...globals,
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
      getShopCards: async () => null,
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

test("shop uses uploaded exact-pair renders without changing variant selection, prices or legacy fallback", async () => {
  const device = { name: "iPhone 17 Pro Max", slug: "iphone-17-pro-max", family: "iphone" }
  const cases = [
    { name: "Signature", slug: "signature", price: 1400 },
    { name: "Armor Black", slug: "armor-black", price: 1950 },
  ]
  const upload = "https://images.invalid/uploads/01JZUPLOAD01/signature.webp"
  const armor = "https://images.invalid/uploads/01JZUPLOAD01/armor.webp"
  const { default: ShopView } = loadSource("components/shop-view.tsx", {
    "next/link": { __esModule: true, default: "Link" },
    "@/lib/catalog": {
      getDeviceCatalog: async () => [device], getCaseTypes: async () => cases,
      getShopCatalog: async () => ["uploaded", "legacy"].map((slug) => ({ slug, name: slug, forms: ["phone"], caseTypes: cases.map((c) => c.slug) })),
      shopCardImage: (slug, caseSlug) => `https://images.invalid/${slug}/${caseSlug}/legacy.webp`,
      getShopCards: async (handles, name, caseName) => {
        assert.deepEqual(Array.from(handles), ["uploaded", "legacy"])
        assert.equal(name, device.name)
        return [{
          handle: "uploaded", variantId: `uploaded-${cases.find((ct) => ct.name === caseName).slug}-${name}`,
          image: caseName === "Signature" ? upload : armor,
          imagesByCaseType: { Signature: upload, "Armor Black": armor },
        }]
      },
    },
    "@/lib/medusa": { listProducts: async (query, options) => {
      assert.equal(options.pricing, false)
      assert.deepEqual(Array.from(query.handle), ["legacy"], "only missing compact cards need the old variant lookup")
      assert.doesNotMatch(query.fields, /calculated_price|metadata|images/)
      return { products: ["legacy"].map((handle) => ({
        id: handle, handle,
        metadata: handle === "uploaded" ? { card: { pairs: {
          [`${device.name}|Signature`]: { image: upload, variantId: "do-not-replace-variant-lookup", price: 9999 },
          [`${device.name}|Armor Black`]: { image: armor },
          "iPhone 14|Signature": { image: "wrong-model.webp" },
        } } } : null,
        variants: cases.flatMap((ct) => ["iPhone 14", device.name].map((name) => ({
          id: `${handle}-${ct.slug}-${name}`,
          options: [{ value: name }, { value: ct.name }],
        }))),
      })), count: 2 }
    } },
  })
  for (const ct of cases) {
    const tree = await ShopView({ deviceSlug: device.slug, caseTypeSlug: ct.slug })
    const grid = tree.props.children[1].props
    const currentImage = ct.slug === "signature" ? upload : armor
    assert.equal(grid.products[0].thumbnail, currentImage)
    assert.equal(grid.products[0].variants[0].metadata.images[0], currentImage)
    assert.equal(grid.products[0].variants[0].id, `uploaded-${ct.slug}-${device.name}`)
    assert.equal(grid.products[0].variants[0].calculated_price.calculated_amount, ct.price)
    assert.equal(grid.products[1].thumbnail, `https://images.invalid/legacy/${ct.slug}/legacy.webp`)
    const selectors = tree.props.children[0].props.children[1].props
    assert.equal(selectors.caseTypeImages.signature, upload)
    assert.equal(selectors.caseTypeImages["armor-black"], armor)
    // Only one selected image per card reaches the client, not metadata.card.
    assert.equal(grid.products[0].metadata.card, undefined)
  }
})

test("compact shop card reads have stable URLs, short invalidation tags and a safe API fallback", async () => {
  const requests = []
  let ok = true
  const { getShopCards, getShopCatalog } = loadSource("lib/catalog.ts", {
    "./medusa": { MEDUSA_BACKEND_URL: "http://fixture.invalid", MEDUSA_PUBLISHABLE_KEY: "fixture-only" },
  }, {
    fetch: async (url, options) => {
      requests.push({ url, options })
      return { ok, json: async () => ({ cards: [{ handle: "b", variantId: "variant-b", image: null, imagesByCaseType: {} }], designs: [] }) }
    },
  })
  const handles = ["b", "a", "b"]
  const cards = await getShopCards(handles, "iPhone 17 Pro Max", "Armor Black")
  await getShopCards(["a", "b"], "iPhone 17 Pro Max", "Armor Black")
  assert.deepEqual(handles, ["b", "a", "b"], "cache normalization must not reorder the caller's catalog")
  assert.equal(requests[0].url, requests[1].url)
  const query = new URL(requests[0].url).searchParams
  assert.equal(query.get("handles"), "a,b")
  assert.equal(query.get("device"), "iPhone 17 Pro Max")
  assert.equal(query.get("case_type"), "Armor Black")
  assert.equal(cards[0].handle, "b")
  assert.deepEqual(Array.from(requests[0].options.next.tags), ["products", "catalog", "catalog:shop-cards"])
  await getShopCatalog()
  assert.deepEqual(Array.from(requests.at(-1).options.next.tags), ["products", "catalog", "catalog:shop-catalog"])
  ok = false
  assert.equal(await getShopCards(["a"], "Phone", "Signature"), null)
})

test("collection starts independent reads early and prices only final featured members", async () => {
  const events = []
  let releaseGroup
  const group = new Promise((resolve) => { releaseGroup = resolve })
  const device = { name: "iPhone 17 Pro Max", slug: "iphone-17-pro-max", family: "iphone" }
  const sources = ["Charlie", "Alpha", "Bravo"].map((title, i) => ({
    id: `p${i}`, handle: `p${i}`, title, metadata: { design_slug: `d${i}`, form: "phone" },
    options: [
      { id: "device", title: "Device", values: [{ value: "iPhone 16" }, { value: device.name }] },
      { id: "case", title: "Case Type", values: [{ value: "Signature" }, { value: "Armor Black" }] },
    ],
    variants: [
      { id: `first${i}`, title: "Signature / iPhone 16", options: [{ option_id: "device", value: "iPhone 16" }, { option_id: "case", value: "Signature" }], calculated_price: { calculated_amount: [2100, 1100, 1700][i] } },
      { id: `selected${i}`, title: `${i === 1 ? "Armor Black" : "Signature"} / ${device.name}`, options: [{ option_id: "device", value: device.name }, { option_id: "case", value: i === 1 ? "Armor Black" : "Signature" }], calculated_price: { calculated_amount: [1400, 2400, 2000][i] }, metadata: { images: [`selected${i}.webp`] } },
    ],
  }))
  const { buildVariantMatrix } = loadSource("lib/variant-matrix.ts", {})
  const pricedCalls = []
  const { default: CollectionPage } = loadSource("app/collection/[slug]/page.tsx", {
    react: uncachedReact, "next/cache": { unstable_cache: (fn) => fn },
    "next/navigation": { notFound: () => { throw new Error("unexpected 404") } },
    "@/lib/catalog": { getDeviceCatalog: async () => { events.push("devices"); return [device, { name: "iPhone 16", slug: "iphone-16", family: "iphone" }] } },
    "@/lib/content": { getCollectionPage: async () => { events.push("landing"); return { design_slugs: ["d2", "d0"] } } },
    "@/lib/variant-matrix": { buildVariantMatrix },
    "@/lib/medusa": {
      sdk: { store: { collection: { list: async () => { events.push("group"); return group } } } },
      listProducts: async () => { events.push("products"); return { products: sources, count: 3 } },
    },
    "@/lib/collection-products": {
      COLLECTION_FIELDS: "fixture",
      hydrateCollectionProducts: async (products, name, options) => {
        assert.equal(name, device.name)
        pricedCalls.push({ ids: Array.from(products, (p) => p.id), includeFirst: options.includeFirstVariant })
        return { products }
      },
    },
  })
  const render = (sort = "featured") => CollectionPage({ params: Promise.resolve({ slug: "fixture" }), searchParams: Promise.resolve({ sort }) })
  const initial = render()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ["devices", "landing", "group"])
  releaseGroup({ collections: [{ id: "collection", title: "Fixture" }] })
  const featured = await initial
  assert.deepEqual(pricedCalls[0], { ids: ["p0", "p2"], includeFirst: false })
  const cards = (tree) => Array.from(tree.props.children[2].props.children, (card) => card.props.product)
  assert.deepEqual(cards(featured).map((p) => p.id), ["p2", "p0"])
  const filters = featured.props.children[1].props
  assert.equal(filters.device, device.name)
  assert.ok(filters.caseTypes.some((ct) => ct.value === "Armor Black"), "curated filtering must not narrow selector options")
  for (const [sort, order] of [["name", ["p1", "p2", "p0"]], ["price-asc", ["p1", "p2", "p0"]], ["price-desc", ["p0", "p2", "p1"]]]) {
    const result = await render(sort)
    assert.deepEqual(cards(result).map((p) => p.id), order)
    assert.deepEqual(pricedCalls.at(-1).ids, ["p0", "p1", "p2"])
    assert.equal(pricedCalls.at(-1).includeFirst, sort !== "name")
    assert.deepEqual(cards(result).map((p) => p.variants[1].metadata.images[0]), order.map((id) => `selected${id.slice(1)}.webp`))
  }
})
