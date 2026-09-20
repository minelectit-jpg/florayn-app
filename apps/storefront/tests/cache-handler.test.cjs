const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const codec = require("../cache-codec")

// This is the reader used by the preceding deployment. Shared FETCH entries
// must remain readable during a rollout and after rolling back the application.
function oldReader(raw) {
  return JSON.parse(raw, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data)
      if (Array.isArray(value.__map__)) return new Map(value.__map__)
    }
    return value
  })
}

function fakeRedis() {
  const entries = new Map()
  const indexes = new Map()
  const ttls = new Map()
  return {
    entries, indexes, ttls,
    isReady: true,
    reads: 0,
    transactions: 0,
    evaluations: 0,
    on() {},
    async connect() {},
    async get(key) { this.reads++; return entries.get(key) ?? null },
    multi() {
      const operations = []
      const transaction = {
        set(key, value, options) {
          operations.push(() => { entries.set(key, value); ttls.set(key, options.EX) })
          return transaction
        },
        sAdd(key, value) {
          operations.push(() => {
            if (!indexes.has(key)) indexes.set(key, new Set())
            indexes.get(key).add(value)
          })
          return transaction
        },
        expire(key, ttl) { operations.push(() => ttls.set(key, ttl)); return transaction },
        exec: async () => { this.transactions++; operations.forEach(operation => operation()) },
      }
      return transaction
    },
    // Model Redis's atomic script execution as one synchronous section. Hooks
    // let tests schedule MULTI writes immediately before or after that section.
    async eval(_script, { keys: [index] }) {
      this.evaluations++
      if (this.beforeEval) await this.beforeEval()
      const keys = [...(indexes.get(index) ?? [])]
      for (const key of keys) {
        entries.delete(key)
        ttls.delete(key)
      }
      indexes.delete(index)
      ttls.delete(index)
      if (this.afterEval) await this.afterEval()
      return keys.length
    },
  }
}

function handler(redis, { configured = true, buildId = "build-a" } = {}) {
  const filename = path.resolve(__dirname, "../cache-handler.js")
  const sandbox = {
    module: { exports: {} }, Buffer, Map, Set, Date, setTimeout, clearTimeout,
    process: { env: configured ? { STOREFRONT_REDIS_URL: "redis://unused.invalid/1" } : {}, cwd: () => "/app" },
    require(name) {
      if (name === "redis") return { createClient: () => redis }
      if (name === "node:fs") return { readFileSync: () => buildId }
      if (name === "./cache-codec") return codec
      return require(name)
    },
  }
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename })
  return new sandbox.module.exports({ serverDistDir: "/app/.next/server" })
}

test("legacy codec restores Buffer/Map without changing the old wire format", () => {
  const value = {
    value: { kind: "FETCH", data: { headers: {}, body: "products", status: 200 } },
    nested: [{ buffer: Buffer.from([0, 127, 255]) }],
    map: new Map([["segment", Buffer.from("segment")], ["nested", new Map([["key", Buffer.from("value")]])]]),
    lastModified: 123,
    tags: ["products"],
  }
  const raw = codec.serializeLegacy(value)
  assert.deepEqual(codec.deserializeLegacy(raw), value)
  assert.deepEqual(oldReader(raw), value)
})

test("route codec preserves all Next route payload kinds and reduces binary expansion", async () => {
  const binary = Buffer.alloc(763000, "public-rsc-product-data\n")
  const page = { value: {
    kind: "APP_PAGE", html: "<main>Product</main>".repeat(40000), rscData: binary,
    segmentData: new Map([["/_tree", Buffer.from([0, 255, 1])]]),
    headers: { "content-type": "text/html" }, status: 200,
  }, lastModified: 123, tags: ["products"] }
  for (const value of [page,
    { value: { kind: "APP_ROUTE", body: Buffer.from([0, 1, 128, 255]), status: 200, headers: {} } },
    { value: { kind: "PAGES", html: "<main>Hello</main>", pageData: { title: "Hello" } } },
  ]) {
    const raw = await codec.serializeRoute(value)
    assert.ok(raw.startsWith("v2:"))
    assert.deepEqual(await codec.deserializeRoute(raw), value)
  }
  const raw = await codec.serializeRoute(page)
  assert.ok(Buffer.byteLength(raw) < Buffer.byteLength(codec.serializeLegacy(page)) / 4)
})

test("handler reuses old FETCH data and publishes old-reader-compatible FETCH writes", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  const existing = { value: { kind: "FETCH", data: { body: "warm products" } }, lastModified: 50, tags: ["products"] }
  redis.entries.set("florayn:sf:fetch:products", codec.serializeLegacy(existing))
  assert.deepEqual(await cache.get("products", { kind: "FETCH" }), existing)
  await cache.set("products", existing.value, { fetchCache: true, tags: ["products"] })
  assert.deepEqual(oldReader(redis.entries.get("florayn:sf:fetch:products")).value, existing.value)
  assert.equal(redis.ttls.get("florayn:sf:fetch:products"), 604800)
})

test("route writes use a versioned build namespace and atomic tag membership", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  const route = { kind: "APP_PAGE", html: "hello", rscData: Buffer.from("rsc"), headers: { "x-next-cache-tags": "products,layout" } }
  await cache.set("/product/example", route, { tags: ["products"] })
  const key = "florayn:sf:route:v2:build-a:/product/example"
  assert.equal(redis.entries.size, 1)
  assert.equal(redis.transactions, 1)
  assert.equal(redis.ttls.get(key), 259200)
  assert.ok(redis.indexes.get("florayn:sf:tag:products").has(key))
  assert.ok(redis.indexes.get("florayn:sf:tag:layout").has(key))
  assert.deepEqual((await cache.get("/product/example", { kind: "APP_PAGE" })).value, route)
  assert.equal(await handler(redis, { buildId: "build-b" }).get("/product/example", { kind: "APP_PAGE" }), null)
})

test("legacy route fallback stays in its build and tag invalidation removes both formats", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  const oldKey = "florayn:sf:route:build-a:/product/example"
  const old = { value: { kind: "APP_PAGE", html: "old", rscData: Buffer.from("old-rsc") }, lastModified: 100, tags: ["products"] }
  redis.entries.set(oldKey, codec.serializeLegacy(old))
  redis.indexes.set("florayn:sf:tag:products", new Set([oldKey]))
  assert.deepEqual(await cache.get("/product/example", { kind: "APP_PAGE" }), old)
  await cache.set("/product/example", { ...old.value, html: "new" }, { tags: ["products"] })
  await cache.set("products", { kind: "FETCH", data: { body: "products" } }, { fetchCache: true, tags: ["products"] })
  assert.equal(redis.indexes.get("florayn:sf:tag:products").size, 3)
  await cache.revalidateTag(["products"])
  assert.equal(await cache.get("/product/example", { kind: "APP_PAGE" }), null)
  assert.equal(await cache.get("products", { kind: "FETCH" }), null)
  assert.equal(redis.entries.size, 0)
})

test("unconfigured or disconnected Redis returns a miss without attempting reads", async () => {
  const redis = fakeRedis()
  assert.equal(await handler(redis, { configured: false }).get("product", { kind: "APP_PAGE" }), null)
  redis.isReady = false
  const cache = handler(redis)
  assert.equal(await cache.get("product", { kind: "APP_PAGE" }), null)
  await cache.set("product", { kind: "APP_PAGE" }, {})
  assert.equal(redis.reads, 0)
  assert.equal(redis.transactions, 0)
})

test("tag invalidation removes a concurrent earlier write and preserves a later write's index", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  const write = (name) => cache.set(name, { kind: "FETCH", data: { body: name } }, { fetchCache: true, tags: ["products"] })
  await write("existing")
  redis.beforeEval = () => write("before")
  redis.afterEval = () => write("after")
  await cache.revalidateTag("products")
  assert.equal(redis.evaluations, 1)
  assert.equal(await cache.get("existing", { kind: "FETCH" }), null)
  assert.equal(await cache.get("before", { kind: "FETCH" }), null)
  assert.equal((await cache.get("after", { kind: "FETCH" })).value.data.body, "after")
  assert.deepEqual([...redis.indexes.get("florayn:sf:tag:products")], ["florayn:sf:fetch:after"])
  redis.beforeEval = null
  redis.afterEval = null
  await cache.revalidateTag("products")
  assert.equal(redis.evaluations, 2)
  assert.equal(await cache.get("after", { kind: "FETCH" }), null)
  assert.equal(redis.indexes.size, 0)
})

test("corrupt route and legacy payloads become misses", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  redis.entries.set("florayn:sf:route:v2:build-a:bad", "v2:invalid-compressed-data")
  assert.equal(await cache.get("bad", { kind: "APP_PAGE" }), null)
  redis.entries.set("florayn:sf:fetch:bad", "not JSON")
  assert.equal(await cache.get("bad", { kind: "FETCH" }), null)
  await assert.rejects(codec.deserializeRoute("v99:unknown"))
})

test("failing Redis opens the circuit breaker instead of retrying every request", async () => {
  const redis = fakeRedis()
  redis.get = async () => { redis.reads++; throw new Error("offline") }
  const cache = handler(redis)
  for (let i = 0; i < 6; i++) assert.equal(await cache.get("product", { kind: "APP_PAGE" }), null)
  assert.equal(redis.reads, 4)
})

test("a stalled Redis GET is bounded and becomes a cache miss", async () => {
  const redis = fakeRedis()
  redis.get = () => new Promise(() => {})
  const start = performance.now()
  assert.equal(await handler(redis).get("product", { kind: "APP_PAGE" }), null)
  assert.ok(performance.now() - start < 1000)
})

test("failed Redis writes and invalidations do not reject rendering", async () => {
  const redis = fakeRedis()
  redis.multi = () => { throw new Error("offline") }
  redis.eval = async () => { throw new Error("offline") }
  const cache = handler(redis)
  await cache.set("product", { kind: "APP_PAGE", rscData: Buffer.from("rsc") }, { tags: ["products"] })
  await cache.revalidateTag("products")
})

test("a stalled Redis write is bounded", async () => {
  const redis = fakeRedis()
  const transaction = { set: () => transaction, exec: () => new Promise(() => {}) }
  redis.multi = () => transaction
  const start = performance.now()
  await handler(redis).set("products", { kind: "FETCH", data: { body: "products" } }, { fetchCache: true })
  assert.ok(performance.now() - start < 1000)
})
