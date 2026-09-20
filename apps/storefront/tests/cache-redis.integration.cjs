// Run explicitly against a disposable, empty Redis database:
// TEST_REDIS_URL=redis://redis-test:6379/0 node --test tests/cache-redis.integration.cjs
// There is deliberately no production environment fallback and no FLUSH command.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const { test } = require("node:test")

const testUrl = process.env.TEST_REDIS_URL
test("cache freshness and invalidation against real isolated Redis", { skip: !testUrl }, async (suite) => {
  const { createClient } = require("redis")
  const redis = createClient({ url: testUrl, socket: { connectTimeout: 2000, reconnectStrategy: false } })
  redis.on("error", () => {})
  await redis.connect()
  let Handler
  let safeToClean = false
  const writtenKeys = new Set()
  try {
    assert.equal(await redis.dbSize(), 0, "Integration tests require an empty disposable Redis database")
    safeToClean = true
    process.env.STOREFRONT_REDIS_URL = testUrl
    Handler = require("../cache-handler")
    const cache = new Handler({})
    const prefix = `cache-test:${crypto.randomUUID()}`
    const freshnessKey = "florayn:sf:freshness:v1"
    writtenKeys.add(freshnessKey)
    const name = (suffix) => `${prefix}:${suffix}`
    const tag = (suffix) => {
      const value = name(suffix)
      writtenKeys.add(`florayn:sf:tag:${value}`)
      return value
    }
    const key = (suffix) => {
      const value = cache.key(name(suffix), true)
      writtenKeys.add(value)
      return value
    }
    const write = async (suffix, tags = []) => {
      key(suffix)
      await cache.set(name(suffix), { kind: "FETCH", data: { body: suffix } }, { fetchCache: true, tags })
    }
    // This waits for the handler connection and exercises the real Lua script.
    await Handler.invalidateTags([tag("initialization")])

    await suite.test("fetch values survive a roundtrip and explicit invalidation", async () => {
      const target = tag("explicit")
      await write("explicit", [target])
      assert.equal((await cache.get(name("explicit"), { kind: "FETCH" })).value.data.body, "explicit")
      await cache.revalidateTag(target)
      assert.equal(await cache.get(name("explicit"), { kind: "FETCH" }), null)
    })

    await suite.test("soft path tags invalidate native fetches without an explicit index", async () => {
      const target = `_N_T_/${prefix}/layout`
      writtenKeys.add(`florayn:sf:tag:${target}`)
      await write("implicit")
      await cache.revalidateTag(target)
      assert.equal(await redis.exists(key("implicit")), 1)
      assert.equal(await cache.get(name("implicit"), { kind: "FETCH", softTags: [target] }), null)
    })

    await suite.test("missing tag indexes cannot hide invalidation", async () => {
      const target = tag("evicted-index")
      await write("evicted-index", [target])
      await redis.del(`florayn:sf:tag:${target}`)
      await cache.revalidateTag(target)
      assert.equal(await redis.exists(key("evicted-index")), 1)
      assert.equal(await cache.get(name("evicted-index"), { kind: "FETCH" }), null)
    })

    await suite.test("a late old write is rejected by the real invalidation timestamp", async () => {
      const target = tag("late-write")
      await write("late-write", [target])
      const oldValue = await redis.get(key("late-write"))
      await cache.revalidateTag(target)
      await redis.set(key("late-write"), oldValue, { EX: 60 })
      assert.equal(await cache.get(name("late-write"), { kind: "FETCH" }), null)
    })

    await suite.test("batched Lua deletion supports more than one unpack batch", async () => {
      const target = tag("batch")
      const keys = Array.from({ length: 1025 }, (_, index) => key(`batch-${index}`))
      const transaction = redis.multi()
      for (const item of keys) transaction.set(item, "tiny test value", { EX: 60 })
      transaction.sAdd(`florayn:sf:tag:${target}`, keys)
      await transaction.exec()
      await cache.revalidateTag(target)
      assert.equal(await redis.exists(keys), 0)
      assert.equal(await redis.exists(`florayn:sf:tag:${target}`), 0)
    })

    await suite.test("evicting the timestamp registry invalidates the old generation", async () => {
      await write("old-generation")
      await redis.del(freshnessKey)
      assert.equal(await cache.get(name("old-generation"), { kind: "FETCH" }), null)
      await write("new-generation")
      assert.ok(await cache.get(name("new-generation"), { kind: "FETCH" }))
      assert.equal(await cache.get(name("old-generation"), { kind: "FETCH" }), null)
    })
  } finally {
    let cleanupTimer
    try {
      if (safeToClean && redis.isReady && writtenKeys.size) {
        await Promise.race([
          redis.unlink([...writtenKeys]),
          new Promise((_, reject) => {
            cleanupTimer = setTimeout(() => reject(new Error("Test cleanup timed out")), 2000)
          }),
        ])
      }
    } finally {
      clearTimeout(cleanupTimer)
      await Promise.allSettled([
        Handler ? Handler.close() : Promise.resolve(),
        redis.isOpen ? redis.disconnect() : Promise.resolve(),
      ])
    }
  }
})
