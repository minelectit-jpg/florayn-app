const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src/lib", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...globals, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

function harness(responses = [{ status: 200, body: { ok: true } }], env = {}) {
  const requests = []
  const waits = []
  const warnings = []
  const timers = new Map()
  let nextTimer = 1
  let active = 0
  let maximumActive = 0
  const api = load("revalidate-storefront.ts", {
    "node:timers/promises": { setTimeout: async (ms) => { waits.push(ms) } },
  }, {
    process: { env: { STOREFRONT_URL: "https://new.florayn.com///", REVALIDATE_SECRET: "test-secret-only", ...env } },
    console: { warn: (message) => warnings.push(message) },
    AbortSignal: { timeout: (ms) => ({ timeout: ms }) },
    setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id },
    fetch: async (url, options) => {
      const response = responses[Math.min(requests.length, responses.length - 1)]
      requests.push({ url, options: plain(options) })
      active++
      maximumActive = Math.max(maximumActive, active)
      if (response.error) { active--; throw new Error(response.error) }
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => {
          await new Promise(setImmediate)
          active--
          if (response.invalidJson) throw new Error("invalid json")
          return response.body
        },
      }
    },
  })
  return {
    ...api, requests, waits, warnings, timers,
    maximumActive: () => maximumActive,
    async tick() {
      const [id, callback] = timers.entries().next().value
      timers.delete(id)
      callback()
      await new Promise(setImmediate)
    },
  }
}

test("refresh uses a header secret and bounded retries for transport and server failures", async () => {
  const h = harness([{ status: 503 }, { error: "timeout" }, { status: 200, body: { ok: true } }])
  assert.equal(await h.revalidateStorefront({ tags: ["products"] }), true)
  assert.equal(h.requests.length, 3)
  assert.deepEqual(h.waits, [250, 500])
  for (const { url, options } of h.requests) {
    assert.equal(url, "https://new.florayn.com/api/revalidate/")
    assert.ok(!url.includes("test-secret-only"))
    assert.equal(options.headers["x-revalidate-secret"], "test-secret-only")
    assert.equal(options.method, "POST")
    assert.equal(options.redirect, "error")
    assert.equal(options.signal.timeout, 5000)
    assert.deepEqual(JSON.parse(options.body), { tags: ["products"] })
  }
  assert.equal(h.warnings.length, 0)
})

test("delivery failures stop at three attempts, log safely and do not count malformed success as delivered", async () => {
  const h = harness([{ status: 200, invalidJson: true }])
  assert.equal(await h.revalidateStorefront({ paths: ["/product/example/"] }), false)
  assert.equal(h.requests.length, 3)
  assert.equal(h.warnings.length, 1)
  assert.doesNotMatch(h.warnings[0], /test-secret-only|example/)
  const unauthorized = harness([{ status: 401 }])
  assert.equal(await unauthorized.revalidateStorefront(), false)
  assert.equal(unauthorized.requests.length, 1)
  assert.equal(unauthorized.waits.length, 0)
  const limited = harness([{ status: 429 }, { status: 200, body: { ok: true } }])
  assert.equal(await limited.revalidateStorefront(), true)
  assert.equal(limited.requests.length, 2)
})

test("missing refresh configuration fails visibly without an outbound request", async () => {
  const h = harness(undefined, { REVALIDATE_SECRET: "" })
  assert.equal(await h.revalidateStorefront(), false)
  assert.equal(h.requests.length, 0)
  assert.equal(h.warnings.length, 1)
})

test("coalesced saves deduplicate tags, paths and handles before all callers resolve", async () => {
  const h = harness()
  const first = h.queueStorefrontRevalidation({ tags: ["products"], handles: ["one"], paths: ["/shop/"] })
  const second = h.queueStorefrontRevalidation({ tags: ["products", "catalog"], handles: ["one", "two"] })
  assert.equal(h.timers.size, 1)
  assert.equal(h.requests.length, 0)
  await h.tick()
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.equal(h.requests.length, 1)
  const body = JSON.parse(h.requests[0].options.body)
  assert.deepEqual(body.tags, ["products", "catalog"])
  assert.deepEqual(body.handles, ["one", "two"])
  assert.deepEqual(body.paths, ["/shop/"])
})

test("large imports stay within endpoint limits and deliver every batch serially", async () => {
  const h = harness()
  const input = {
    tags: ["products", "catalog"],
    handles: Array.from({ length: 135 }, (_, i) => `design-${i}`),
    paths: Array.from({ length: 70 }, (_, i) => `/product/design-${i}/`),
  }
  assert.equal(await h.revalidateStorefront(input), true)
  const bodies = h.requests.map((request) => JSON.parse(request.options.body))
  assert.deepEqual(bodies.flatMap((body) => body.handles ?? []), input.handles)
  assert.deepEqual(bodies.flatMap((body) => body.paths ?? []), input.paths)
  for (const body of bodies) {
    assert.ok((body.tags?.length ?? 0) <= 64)
    assert.ok((body.handles?.length ?? 0) <= 64)
    assert.ok((body.paths?.length ?? 0) <= 32)
  }
  assert.equal(h.maximumActive(), 1)
  assert.deepEqual(plain(h.revalidationBatches({ ...input, all: true })), [{ all: true }])
})

test("write domains match base and nested endpoints without treating raw uploads as publication", () => {
  const { storefrontWriteTags } = load("storefront-write-domains.ts")
  const tags = (route) => plain(storefrontWriteTags(route))
  for (const route of ["/admin/products", "/admin/products/", "/admin/products/p1/variants/v1?test=1", "/admin/designs/from-r2", "/admin/rebuild-cards"]) {
    assert.deepEqual(tags(route), ["products", "catalog"], route)
  }
  for (const route of ["/admin/designs/upload", "/admin/designs/upload/?chunk=1", "/admin/r2/upload", "/admin/products-other"]) assert.deepEqual(tags(route), [])
  assert.deepEqual(tags("/admin/content/seo/overrides"), ["seo"])
  assert.deepEqual(tags("/admin/content"), ["content"])
  assert.deepEqual(tags("/admin/bundles/settings"), ["bundles"])
  assert.deepEqual(tags("/admin/stock"), ["stock"])
  assert.deepEqual(tags("/admin/case-types/case1"), ["catalog", "products"])
  assert.deepEqual(tags("/admin/inventory-items/item1/location-levels"), ["stock", "products"])
})
