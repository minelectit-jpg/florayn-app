const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Execute server components against in-memory data, never a deployed store.
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
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" }
      if (name === "@/lib/audience") return audienceLib()
      if (name.startsWith("@/components/")) return { __esModule: true, default: name }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return exports
}

const uncachedReact = { cache: (fn) => fn }
let audienceModule
function audienceLib() {
  return (audienceModule ??= loadSource("lib/audience.ts", {}))
}
const { buildVariantMatrix } = loadSource("lib/variant-matrix.ts", {})
const productForms = loadSource("lib/product-forms.ts", {})

test("home prices each carousel separately and can source one from a collection", async () => {
  const pool = (prefix) => Array.from({ length: 6 }, (_, i) => ({
    id: `${prefix}-${i}`, handle: `${prefix}-${i}`, metadata: { design_slug: `${prefix}-${i}`, form: "phone" },
  }))
  const calls = []
  const { default: HomePage } = loadSource("components/pages/home-page.tsx", {
    "@/lib/content": { collectionsFor: (cards) => cards, getSiteContent: async () => ({
      sections: [
        { key: "new", type: "product_carousel", config: { limit: 4 } },
        { key: "bugs", type: "product_carousel", config: { limit: 2, collection: "bug-life" } },
      ],
      collections: [{ slug: "bug-life", collection_id: "pcol_bug" }],
    }) },
    "@/lib/medusa": {
      CARD_FIELDS: "id,title,handle,*variants.calculated_price",
      listProducts: async (query, options) => {
        calls.push({ query, options })
        if (!query.id) {
          assert.equal(options?.pricing, false)
          assert.equal(query.order, "-created_at", "New Releases means newest first")
          return { products: pool(query.collection_id ? "bug" : "any"), count: 6 }
        }
        assert.notEqual(options?.pricing, false)
        return { products: query.id.map((id) => ({ id, variants: [] })), count: query.id.length }
      },
    },
  })
  const tree = await HomePage({ audience: "women" })
  const [first, second] = tree.props.children
  assert.equal(Array.from(first.props.products, (p) => p.id).join(","), "any-0,any-1,any-2,any-3")
  assert.equal(Array.from(second.props.products, (p) => p.id).join(","), "bug-0,bug-1")
  assert.equal(calls.filter((c) => c.query.collection_id === "pcol_bug").length, 1)
  assert.equal(first.props.collections[0].slug, "bug-life", "collection cards reach every section")
})

test("the Men home fills its rows with men's and shared designs only, and only collections that have them", async () => {
  const tags = ["women", "men", "both", "women", "men", "women", undefined, "men"]
  const pool = tags.map((audience, i) => ({ id: `d-${i}`, handle: `d-${i}`, metadata: { design_slug: `d-${i}`, form: "phone", ...(audience ? { audience } : {}) } }))
  const limits = []
  const { default: HomePage } = loadSource("components/pages/home-page.tsx", {
    "@/lib/content": {
      collectionsFor: (cards, audience) => cards.filter((c) => !c.audiences || c.audiences.includes(audience)),
      getSiteContent: async (audience) => {
        assert.equal(audience, "men", "the Men home reads the Men sections")
        return {
          sections: [{ key: "new", type: "product_carousel", config: { limit: 4 } }],
          collections: [{ slug: "blooms", audiences: ["women"] }, { slug: "checkmate", audiences: ["women", "men"] }, { slug: "legacy" }],
        }
      },
    },
    "@/lib/medusa": {
      CARD_FIELDS: "id",
      listProducts: async (query) => {
        if (!query.id) { limits.push(query.limit); return { products: pool, count: pool.length } }
        return { products: query.id.map((id) => ({ id })), count: query.id.length }
      },
    },
  })
  const tree = await HomePage({ audience: "men" })
  const [row] = tree.props.children
  assert.equal(Array.from(row.props.products, (p) => p.id).join(","), "d-1,d-2,d-4,d-6")
  assert.equal(limits[0], 96, "Men looks further back to fill its row")
  assert.equal(row.props.collections.map((c) => c.slug).join(","), "checkmate,legacy")
})

function collectionFixture(audience = "women", tags = {}) {
  const phone = { name: "iPhone 17 Pro Max", slug: "iphone-17-pro-max", family: "iphone" }
  const airpods = [
    { name: "AirPods 4", slug: "airpods-4", family: "airpods" },
    { name: "AirPods Pro 3", slug: "airpods-pro-3", family: "airpods" },
  ]
  const product = (id, form, devices, caseType) => ({
    id, handle: id, title: id, thumbnail: `${id}.webp`, metadata: { design_slug: id.split("-")[0], form, ...(tags[id.split("-")[0]] ? { audience: tags[id.split("-")[0]] } : {}) },
    options: [
      { id: "device", title: "Device", values: devices.map((value) => ({ value })) },
      { id: "case", title: "Case Type", values: [{ value: caseType }] },
    ],
    variants: devices.map((d, i) => ({
      id: `${id}-v${i}`, title: `${caseType} / ${d}`,
      options: [{ option_id: "device", value: d }, { option_id: "case", value: caseType }],
    })),
  })
  const products = [
    product("bee-phone", "phone", [phone.name], "Signature"),
    product("bee-airpods", "airpods", airpods.map((d) => d.name), "Signature Earbuds"),
    product("moth-airpods", "airpods", ["AirPods Pro 3"], "Signature Earbuds"),
  ]
  const landing = {
    collection_slug: "bug-life", template: "split", theme: { bg: "#efebdd", heading_size: "xl", decor: [] },
    design_slugs: [], blocks: [{ type: "banner", heading: "Bug Life AirPods Cases", cta_href: "/collection/bug-life/?form=airpods#shop" }],
  }
  const hydrated = []
  const { default: CollectionPage } = loadSource("components/pages/collection-page.tsx", {
    react: uncachedReact,
    "next/cache": { unstable_cache: (fn) => fn },
    "next/navigation": { notFound: () => { throw new Error("unexpected 404") }, redirect: (to) => { throw new Error(`redirect ${to}`) } },
    "@/lib/catalog": { getDeviceCatalog: async () => [phone, ...airpods] },
    "@/lib/content": { getCollectionPage: async () => landing },
    "@/lib/variant-matrix": { buildVariantMatrix },
    "@/lib/product-forms": productForms,
    "@/lib/medusa": {
      sdk: { store: { collection: { list: async () => ({ collections: [{ id: "c", title: "Bug Life" }] }) } } },
      listProducts: async () => ({ products, count: products.length }),
    },
    "@/lib/collection-products": {
      COLLECTION_FIELDS: "fixture",
      hydrateCollectionProducts: async (list, device) => { hydrated.push(device); return { products: list } },
    },
  })
  const render = (query) => CollectionPage({ params: Promise.resolve({ slug: "bug-life" }), searchParams: Promise.resolve(query), audience })
  return { render, hydrated, landing }
}

test("a Men collection lists only designs for men, and says so when it has none", async () => {
  const men = collectionFixture("men", { bee: "women", moth: "men" })
  const tree = await men.render({})
  const [, filters, grid] = tree.props.children
  assert.equal(filters.props.forms.map((f) => f.value).join(","), "airpods", "no men's phone case here, so no phone tab")
  assert.equal(Array.from(grid.props.children, (card) => card.props.product.id).join(","), "moth-airpods")

  const none = collectionFixture("men", { bee: "women", moth: "women" })
  const empty = await none.render({})
  assert.match(JSON.stringify(empty.props.children[2]), /no designs for/)

  const women = collectionFixture("women", { bee: "women", moth: "men" })
  const [, womenFilters] = (await women.render({})).props.children
  assert.equal(womenFilters.props.forms.map((f) => f.value).join(","), "phone,airpods")
  await assert.rejects(women.render({ filter_gender: "men" }), { message: "redirect /men/collection/bug-life/" }, "florayn.com's Men links land on /men")
})

test("a collection opens on phone cases, themed, with its banners under the grid", async () => {
  const { render, landing } = collectionFixture()
  const tree = await render({})
  assert.equal(tree.type, "@/components/collection-shell")
  assert.equal(tree.props.theme, landing.theme)
  const [hero, filters, grid, blocks] = tree.props.children
  assert.equal(hero.type, "@/components/collection-hero")
  assert.equal(filters.props.form, "phone")
  assert.equal(filters.props.forms.map((f) => `${f.value}:${f.label}`).join(","), "phone:Phone Cases,airpods:AirPods Cases")
  assert.equal(filters.props.devices.map((d) => d.value).join(","), "iPhone 17 Pro Max")
  assert.equal(Array.from(grid.props.children, (card) => card.props.product.id).join(","), "bee-phone")
  assert.equal(blocks.type, "@/components/collection-blocks")
  assert.equal(blocks.props.blocks[0].heading, "Bug Life AirPods Cases")
  assert.equal(hero.props.fallbackImage, "bee-phone.webp")
})

test("the AirPods tab lists only AirPods models, defaulting to Pro 3", async () => {
  const { render, hydrated } = collectionFixture()
  const tree = await render({ form: "airpods" })
  const [, filters, grid] = tree.props.children
  assert.equal(filters.props.form, "airpods")
  assert.equal(filters.props.devices.map((d) => d.value).join(","), "AirPods 4,AirPods Pro 3")
  assert.equal(filters.props.device, "AirPods Pro 3")
  assert.equal(filters.props.showCaseType, false)
  assert.equal(Array.from(grid.props.children, (card) => card.props.product.id).join(","), "bee-airpods,moth-airpods")
  assert.equal(grid.props.children[0].props.deviceSlug, "airpods-pro-3")
  assert.equal(hydrated.at(-1), "AirPods Pro 3")

  // A device link alone picks its own form; an unknown form falls back to phone.
  const byDevice = await render({ device: "AirPods 4" })
  assert.equal(byDevice.props.children[1].props.form, "airpods")
  assert.equal(Array.from(byDevice.props.children[2].props.children, (card) => card.props.product.id).join(","), "bee-airpods")
  const unknown = await render({ form: "hats" })
  assert.equal(unknown.props.children[1].props.form, "phone")
})

test("only R2 and the image domain go through the optimizer", () => {
  const { canOptimize } = loadSource("components/art-image.tsx", { "next/image": { getImageProps: () => ({ props: {} }) } })
  assert.ok(canOptimize("https://pub-1af8.r2.dev/site/home/hero.webp"))
  assert.ok(canOptimize("https://img.florayn.com/a.webp"))
  assert.ok(!canOptimize("https://florayn.com/wp-content/uploads/a.webp"))
  assert.ok(!canOptimize("https://evil.example/r2.dev/a.webp"))
})
