const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(relativePath, dependencies = {}, globals = {}) {
  const filename = path.resolve(__dirname, "../src", relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, {
    exports, console: { warn() {} }, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const helpers = load("lib/revalidation.ts")

test("explicit domain and handle invalidation never implicitly invalidates root", () => {
  const plan = plain(helpers.revalidationPlan({ tags: ["stock"], handles: ["legends"], paths: ["/product/legends/"] }))
  assert.equal(plan.all, false)
  assert.deepEqual(plan.tags, ["stock", "product:legends"])
  assert.deepEqual(plan.paths, ["/product/legends", "/product/legends/"])
  assert.ok(!plan.cacheTags.includes("_N_T_/layout"))
  assert.ok(!plan.tags.includes("products"))
})

test("manual all invalidates every data domain and the implicit root layout tag", () => {
  const plan = plain(helpers.revalidationPlan({ all: true }))
  assert.deepEqual(plan.tags, ["products", "catalog", "content", "bundles", "seo", "stock"])
  assert.ok(plan.cacheTags.includes("_N_T_/layout"))
})

test("invalidation rejects empty, excessive and malformed targets", () => {
  for (const value of [null, [], {}, { all: "true" }, { typo: true }, { tags: ["_N_T_/layout"] },
    { tags: Array(65).fill("stock") }, { handles: Array(65).fill("example") }, { paths: Array(33).fill("/") },
    { tags: ["content:"] }, { handles: ["../admin"] }, { paths: ["https://other.invalid/"] },
    { paths: ["//other.invalid/"] }, { paths: ["/api/revalidate/"] }, { paths: ["/product/[slug]"] },
    { paths: ["/product/example?case=signature"] }, { paths: ["/a/../b"] },
  ]) assert.throws(() => helpers.revalidationPlan(value))
})

function routeHarness({ fail = false } = {}) {
  const events = []
  const route = load("app/api/revalidate/route.ts", {
    "@/lib/revalidation": helpers,
    "../../../../cache-handler": { async invalidateTags(tags) {
      events.push(["redis", ...tags])
      if (fail) throw new Error("offline")
    } },
    "next/cache": {
      revalidatePath: (...args) => events.push(["path", ...args]),
      revalidateTag: (tag) => events.push(["tag", tag]),
    },
    "next/server": { NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) } },
  }, { process: { env: { REVALIDATE_SECRET: "test-secret" } } })
  const request = (body = "", query = "", authenticated = true) => ({
    text: async () => body,
    nextUrl: new URL(`http://unused.invalid/api/revalidate/${query}`),
    headers: new Headers(authenticated ? { "x-revalidate-secret": "test-secret" } : {}),
  })
  return { route, events, request }
}

test("API authenticates and validates before touching Redis", async () => {
  const { route, events, request } = routeHarness()
  assert.equal((await route.POST(request('{"all":true}', "", false))).status, 401)
  assert.equal((await route.POST(request("{}"))).status, 400)
  assert.equal((await route.POST(request("{"))).status, 400)
  assert.equal((await route.POST(request(" ".repeat(16385)))).status, 400)
  assert.equal(events.length, 0)
})

test("API acknowledges Redis first and targets only the requested domain", async () => {
  const { route, events, request } = routeHarness()
  const response = await route.POST(request('{"tags":["content:product-sections"]}'))
  assert.equal(response.status, 200)
  assert.deepEqual(plain(events), [["redis", "content:product-sections"], ["tag", "content:product-sections"]])
})

test("API returns retriable failure when Redis cannot acknowledge invalidation", async () => {
  const { route, events, request } = routeHarness({ fail: true })
  assert.equal((await route.POST(request('{"tags":["stock"]}'))).status, 503)
  assert.equal(events.length, 1)
})

test("legacy empty manual refresh remains global, while handle requests are targeted", async () => {
  const { route, events, request } = routeHarness()
  assert.equal((await route.POST(request())).status, 200)
  assert.ok(events.some((event) => event[0] === "path" && event[1] === "/" && event[2] === "layout"))
  events.length = 0
  assert.equal((await route.POST(request("", "?handle=example"))).status, 200)
  assert.deepEqual(plain(events), [["redis", "product:example"], ["tag", "product:example"]])
})

test("native storefront data requests carry their invalidation domain tags", async () => {
  const requests = []
  const globals = {
    process: { env: {} },
    fetch: async (url, options) => {
      requests.push({ url, tags: options.next.tags })
      return { ok: true, json: async () => ({}) }
    },
  }
  const medusa = { MEDUSA_BACKEND_URL: "http://unused.invalid", MEDUSA_PUBLISHABLE_KEY: "test-public-key" }
  const content = load("lib/content.ts", {}, globals)
  const catalog = load("lib/catalog.ts", { "./medusa": medusa }, globals)
  const bundles = load("lib/bundles.ts", {}, globals)
  const seo = load("lib/seo-copy.ts", {}, globals)
  await content.getSiteContent()
  await content.getProductSections()
  await content.getCollectionPage("floral")
  await content.getGalleryVideos("legends")
  await content.getCaseTypes()
  await catalog.getDeviceCatalog()
  await catalog.getShopCatalog()
  await catalog.getBlankStock()
  await bundles.getBundleConfig()
  await seo.getSeoConfig()
  const tagsAt = (suffix) => requests.find((entry) => entry.url.endsWith(suffix))?.tags ?? []
  assert.ok(tagsAt("/store/content").includes("content:site"))
  assert.ok(tagsAt("/store/content/product-sections").includes("content:product-sections"))
  assert.ok(tagsAt("/store/collection-pages/floral").includes("content:collection:floral"))
  assert.ok(tagsAt("/store/content/gallery-videos?design=legends").includes("product:legends"))
  assert.ok(tagsAt("/store/case-types").includes("catalog:case-types"))
  assert.ok(tagsAt("/store/devices").includes("catalog:devices"))
  assert.ok(tagsAt("/store/shop-catalog").includes("catalog:shop-catalog"))
  assert.deepEqual(plain(tagsAt("/store/stock")), ["stock"])
  assert.deepEqual(plain(tagsAt("/store/bundles")), ["bundles"])
  assert.deepEqual(plain(tagsAt("/store/seo")), ["seo"])
})
