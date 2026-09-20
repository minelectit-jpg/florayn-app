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
  const hashes = new Map([["florayn:sf:freshness:v1", new Map([["generation", "test-generation"]])]])
  return {
    entries, indexes, ttls, hashes,
    now: Date.now(),
    isReady: true,
    reads: 0,
    transactions: 0,
    evaluations: 0,
    on() {},
    async connect() {},
    async get(key) { this.reads++; return entries.get(key) ?? null },
    async hmGet(key, fields) { return fields.map((field) => hashes.get(key)?.get(field) ?? null) },
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
        exec: async () => {
          if (this.beforeExec) await this.beforeExec()
          this.transactions++
          operations.forEach(operation => operation())
        },
      }
      return transaction
    },
    // Model Redis's atomic script execution as one synchronous section. Hooks
    // let tests schedule MULTI writes immediately before or after that section.
    async eval(_script, { keys: [index, freshness], arguments: args }) {
      if (!freshness) {
        if (!hashes.has(index)) hashes.set(index, new Map())
        const hash = hashes.get(index)
        if (!hash.has("generation")) hash.set("generation", args[0])
        return hash.get("generation")
      }
      this.evaluations++
      if (this.beforeEval) await this.beforeEval()
      if (!hashes.has(freshness)) hashes.set(freshness, new Map([["generation", args[1]]]))
      hashes.get(freshness).set(`tag:${args[0]}`, String(this.now++))
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

function handler(redis, { configured = true, buildId = "build-a", warnings = [] } = {}) {
  const filename = path.resolve(__dirname, "../cache-handler.js")
  const sandbox = {
    module: { exports: {} }, Buffer, Map, Set,
    Date: class extends Date { static now() { return redis.now++ } },
    console: { warn(message) { warnings.push(message) } }, setTimeout, clearTimeout,
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
  const existing = { value: { kind: "FETCH", data: { body: "warm products" } }, lastModified: 50, tags: ["products"], cacheGeneration: "test-generation" }
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
  const old = { value: { kind: "APP_PAGE", html: "old", rscData: Buffer.from("old-rsc") }, lastModified: 100, tags: ["products"], cacheGeneration: "test-generation" }
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
  const warnings = []
  const cache = handler(redis, { warnings })
  redis.entries.set("florayn:sf:route:v2:build-a:bad", "v2:invalid-compressed-data")
  assert.equal(await cache.get("bad", { kind: "APP_PAGE" }), null)
  redis.entries.set("florayn:sf:fetch:bad", "not JSON")
  assert.equal(await cache.get("bad", { kind: "FETCH" }), null)
  assert.deepEqual(warnings, ["[storefront-cache] get.decode failed (Z_DATA_ERROR)"])
  await assert.rejects(codec.deserializeRoute("v99:unknown"))
})

test("failing Redis opens the circuit breaker instead of retrying every request", async () => {
  const redis = fakeRedis()
  redis.get = async () => { redis.reads++; throw new Error("offline") }
  const cache = handler(redis)
  for (let i = 0; i < 6; i++) assert.equal(await cache.get("product", { kind: "APP_PAGE" }), null)
  assert.equal(redis.reads, 4)
})

test("80 ms Redis GET and freshness waits still return the cached value", async () => {
  const redis = fakeRedis()
  const warnings = []
  const cache = handler(redis, { warnings })
  const value = { kind: "FETCH", data: { body: "warm content" } }
  await cache.set("content", value, { fetchCache: true, tags: ["content"] })
  const get = redis.get.bind(redis)
  const hmGet = redis.hmGet.bind(redis)
  redis.get = async (key) => {
    await new Promise((resolve) => setTimeout(resolve, 80))
    return get(key)
  }
  redis.hmGet = async (key, fields) => {
    await new Promise((resolve) => setTimeout(resolve, 80))
    return hmGet(key, fields)
  }
  assert.deepEqual((await cache.get("content", { kind: "FETCH" })).value, value)
  assert.deepEqual(warnings, [])
})

test("a Redis GET exceeding 120 ms becomes a bounded miss with a typed warning", async () => {
  const redis = fakeRedis()
  const warnings = []
  let timer
  redis.get = () => new Promise((resolve) => { timer = setTimeout(() => resolve("late payload"), 300) })
  const start = performance.now()
  try {
    assert.equal(await handler(redis, { warnings }).get("product", { kind: "APP_PAGE" }), null)
    assert.ok(performance.now() - start < 1000)
    assert.deepEqual(warnings, ["[storefront-cache] get.read failed (REDIS_TIMEOUT)"])
  } finally {
    clearTimeout(timer)
  }
})

test("a stalled freshness check is a miss and reports its own timeout phase", async () => {
  const redis = fakeRedis()
  const warnings = []
  const cache = handler(redis, { warnings })
  await cache.set("content", { kind: "FETCH", data: { body: "cached content" } }, { fetchCache: true })
  redis.hmGet = () => new Promise(() => {})
  assert.equal(await cache.get("content", { kind: "FETCH" }), null)
  assert.deepEqual(warnings, ["[storefront-cache] get.freshness failed (REDIS_TIMEOUT)"])
})

test("read diagnostics omit arbitrary Redis errors, keys, and values", async () => {
  const redis = fakeRedis()
  const warnings = []
  const secret = "redis://private-user:private-password@private-host/1"
  redis.get = async () => {
    const error = new Error(secret)
    error.code = secret
    throw error
  }
  assert.equal(await handler(redis, { warnings }).get(secret, { kind: "APP_PAGE" }), null)
  assert.deepEqual(warnings, ["[storefront-cache] get.read failed (CACHE_OPERATION_FAILED)"])
})

test("instance invalidation does not fail committed actions, but static acknowledgement stays strict", async () => {
  const redis = fakeRedis()
  redis.multi = () => { throw new Error("offline") }
  redis.eval = async () => { throw new Error("offline") }
  const cache = handler(redis)
  await cache.set("product", { kind: "APP_PAGE", rscData: Buffer.from("rsc") }, { tags: ["products"] })
  await cache.revalidateTag("products")
  await assert.rejects(cache.constructor.invalidateTags(["products"]), /invalidation failed/)
  assert.equal(await cache.get("product", { kind: "APP_PAGE" }), null)
})

test("unconfigured Redis does not fail action revalidation", async () => {
  const cache = handler(fakeRedis(), { configured: false })
  await cache.revalidateTag("_N_T_/cart")
  await assert.rejects(cache.constructor.invalidateTags(["products"]), /unavailable/)
})

test("explicit invalidation retains its aggregate three-second deadline", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  const evaluate = redis.eval.bind(redis)
  redis.eval = async (...args) => {
    const result = await evaluate(...args)
    // Model individually successful commands that consume the aggregate budget.
    redis.now += 750
    return result
  }
  await assert.rejects(cache.constructor.invalidateTags(Array.from({ length: 10 }, (_, i) => `content:${i}`)), /invalidation failed/)
  assert.equal(redis.evaluations, 4)
})

test("failed instance tags block stale reads until recovery acknowledges them", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  await cache.set("old", { kind: "FETCH", data: { body: "old" } }, { fetchCache: true, tags: ["products"] })
  const originalEval = redis.eval
  redis.eval = async () => { throw new Error("temporary outage") }
  await cache.revalidateTag("products")
  assert.equal(await cache.get("old", { kind: "FETCH" }), null)
  redis.eval = originalEval
  // Explicit acknowledgement also clears the pending process-local marker.
  await cache.constructor.invalidateTags(["products"])
  await cache.set("new", { kind: "FETCH", data: { body: "new" } }, { fetchCache: true, tags: ["products"] })
  assert.ok(await cache.get("new", { kind: "FETCH" }))
  assert.equal(await cache.get("old", { kind: "FETCH" }), null)
})

test("implicit path softTags invalidate untagged native fetch data", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  await cache.set("native-content", { kind: "FETCH", data: { body: "old content" } }, { fetchCache: true })
  assert.ok(await cache.get("native-content", { kind: "FETCH", softTags: ["_N_T_/layout"] }))
  await cache.revalidateTag("_N_T_/layout")
  assert.ok(redis.entries.has("florayn:sf:fetch:native-content"))
  assert.equal(await cache.get("native-content", { kind: "FETCH", softTags: ["_N_T_/layout"] }), null)
})

test("timestamp checks still invalidate values after their tag index was evicted", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  await cache.set("stock", { kind: "FETCH", data: { body: "old stock" } }, { fetchCache: true, tags: ["stock"] })
  redis.indexes.delete("florayn:sf:tag:stock")
  await cache.revalidateTag("stock")
  assert.ok(redis.entries.has("florayn:sf:fetch:stock"))
  assert.equal(await cache.get("stock", { kind: "FETCH" }), null)
})

test("evicting the timestamp hash makes surviving values miss across generations", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  await cache.set("first", { kind: "FETCH", data: { body: "before eviction" } }, { fetchCache: true })
  redis.hashes.delete("florayn:sf:freshness:v1")
  assert.equal(await cache.get("first", { kind: "FETCH" }), null)
  await cache.set("second", { kind: "FETCH", data: { body: "after eviction" } }, { fetchCache: true })
  assert.ok(await cache.get("second", { kind: "FETCH" }))
  assert.equal(await cache.get("first", { kind: "FETCH" }), null)
})

test("legacy values without a freshness generation are migrated conservatively", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  redis.entries.set("florayn:sf:fetch:legacy", codec.serializeLegacy({ value: { kind: "FETCH" }, lastModified: 50 }))
  assert.equal(await cache.get("legacy", { kind: "FETCH" }), null)
})

test("an invalidation during a write rejects the older result even if SET finishes last", async () => {
  const redis = fakeRedis()
  const cache = handler(redis)
  redis.beforeExec = async () => {
    redis.beforeExec = null
    await cache.revalidateTag("products")
  }
  await cache.set("product", { kind: "FETCH", data: { body: "old result" } }, { fetchCache: true, tags: ["products"] })
  assert.ok(redis.entries.has("florayn:sf:fetch:product"))
  assert.equal(await cache.get("product", { kind: "FETCH" }), null)
})

test("a stalled Redis write is bounded", async () => {
  const redis = fakeRedis()
  const warnings = []
  const transaction = { set: () => transaction, exec: () => new Promise(() => {}) }
  redis.multi = () => transaction
  const start = performance.now()
  await handler(redis, { warnings }).set("products", { kind: "FETCH", data: { body: "products" } }, { fetchCache: true })
  const elapsed = performance.now() - start
  assert.ok(elapsed >= 180 && elapsed < 1000)
  assert.deepEqual(warnings, ["[storefront-cache] set failed (REDIS_TIMEOUT)"])
})
