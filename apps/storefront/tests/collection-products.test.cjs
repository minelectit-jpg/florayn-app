const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/lib/collection-products.ts")
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const plain = (value) => JSON.parse(JSON.stringify(value))

function product() {
  const variant = (id, caseType, device) => ({
    id, title: `${caseType} / ${device}`,
    options: [{ option_id: "case", value: caseType }, { option_id: "device", value: device }],
  })
  return {
    id: "p1", handle: "example-phone", title: "Example",
    thumbnail: "https://images.invalid/fallback.webp",
    images: [{ id: "hover", url: "https://images.invalid/hover.webp" }],
    metadata: { form: "phone" },
    variants: [
      variant("first", "Signature", "iPhone 14"),
      variant("other", "Armor", "iPhone 14"),
      variant("selected", "Signature", "iPhone 17"),
      variant("alcantara", "Alcantara", "iPhone 17"),
    ],
  }
}

function harness({ fetchDetails, fetchProducts, region = async () => "region-bd", timers = { setTimeout, clearTimeout } } = {}) {
  const entries = new Map()
  const queries = []
  const fallbackQueries = []
  const registrations = []
  const exports = {}
  let active = 0
  let maximumActive = 0
  vm.runInNewContext(compiled, {
    exports,
    console: { error() {} },
    AbortSignal: { timeout: () => ({ testSignal: true }) },
    ...timers,
    require(name) {
      if (name === "next/cache") return {
        unstable_cache(fn, keyParts, options) {
          registrations.push(options)
          const key = JSON.stringify(keyParts)
          return async () => {
            if (!entries.has(key)) entries.set(key, await fn())
            return entries.get(key)
          }
        },
      }
      if (name === "@/lib/medusa") return {
        getRegionId: region,
        sdk: { client: { fetch: async (url, options) => {
          assert.ok(["/store/product-variants", "/store/products"].includes(url))
          assert.equal(options.query.region_id, "region-bd")
          assert.ok(options.signal)
          if (url === "/store/product-variants") {
            assert.equal(options.query.fields, "id,title,metadata,calculated_price.calculated_amount,calculated_price.currency_code")
          }
          const calls = url === "/store/products" ? fallbackQueries : queries
          calls.push(plain(options.query))
          active++
          maximumActive = Math.max(maximumActive, active)
          try {
            await new Promise((resolve) => setImmediate(resolve))
            if (url === "/store/products") {
              if (!fetchProducts) throw new Error("fallback unavailable")
              return await fetchProducts(options.query, fallbackQueries.length)
            }
            return fetchDetails
              ? await fetchDetails(options.query, queries.length)
              : { variants: options.query.id.map((id) => ({ id, title: id, calculated_price: null })) }
          } finally {
            active--
          }
        } } },
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return { ...exports, entries, queries, fallbackQueries, registrations, maximumActive: () => maximumActive }
}

test("collection requests selected device in every construction plus the first variant for sorting", () => {
  const { collectionVariantIds } = harness()
  assert.deepEqual(plain(collectionVariantIds([product()], "iPhone 17")), ["alcantara", "first", "selected"])
  assert.deepEqual(plain(collectionVariantIds([product()], "missing-device")), ["alcantara", "first", "other", "selected"])
  assert.deepEqual(plain(collectionVariantIds([product()], "")), ["alcantara", "first", "other", "selected"])
})

test("non-price sorts omit only the unused first variant and preserve the all-variant fallback", () => {
  const { collectionVariantIds } = harness()
  assert.deepEqual(plain(collectionVariantIds([product()], "iPhone 17", false)), ["alcantara", "selected"])
  assert.deepEqual(plain(collectionVariantIds([product()], "missing-device", false)), ["alcantara", "first", "other", "selected"])
  assert.deepEqual(plain(collectionVariantIds([product()], "", false)), ["alcantara", "first", "other", "selected"])
})

test("actual per-device prices and galleries merge by ID without changing compatibility or input data", async () => {
  const source = product()
  const before = structuredClone(source)
  const amounts = { first: 900, selected: 1400, alcantara: 2300 }
  const loader = harness({ fetchDetails: async (query) => ({
    variants: [...query.id].reverse().map((id) => ({
      id, title: source.variants.find((variant) => variant.id === id).title,
      calculated_price: { calculated_amount: amounts[id], currency_code: "bdt", original_amount: 9999 },
      metadata: { images: [`https://images.invalid/${id}.webp`, `https://images.invalid/${id}-back.webp`], unused: "omit" },
    })),
  }) })
  const result = await loader.hydrateCollectionProducts([source], "iPhone 17")
  assert.equal(result.error, undefined)
  const hydrated = result.products[0]
  assert.deepEqual(plain(hydrated.variants.map((variant) => variant.id)), source.variants.map((variant) => variant.id))
  assert.equal(hydrated.variants[0].calculated_price.calculated_amount, 900)
  assert.equal(hydrated.variants[2].calculated_price.calculated_amount, 1400)
  assert.equal(hydrated.variants[3].calculated_price.calculated_amount, 2300)
  assert.equal(hydrated.variants[3].calculated_price.currency_code, "bdt")
  assert.deepEqual(plain(hydrated.variants[3].metadata.images), ["https://images.invalid/alcantara.webp", "https://images.invalid/alcantara-back.webp"])
  assert.deepEqual(plain(hydrated.variants[3].options), source.variants[3].options)
  assert.equal(hydrated.thumbnail, source.thumbnail)
  assert.deepEqual(plain(hydrated.images), source.images)
  assert.deepEqual(source, before)
  assert.deepEqual(plain(loader.registrations[0].tags), ["products", "product:example-phone"])
  await loader.hydrateCollectionProducts([source], "iPhone 17")
  assert.equal(loader.queries.length, 1, "successful pricing details should be reused")
})

test("a backend error stays uncached and a later request recovers", async () => {
  const loader = harness({ fetchDetails: async (query, attempt) => {
    if (attempt === 1) throw new Error("temporary backend failure")
    return { variants: query.id.map((id) => ({ id, title: id, calculated_price: { calculated_amount: 1900, currency_code: "bdt" } })) }
  } })
  await assert.rejects(loader.hydrateCollectionProducts([product()], "iPhone 17"), /fallback unavailable/)
  assert.equal(loader.entries.size, 0)
  const recovered = await loader.hydrateCollectionProducts([product()], "iPhone 17")
  assert.equal(recovered.error, undefined)
  assert.equal(recovered.products[0].variants[3].calculated_price.calculated_amount, 1900)
  assert.equal(loader.queries.length, 2)
})

test("a partial response cannot poison cache; explicit null prices remain null when complete", async () => {
  const loader = harness({ fetchDetails: async (query, attempt) => ({
    variants: (attempt === 1 ? query.id.slice(0, 1) : query.id).map((id) => ({ id, title: id, calculated_price: null })),
  }) })
  await assert.rejects(loader.hydrateCollectionProducts([product()], "iPhone 17"), /fallback unavailable/)
  assert.equal(loader.entries.size, 0)
  const recovered = await loader.hydrateCollectionProducts([product()], "iPhone 17")
  assert.equal(recovered.error, undefined)
  assert.equal(recovered.products[0].variants[3].calculated_price, null)
  assert.deepEqual(plain(recovered.products[0].variants[3].metadata.images), [])
})

test("large device scopes use bounded sequential batches and preserve every variant", async () => {
  const source = product()
  source.variants = Array.from({ length: 205 }, (_, i) => ({ id: `variant-${i}`, title: `Variant ${i}`, options: [{ value: "iPhone 17" }] }))
  const loader = harness()
  const result = await loader.hydrateCollectionProducts([source], "iPhone 17")
  assert.equal(result.error, undefined)
  assert.equal(result.products[0].variants.length, 205)
  assert.deepEqual(loader.queries.map((query) => query.id.length), [100, 100, 5])
  assert.equal(loader.maximumActive(), 1)
})

test("missing pricing region does not call the endpoint or store a failure", async () => {
  let currentRegion
  const loader = harness({ region: async () => currentRegion })
  await assert.rejects(loader.hydrateCollectionProducts([product()], "iPhone 17"), /pricing region is unavailable/)
  assert.equal(loader.queries.length, 0)
  assert.equal(loader.entries.size, 0)
  currentRegion = "region-bd"
  assert.equal((await loader.hydrateCollectionProducts([product()], "iPhone 17")).error, undefined)
})

test("a stalled pricing-region lookup rejects without waiting indefinitely or caching empty data", async () => {
  let cancelled = false
  const loader = harness({
    region: () => new Promise(() => {}),
    timers: {
      setTimeout(callback) { queueMicrotask(callback); return 1 },
      clearTimeout() { cancelled = true },
    },
  })
  await assert.rejects(loader.hydrateCollectionProducts([product()], "iPhone 17"), /pricing region request timed out/)
  assert.equal(loader.queries.length, 0)
  assert.equal(loader.entries.size, 0)
  assert.equal(cancelled, true)
})

test("variant endpoint failure falls back to complete actual-priced products in source order", async () => {
  const source = product()
  const second = { ...product(), id: "p2", handle: "second-phone" }
  const fullProducts = [source, second].map((entry, i) => ({
    ...entry,
    variants: entry.variants.map((variant) => ({
      ...variant,
      calculated_price: { calculated_amount: 1900 + i * 300, currency_code: "bdt" },
      metadata: { images: [`https://images.invalid/${entry.id}-${variant.id}.webp`] },
    })),
  }))
  const loader = harness({
    fetchDetails: async () => { throw new Error("variant endpoint unavailable") },
    fetchProducts: async (query) => {
      assert.deepEqual(plain(query.id), ["p1", "p2"])
      assert.match(query.fields, /variants\.calculated_price/)
      assert.match(query.fields, /variants\.metadata/)
      return { products: [...fullProducts].reverse() }
    },
  })
  const result = await loader.hydrateCollectionProducts([source, second], "iPhone 17")
  assert.deepEqual(plain(result.products.map((entry) => entry.id)), ["p1", "p2"])
  assert.equal(result.products[0].variants[3].calculated_price.calculated_amount, 1900)
  assert.equal(result.products[1].variants[3].calculated_price.calculated_amount, 2200)
  assert.equal(result.products[1].variants[3].metadata.images[0], "https://images.invalid/p2-alcantara.webp")
  await loader.hydrateCollectionProducts([source, second], "iPhone 17")
  assert.equal(loader.fallbackQueries.length, 1, "successful fallback data can be reused")
})

test("a partial legacy fallback throws before caching and can recover on a later request", async () => {
  const source = product()
  const loader = harness({
    fetchDetails: async () => { throw new Error("variant endpoint unavailable") },
    fetchProducts: async (_query, attempt) => ({ products: attempt === 1 ? [] : [source] }),
  })
  await assert.rejects(loader.hydrateCollectionProducts([source], "iPhone 17"), /product response was incomplete/)
  assert.equal(loader.entries.size, 0)
  const recovered = await loader.hydrateCollectionProducts([source], "iPhone 17")
  assert.equal(recovered.products[0].id, source.id)
  assert.equal(loader.fallbackQueries.length, 2)
})
