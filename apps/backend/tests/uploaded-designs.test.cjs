const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

const seedCases = load("modules/catalog/data/case-types.ts")
const seedDevices = load("modules/catalog/data/devices.ts")
const utils = {
  Modules: { PRODUCT: "product", SALES_CHANNEL: "sales_channel", INVENTORY: "inventory" },
  ContainerRegistrationKeys: { QUERY: "query", LINK: "link" },
  ProductStatus: { PUBLISHED: "published" },
}
const { buildCard } = load("lib/build-card-metadata.ts")
const { rebuildCards } = load("lib/rebuild-cards.ts", {
  "@medusajs/framework/utils": utils,
  "./build-card-metadata": { buildCard },
})
const legacy = { slug: "legacy-design", name: "Legacy Design", case_types: ["signature", "armor-black"] }
const cases = seedCases.CASE_TYPES.map((entry) => ({ ...entry, price: entry.slug === "signature" ? 1500 : entry.slug === "alcantara" ? 4500 : entry.price }))

function catalogRoute() {
  return load("api/store/shop-catalog/route.ts", {
    "@medusajs/framework/utils": utils,
    "../../../modules/catalog": { CATALOG_MODULE: "catalog" },
    "../../../modules/catalog/data/designs": { DESIGNS: [legacy] },
    "../../../modules/catalog/data/case-types": seedCases,
  })
}

function cardsRoute() {
  return load("api/store/shop-cards/route.ts", { "@medusajs/framework/utils": utils })
}

async function requestCards(products, query) {
  let response
  let status = 200
  let queries = 0
  const scope = { resolve: () => ({ listProducts: async (filter, config) => {
    queries++
    assert.equal(filter.status, "published", "draft cards must not be exposed")
    assert.deepEqual(plain(config.select), ["handle", "metadata"])
    assert.equal(config.relations, undefined, "shop cards must never price or hydrate all variants")
    assert.ok(config.take <= 32)
    return products.filter((product) => product.status === filter.status && filter.handle.includes(product.handle))
  } }) }
  const res = { json: (body) => { response = plain(body) }, status: (code) => { status = code; return res } }
  await cardsRoute().GET({ query, scope }, res)
  return { response, status, queries }
}

function uploadHarness({ beforeCardRead = async () => {} } = {}) {
  const rows = []
  const links = []
  const writes = []
  const productService = {
    listProducts: async (filter, config) => {
      assert.ok(!config.relations?.includes("variants"), "shop catalogue must not hydrate all variants")
      const found = filter.handle ? rows.filter((row) => row.handle === filter.handle) : rows
      return filter.status ? found.filter((row) => row.status === filter.status) : found
    },
    upsertProducts: async (updates) => {
      writes.push(plain(updates))
      for (const update of updates) rows.find((row) => row.id === update.id).metadata = plain(update.metadata)
    },
  }
  const catalog = {
    listDesigns: async () => [],
    createDesigns: async (designs) => designs.map((design) => ({ ...design, id: `design-${design.slug}` })),
    listCaseTypes: async () => cases,
    listDevices: async ({ slug }) => seedDevices.DEVICES.filter((device) => device.slug === slug),
  }
  const container = { resolve: (name) => {
    if (name === "product") return productService
    if (name === "catalog") return catalog
    if (name === "sales_channel") return { listSalesChannels: async () => [{ id: "channel" }] }
    if (name === "inventory") return { listInventoryItems: async ({ sku }) => sku.map((value) => ({ id: `blank-${value}`, sku: value })) }
    if (name === "link") return { create: async (link) => links.push(plain(link)) }
    if (name === "query") return { graph: async (query) => {
      if (query.entity === "stock_location") return { data: [{ id: "location" }] }
      if (query.entity === "shipping_profile") return { data: [{ id: "shipping" }] }
      if (query.entity === "product_category") return { data: [] }
      assert.equal(query.entity, "product")
      await beforeCardRead()
      const selected = query.filters?.id ? rows.filter((row) => query.filters.id.includes(row.id)) : rows
      return { data: selected.slice(query.pagination.skip, query.pagination.skip + query.pagination.take) }
    } }
    throw new Error(`Unexpected service ${name}`)
  } }
  const { createUploadedDesign } = load("lib/create-uploaded-design.ts", {
    "@medusajs/framework/utils": utils,
    "@medusajs/medusa/core-flows": {
      createProductsWorkflow: () => ({ run: async ({ input }) => {
        for (const inputProduct of input.products) {
          const product = plain(inputProduct)
          product.id = `product-${product.handle}`
          product.options = product.options.map((option, index) => ({ ...option, id: `${product.id}-option-${index}` }))
          product.variants = product.variants.map((variant, index) => ({
            ...variant, id: `${product.id}-variant-${index}`,
            options: Object.entries(variant.options).map(([title, value]) => ({
              option_id: product.options.find((option) => option.title === title).id, value,
            })),
          }))
          rows.push(product)
        }
        return { result: rows }
      } }),
    },
    "../modules/catalog": { CATALOG_MODULE: "catalog" },
    "../modules/catalog/data/case-types": seedCases,
    "../modules/catalog/data/devices": seedDevices,
    "./rebuild-cards": { rebuildCards },
  })
  const pairs = {
    signature: {
      "iphone-17-pro-max": ["https://images.invalid/designs/future/signature/iphone-17-pro-max/1-ULID.webp", "https://images.invalid/back-ULID.webp"],
      "iphone-16-pro-max": ["https://images.invalid/designs/future/signature/iphone-16-pro-max/1-ULID.webp"],
    },
    alcantara: {
      "iphone-17-pro-max": ["https://images.invalid/alcantara-phone-ULID.webp"],
      "airpods-pro-3": ["https://images.invalid/alcantara-airpods-ULID.webp"],
    },
  }
  return {
    rows, links, writes, container, pairs,
    publish: () => createUploadedDesign({ container, name: "Future Canvas", pairs }),
    async storefrontCatalog(device) {
      let response
      await catalogRoute().GET({ scope: container, query: device ? { device } : {} }, { json: (body) => { response = plain(body) } })
      return response
    },
  }
}

test("a newly uploaded non-manifest design is indexed before success and enters the shop with its real images", async () => {
  let release
  let entered = false
  const hold = new Promise((resolve) => { release = resolve })
  const h = uploadHarness({ beforeCardRead: async () => { entered = true; await hold } })
  let returned = false
  const publication = h.publish().then((result) => { returned = true; return result })
  await new Promise(setImmediate)
  assert.equal(entered, true)
  assert.equal(returned, false, "successful creation must wait for the card index")
  release()
  const result = await publication
  assert.equal(result.products.length, 2)
  assert.equal(result.variants, 4)
  assert.equal(result.images, 5)
  assert.equal(result.blanksCreated, 0)
  const phone = h.rows.find((row) => row.metadata.form === "phone")
  const airpods = h.rows.find((row) => row.metadata.form === "airpods")
  assert.deepEqual(phone.metadata.case_type_slugs, ["signature", "alcantara"])
  const selected = phone.metadata.card.pairs["iPhone 17 Pro Max|Signature"]
  assert.equal(selected.image, h.pairs.signature["iphone-17-pro-max"][0])
  assert.equal(selected.price, 1500, "the admin's persisted case price is retained")
  assert.equal(phone.variants.find((variant) => variant.id === selected.variantId).metadata.images[1], h.pairs.signature["iphone-17-pro-max"][1])
  assert.equal(phone.metadata.card.pairs["iPhone 17 Pro Max|Alcantara"].price, 4500)
  assert.equal(airpods.metadata.card.pairs["AirPods Pro 3|Alcantara"].price, 2100, "per-device group pricing must not become the flat case price")
  assert.equal(phone.metadata.card.pairs["iPhone 16 Pro Max|Alcantara"], undefined, "only uploaded compatible pairs are sold")
  assert.ok(phone.variants.every((variant) => variant.inventory_items[0].inventory_item_id.startsWith("blank-")))
  assert.equal(h.links.length, 2)
  const catalog = await h.storefrontCatalog()
  assert.deepEqual(catalog.designs, [{ slug: "future-canvas", name: "Future Canvas", caseTypes: ["signature", "alcantara"], forms: ["phone", "airpods"] }])
  const { response } = await requestCards(h.rows, { handles: phone.handle, device: "iPhone 17 Pro Max", case_type: "Signature" })
  assert.deepEqual(response.cards, [{
    handle: phone.handle,
    variantId: selected.variantId,
    image: selected.image,
    imagesByCaseType: {
      Signature: h.pairs.signature["iphone-17-pro-max"][0],
      Alcantara: h.pairs.alcantara["iphone-17-pro-max"][0],
    },
  }])
})

test("device-filtered shop catalogue respects sparse uploaded pairs across models and forms before pagination", async () => {
  const h = uploadHarness()
  delete h.pairs.signature["iphone-16-pro-max"]
  delete h.pairs.alcantara["iphone-17-pro-max"]
  await h.publish()
  assert.deepEqual((await h.storefrontCatalog("iphone-17-pro-max")).designs, [
    { slug: "future-canvas", name: "Future Canvas", caseTypes: ["signature"], forms: ["phone"] },
  ])
  assert.deepEqual((await h.storefrontCatalog("iphone-16-pro-max")).designs, [], "a design with no matching model must not occupy a page slot")
  assert.deepEqual((await h.storefrontCatalog("airpods-pro-3")).designs, [
    { slug: "future-canvas", name: "Future Canvas", caseTypes: ["alcantara"], forms: ["airpods"] },
  ])
  assert.deepEqual((await h.storefrontCatalog("unknown-device")).designs, [])
  assert.deepEqual((await h.storefrontCatalog()).designs, [
    { slug: "future-canvas", name: "Future Canvas", caseTypes: ["signature", "alcantara"], forms: ["phone", "airpods"] },
  ], "the no-query response remains compatible with existing clients")
})

test("a card failure cannot report successful publication", async () => {
  const h = uploadHarness({ beforeCardRead: async () => { throw new Error("card read unavailable") } })
  await assert.rejects(h.publish(), /card read unavailable/)
  assert.equal(h.rows.length, 2, "creation can persist before a later indexing error and requires repair, not duplicate products")
  assert.equal(h.writes.length, 0)
})

test("shop metadata fallback admits older uploads and preserves legacy ordering without guessing unknown constructions", async () => {
  const products = [
    { handle: "legacy-design", title: "Legacy", metadata: { design_slug: "legacy-design", form: "phone" } },
    { handle: "old-upload", title: "Older upload", metadata: { design_slug: "old-upload", card: { caseTypes: ["Signature", "Alcantara"] }, form: "phone" } },
    { handle: "old-upload-airpods", metadata: { design_slug: "old-upload", card: { caseTypes: ["Alcantara"] }, form: "airpods" } },
    { handle: "new-upload", title: "New upload", metadata: { design_slug: "new-upload", case_type_slugs: ["signature", 123, "unknown"], form: "phone" } },
    { handle: "not-a-case", metadata: { design_slug: "unknown", case_type_slugs: "signature", card: { caseTypes: [null, "Unknown"] } } },
    { handle: "regular", metadata: {} },
    { handle: "draft-upload", status: "draft", metadata: { design_slug: "draft-upload", case_type_slugs: ["signature"] } },
  ]
  let result
  const scope = { resolve: (name) => name === "product" ? { listProducts: async (filter, config) => {
    assert.deepEqual(plain(filter), { status: "published" })
    assert.equal(config.relations, undefined)
    assert.ok(!config.select.some((field) => /variants|prices/.test(field)))
    return products.filter((product) => product.status !== "draft")
  } } : { listCaseTypes: async () => cases } }
  await catalogRoute().GET({ scope }, { json: (body) => { result = plain(body) } })
  assert.deepEqual(result.designs, [
    { slug: "legacy-design", name: "Legacy Design", caseTypes: ["signature", "armor-black"], forms: ["phone"] },
    { slug: "old-upload", name: "Older upload", caseTypes: ["signature", "alcantara"], forms: ["phone", "airpods"] },
    { slug: "new-upload", name: "New upload", caseTypes: ["signature"], forms: ["phone"] },
  ])
})

test("device catalogue narrowing keeps missing-card legacy fallback, uses DB device names and validates before reads", async () => {
  let reads = 0
  const products = [
    { handle: "legacy-design", metadata: { design_slug: "legacy-design", form: "phone" } },
    { handle: "legacy-design-airpods", metadata: { design_slug: "legacy-design", form: "airpods" } },
    { handle: "db-device-design", metadata: { design_slug: "db-device-design", case_type_slugs: ["signature"], card: { pairs: {
      "Future Device Name|Signature": { variantId: "new-variant" },
    } } } },
    { handle: "empty-index", metadata: { design_slug: "empty-index", case_type_slugs: ["signature"], card: { pairs: {} } } },
  ]
  const scope = { resolve: (service) => service === "product" ? { listProducts: async () => { reads++; return products } } : {
    listCaseTypes: async () => { reads++; return cases },
    listDevices: async (filter) => {
      reads++
      assert.deepEqual(plain(filter), { slug: "future-db-device", is_active: true })
      return [{ name: "Future Device Name", family: "iphone" }]
    },
  } }
  let response
  let status = 200
  const res = { json: (body) => { response = plain(body) }, status: (code) => { status = code; return res } }
  await catalogRoute().GET({ scope, query: { device: "future-db-device" } }, res)
  assert.equal(status, 200)
  assert.deepEqual(response.designs, [
    { slug: "legacy-design", name: "Legacy Design", caseTypes: ["signature", "armor-black"], forms: ["phone"] },
    { slug: "db-device-design", name: "db-device-design", caseTypes: ["signature"], forms: ["phone"] },
  ])
  for (const device of [[], "", "../private", "x".repeat(201)]) {
    const before = reads
    await catalogRoute().GET({ scope, query: { device } }, res)
    assert.equal(status, 400)
    assert.equal(reads, before)
  }
})

test("a full shop page returns only the selected device's compact cards and excludes draft products", async () => {
  const products = Array.from({ length: 32 }, (_, index) => ({
    handle: `design-${index}`, status: index === 31 ? "draft" : "published",
    metadata: { internalNote: "private", card: { pairs: Object.fromEntries(
      Array.from({ length: 39 }, (_, device) => ["Signature", "Enamel", "Alcantara", "Armor"].map((name) => [
        `Device ${device}|${name}`,
        { variantId: `variant-${index}-${device}-${name}`, price: 1400, image: `https://images.invalid/designs/design-${index}/${name.toLowerCase()}/device-${device}/1-UNIQUE-ULID.webp` },
      ])).flat(),
    ) } },
  }))
  const { response, status } = await requestCards(products, {
    handles: products.map((product) => product.handle).join(","), device: "Device 17", case_type: "Alcantara",
  })
  assert.equal(status, 200)
  assert.equal(response.cards.length, 31)
  assert.equal(response.cards[0].variantId, "variant-0-17-Alcantara")
  assert.deepEqual(Object.keys(response.cards[0].imagesByCaseType), ["Signature", "Enamel", "Alcantara", "Armor"])
  const wire = JSON.stringify(response)
  assert.ok(Buffer.byteLength(wire) < 24000, "32-card response must remain small as the model matrix grows")
  assert.ok(!wire.includes("Device 16") && !wire.includes("device-16"))
  assert.ok(!wire.includes("private") && !wire.includes('"price"') && !wire.includes('"metadata"'))
})

test("shop cards handle sparse or malformed indexes and reject unbounded input before querying", async () => {
  const rows = [{ handle: "new-design", status: "published", metadata: { card: { pairs: {
    "iPhone 17 Pro Max|Signature": { image: "javascript:invalid", variantId: 123 },
    "iPhone 16 Pro Max|Alcantara": { image: "https://images.invalid/other-device.webp", variantId: "other" },
  } } } }]
  const base = { handles: "new-design", device: "iPhone 17 Pro Max", case_type: "Signature" }
  const { response } = await requestCards(rows, base)
  assert.deepEqual(response.cards, [{ handle: "new-design", variantId: null, image: null, imagesByCaseType: {} }])
  for (const query of [
    { ...base, handles: Array.from({ length: 33 }, (_, i) => `design-${i}`).join(",") },
    { ...base, handles: ["new-design"] },
    { ...base, handles: "" },
    { ...base, handles: "../private" },
    { ...base, device: "device|case" },
    { ...base, case_type: "" },
  ]) {
    const result = await requestCards(rows, query)
    assert.equal(result.status, 400)
    assert.equal(result.queries, 0)
  }
})
