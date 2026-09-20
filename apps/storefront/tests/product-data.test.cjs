const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function loadSource(relativePath, dependencies = {}, globals = {}) {
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

const plain = (value) => JSON.parse(JSON.stringify(value))
const { productViewMatrix, productViewVariants } = loadSource("lib/product-view-data.ts")
const { buildVariantMatrix, pairKey } = loadSource("lib/variant-matrix.ts")

function fixture() {
  return {
    id: "phone-case", title: "Example case", handle: "example-phone",
    options: [
      { id: "case", title: "Case Type", values: [{ value: "Signature" }, { value: "Alcantara" }] },
      { id: "device", title: "Device", values: [{ value: "iPhone 14" }, { value: "iPhone 17" }] },
    ],
    variants: [
      {
        id: "signature-14", title: "Signature / iPhone 14",
        sku: "INTERNAL-SKU", inventory_quantity: 15, manage_inventory: true,
        options: [{ option_id: "case", value: "Signature" }, { option_id: "device", value: "iPhone 14" }],
        calculated_price: { calculated_amount: 0, currency_code: "bdt", original_amount: 2000 },
        metadata: { images: ["https://images.invalid/front.webp", "https://images.invalid/back.webp"], internal_data: "unused" },
      },
      {
        id: "signature-17", title: "Signature / iPhone 17",
        options: [{ option_id: "case", value: "Signature" }, { option_id: "device", value: "iPhone 17" }],
        calculated_price: { calculated_amount: 1700, currency_code: "bdt" },
        metadata: { images: ["https://images.invalid/17.webp"] },
      },
      {
        id: "alcantara-17", title: "Alcantara / iPhone 17",
        options: [{ option_id: "case", value: "Alcantara" }, { option_id: "device", value: "iPhone 17" }],
        calculated_price: null, metadata: null,
      },
    ],
  }
}

test("compact variants preserve identity, prices, currency and galleries without unused fields", () => {
  const product = fixture()
  product.variants.push({ id: "unpriced", title: "No price or metadata" })
  const original = structuredClone(product.variants)
  const compact = productViewVariants(product.variants)
  assert.equal(compact.length, original.length)
  for (let i = 0; i < compact.length; i++) {
    assert.equal(compact[i].id, original[i].id)
    assert.equal(compact[i].title, original[i].title)
    assert.equal(compact[i].calculated_price?.calculated_amount, original[i].calculated_price?.calculated_amount)
    assert.equal(compact[i].calculated_price?.currency_code, original[i].calculated_price?.currency_code)
    assert.deepEqual(plain(compact[i].metadata.images), original[i].metadata?.images ?? [])
    for (const removed of ["sku", "options", "inventory_quantity", "manage_inventory"]) {
      assert.equal(Object.hasOwn(compact[i], removed), false)
    }
    assert.deepEqual(Object.keys(compact[i].metadata), ["images"])
  }
  assert.equal(compact[2].calculated_price, null)
  assert.equal(compact[3].calculated_price, undefined)
  assert.equal(Object.hasOwn(compact[0].calculated_price, "original_amount"), false)
  assert.deepEqual(product.variants, original, "projection must not strip the cached source object")
})

test("compact matrix retains all valid selector pairs without duplicating variant payloads", () => {
  const full = buildVariantMatrix(fixture())
  const matrix = productViewMatrix(full)
  const variants = productViewVariants(fixture().variants)
  assert.equal(Object.hasOwn(matrix, "pairs"), false)
  const { pairs, ...lookups } = full
  assert.deepEqual(plain(matrix), plain(lookups))
  for (const pair of pairs) {
    const id = matrix.variantIdByPair[pairKey(pair.caseType, pair.device)]
    assert.equal(id, pair.variant.id)
    assert.ok(variants.some((variant) => variant.id === id))
  }
  assert.equal(matrix.variantIdByPair[pairKey("Alcantara", "iPhone 14")], undefined)
  assert.deepEqual(plain(matrix.devicesByCaseType.Alcantara), ["iPhone 17"])
})

function findComponent(node, type) {
  if (!node || typeof node !== "object") return undefined
  if (node.type === type) return node
  const children = Array.isArray(node) ? node : [node.props?.children]
  for (const child of children) {
    const match = findComponent(child, type)
    if (match) return match
  }
  return undefined
}

test("projected data still selects valid fallback devices, null prices and fallback gallery images", () => {
  const states = []
  let cursor = 0
  const { default: ProductView } = loadSource("components/product-view.tsx", {
    react: {
      useMemo: (fn) => fn(),
      useEffect() {},
      useState(initial) {
        const slot = cursor++
        if (!(slot in states)) states[slot] = initial
        return [states[slot], (value) => { states[slot] = value }]
      },
    },
    "@/lib/variant-matrix": { pairKey },
    "@/lib/product-forms": { featuresGroup: () => undefined },
  })
  const product = fixture()
  const props = {
    matrix: productViewMatrix(buildVariantMatrix(product)),
    variants: productViewVariants(product.variants),
    initialCaseType: "Signature", initialDevice: "iPhone 14",
    families: {}, stock: {}, fallbackImages: ["https://images.invalid/fallback.webp"],
    designName: "Example", productHandle: product.handle, productTitle: product.title,
    tabs: null, pairs: null,
  }
  const render = () => {
    cursor = 0
    const tree = ProductView(props)
    return {
      box: findComponent(tree, "@/components/product-buy-box").props,
      gallery: findComponent(tree, "@/components/product-gallery").props,
    }
  }
  let view = render()
  assert.equal(view.box.selected.id, "signature-14")
  assert.equal(view.box.priceForCaseType("Signature"), 0, "a zero price must remain zero")
  assert.equal(view.box.priceForCaseType("Alcantara"), null)
  assert.equal(view.gallery.items.length, 2)
  view.box.onSelectCaseType("Alcantara")
  view = render()
  assert.equal(view.box.device, "iPhone 17", "unsupported current device must switch to an available pair")
  assert.equal(view.box.selected.id, "alcantara-17")
  assert.equal(view.box.selected.calculated_price, null)
  assert.equal(view.gallery.items[0].url, props.fallbackImages[0])
  view.box.onSelectDevice("iPhone 14")
  view = render()
  assert.equal(view.box.caseType, "Signature")
  assert.equal(view.box.selected.id, "signature-14")
  assert.equal(view.gallery.items[0].url, product.variants[0].metadata.images[0])
})

function loadProductCache() {
  const entries = new Map()
  const registrations = []
  let productCalls = 0
  let regionCalls = 0
  const sdk = {
    store: {
      region: { list: async () => { regionCalls++; return { regions: [{ id: "region-bd" }] } } },
      product: { list: async (query) => {
        productCalls++
        assert.equal(query.region_id, "region-bd")
        return { products: [{ id: `revision-${productCalls}` }], count: 1 }
      } },
    },
  }
  const { listProducts } = loadSource("lib/medusa.ts", {
    "@medusajs/js-sdk": { __esModule: true, default: class { constructor() { return sdk } } },
    "next/cache": {
      unstable_cache(fn, keyParts, options) {
        registrations.push(options)
        const key = JSON.stringify(keyParts)
        return async () => {
          if (!entries.has(key)) entries.set(key, { value: await fn(), tags: options.tags })
          return entries.get(key).value
        }
      },
    },
  }, {
    process: { env: { NODE_ENV: "test", NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "test-public-key" } },
    // Product calls resolve immediately; do not create a real 15-second timer.
    setTimeout: () => 0,
  })
  return {
    listProducts, registrations,
    productCalls: () => productCalls,
    regionCalls: () => regionCalls,
    invalidate(tag) {
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key)
    },
  }
}

test("invalidating either handle refreshes a combined exact/base product lookup", async () => {
  const cache = loadProductCache()
  const query = { handle: ["example-phone-iphone-17", "example-phone", "example-phone"], limit: 2 }
  const first = await cache.listProducts(query)
  assert.equal((await cache.listProducts(query)).products[0].id, first.products[0].id)
  assert.equal(cache.productCalls(), 1)
  assert.deepEqual(Array.from(cache.registrations[0].tags), ["products", "product:example-phone-iphone-17", "product:example-phone"])
  cache.invalidate("product:example-phone")
  assert.equal((await cache.listProducts(query)).products[0].id, "revision-2")
  cache.invalidate("product:example-phone-iphone-17")
  assert.equal((await cache.listProducts(query)).products[0].id, "revision-3")
  assert.equal(cache.regionCalls(), 1)
})

test("scalar handles remain individually invalidatable and non-string values never become tags", async () => {
  const cache = loadProductCache()
  await cache.listProducts({ handle: "example-phone", limit: 1 })
  assert.deepEqual(Array.from(cache.registrations[0].tags), ["products", "product:example-phone"])
  await cache.listProducts({ handle: ["example-phone", null, 42, "another-phone"], limit: 2 })
  assert.deepEqual(Array.from(cache.registrations[1].tags), ["products", "product:example-phone", "product:another-phone"])
})
