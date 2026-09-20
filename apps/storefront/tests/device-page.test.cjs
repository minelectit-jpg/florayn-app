const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/device-page.ts"),
  "utf8"
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

const iphone = {
  id: "device_iphone",
  slug: "iphone-17-pro-max",
  name: "iPhone 17 Pro Max",
  family: "iphone",
  brand: "Apple",
}

function product(handle, deviceName = iphone.name) {
  return {
    id: `product_${handle}`,
    title: handle,
    handle,
    metadata: { design_name: "Amber Leopard" },
    variants: [{
      id: "variant_case",
      options: [{ value: deviceName }],
      metadata: { images: ["https://example.test/case.webp"] },
    }],
  }
}

function loadResolver({ devices = [iphone], products = [] } = {}) {
  const queries = []
  let catalogCalls = 0
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    structuredClone,
    require(name) {
      if (name === "react") {
        return {
          // An isolated request cache lets the test exercise multiple consumers
          // of the same resolver without a running Next server.
          cache: (fn) => {
            const entries = new Map()
            return (slug) => {
              if (!entries.has(slug)) entries.set(slug, fn(slug))
              return entries.get(slug)
            }
          },
        }
      }
      if (name === "@/lib/catalog") {
        return {
          getDeviceCatalog: async () => {
            catalogCalls += 1
            return devices
          },
        }
      }
      if (name === "@/lib/medusa") {
        return {
          PRODUCT_FIELDS_NOPRICE: "product-fields-without-prices",
          listProducts: async (query) => {
            queries.push(JSON.parse(JSON.stringify(query)))
            const handles = [].concat(query.handle)
            return { products: products.filter((p) => handles.includes(p.handle)) }
          },
        }
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(compiled, context, { filename: "device-page.ts" })
  return {
    ...module.exports,
    queries,
    catalogCalls: () => catalogCalls,
  }
}

test("a device URL resolves using one combined exact/base lookup", async () => {
  const resolver = loadResolver({ products: [product("amber-leopard")] })
  const result = await resolver.resolveProductPage("amber-leopard-iphone-17-pro-max")

  assert.equal(result.baseHandle, "amber-leopard")
  assert.equal(result.device.slug, iphone.slug)
  assert.deepEqual(resolver.queries, [{
    handle: ["amber-leopard-iphone-17-pro-max", "amber-leopard"],
    limit: 2,
    fields: "product-fields-without-prices",
  }])
})

test("an exact device-shaped product handle wins even when the base is returned first", async () => {
  const slug = "amber-leopard-iphone-17-pro-max"
  const resolver = loadResolver({
    products: [product("amber-leopard"), product(slug, "Different Device")],
  })
  const result = await resolver.resolveProductPage(slug)

  assert.equal(result.product.handle, slug)
  assert.equal(result.baseHandle, slug)
  assert.equal(result.device, null)
  assert.equal(resolver.queries.length, 1)
})

test("an unavailable device catalogue still permits exact product handles", async () => {
  const slug = "amber-leopard-iphone-17-pro-max"
  const resolver = loadResolver({ devices: [], products: [product(slug)] })
  const result = await resolver.resolveProductPage(slug)

  assert.equal(result.product.handle, slug)
  assert.equal(result.device, null)
  assert.equal(resolver.queries[0].handle, slug)
  assert.equal(resolver.queries[0].limit, 1)
})

test("ordinary product URLs use one exact lookup", async () => {
  const resolver = loadResolver({ products: [product("amber-leopard")] })
  const result = await resolver.resolveProductPage("amber-leopard")

  assert.equal(result.product.handle, "amber-leopard")
  assert.equal(result.device, null)
  assert.equal(resolver.queries.length, 1)
  assert.equal(resolver.queries[0].handle, "amber-leopard")
})

test("a base product incompatible with the requested device does not create a page", async () => {
  const resolver = loadResolver({ products: [product("amber-leopard", "iPhone 12")] })
  assert.equal(
    await resolver.resolveProductPage("amber-leopard-iphone-17-pro-max"),
    null
  )
})

test("unknown handles and missing base products resolve to not found", async () => {
  const resolver = loadResolver()
  assert.equal(await resolver.resolveProductPage("missing-product"), null)
  assert.equal(await resolver.resolveProductPage("missing-iphone-17-pro-max"), null)
})

test("the longest matching device slug wins without reordering the catalogue", async () => {
  const short = { ...iphone, id: "short", slug: "max", name: "Max" }
  const devices = [short, iphone]
  const resolver = loadResolver({ devices, products: [product("amber-leopard")] })
  const result = await resolver.resolveProductPage("amber-leopard-iphone-17-pro-max")

  assert.equal(result.device.slug, iphone.slug)
  assert.equal(resolver.queries[0].handle[1], "amber-leopard")
  assert.equal(devices[0], short)
})

test("metadata and page share a lookup but receive separate mutable product data", async () => {
  const original = product("amber-leopard")
  const resolver = loadResolver({ products: [original] })
  const [metadata, page] = await Promise.all([
    resolver.resolveProductPage("amber-leopard"),
    resolver.resolveProductPage("amber-leopard"),
  ])

  page.product.variants[0].calculated_price = { calculated_amount: 1400 }
  page.product.variants[0].metadata.images.push("https://example.test/another.webp")
  page.product.metadata.design_name = "Changed in page"

  assert.equal(resolver.queries.length, 1)
  assert.equal(resolver.catalogCalls(), 1)
  assert.equal(metadata.product.variants[0].calculated_price, undefined)
  assert.equal(metadata.product.variants[0].metadata.images.length, 1)
  assert.equal(metadata.product.metadata.design_name, "Amber Leopard")
  assert.equal(original.metadata.design_name, "Amber Leopard")
})

test("product device links retain the contractual path and trailing slash", () => {
  const resolver = loadResolver()
  assert.equal(
    resolver.devicePageHref("amber-leopard", "iphone-17-pro-max"),
    "/product/amber-leopard-iphone-17-pro-max/"
  )
})
