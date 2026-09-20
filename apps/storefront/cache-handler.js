// apps/storefront/cache-handler.js
//
// Custom Next.js incremental-cache handler backed by Redis so ISR output AND the
// fetch/data cache survive a container replacement (every Coolify deploy starts a
// fresh container and wipes .next/cache). Wired in next.config.ts via the stable
// top-level `cacheHandler` field (Next 15.5).
//
// WHY (measured): product data is fetched through @medusajs/js-sdk, which never
// forwards next/cache into fetch, so those calls are no-store and re-hit Medusa on
// every render. On the 2-vCPU box that is 0.3-0.7s/query and jams the DB pool under
// a prefetch storm -> cold pages took 2-7s and every deploy wiped the cache. This
// handler keeps the DATA warm in Redis across deploys so renders are cheap.
//
// DESIGN:
//   - FETCH entries (native fetch{next:{revalidate}} + unstable_cache-wrapped
//     Medusa calls) are pure DATA, build-independent -> keys are SHARED across
//     deploys. This is what keeps the site fast right after a deploy.
//   - APP_PAGE / APP_ROUTE / PAGES entries are rendered HTML/RSC that reference
//     THIS build's hashed JS chunks -> keys are NAMESPACED by build id. A new build
//     never serves an old build's HTML => no ChunkLoadError, ever; it regenerates
//     its own HTML (cheap, because the data is warm).
//   - The build id comes from .next/BUILD_ID, which Next writes as a fresh random
//     value on EVERY build (we deliberately do NOT pin generateBuildId, so even a
//     same-commit rebuild gets a new namespace -> no stale chunks on redeploy).
//
// SAFETY (this is load-bearing — it runs on the hot path of every cached render):
//   - Each Redis wait has a timeout (Promise.race). A route miss can make two
//     reads, and encoding/decoding is outside these per-command timeouts. A
//     timeout returns a cache miss or stops waiting for a write; it does not
//     cancel a command that Redis has already received.
//   - A circuit breaker skips Redis entirely for a cool-off window after repeated
//     failures, so a sustained outage adds ~0ms to requests.
//   - disableOfflineQueue + connectTimeout so commands fail fast instead of
//     queueing during a flap. If STOREFRONT_REDIS_URL is unset, the handler is
//     inert. Cache misses render from origin; Next does not fall back to its
//     filesystem cache after a custom handler has been selected.

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { createClient } = require("redis")
const { serializeLegacy, deserializeLegacy, serializeRoute, deserializeRoute } = require("./cache-codec")

const PREFIX = "florayn:sf"
const ROUTE_TTL = 60 * 60 * 72 // 72h — old-build route namespaces self-evict
const FETCH_TTL = 60 * 60 * 24 * 7 // 7d backstop; Next's own revalidate governs freshness
const GET_TIMEOUT_MS = 60
const SET_TIMEOUT_MS = 200
const BREAKER_THRESHOLD = 4 // consecutive failures before tripping
const BREAKER_COOLDOWN_MS = 30_000

// Run the membership read and deletion atomically relative to MULTI writes.
// Otherwise a new entry can arrive after SMEMBERS and lose its tag index when
// invalidation deletes the index. UNLINK frees large payloads asynchronously;
// bounded batches avoid Lua unpack limits for tags shared by many pages.
const REVALIDATE_TAG_SCRIPT = `
local keys = redis.call("SMEMBERS", KEYS[1])
for first = 1, #keys, 256 do
  redis.call("UNLINK", unpack(keys, first, math.min(first + 255, #keys)))
end
redis.call("DEL", KEYS[1])
return #keys
`

// .next/BUILD_ID is a fresh random id per build (we do NOT set generateBuildId).
// Fail CLOSED: if it can't be read, use a per-process random id so we never share
// a route namespace across deploys (a constant fallback would be a stale-chunk bomb).
function resolveBuildId(serverDistDir) {
  const candidates = []
  if (serverDistDir) candidates.push(path.join(serverDistDir, "..", "BUILD_ID"))
  candidates.push(path.join(process.cwd(), ".next", "BUILD_ID"))
  for (const f of candidates) {
    try {
      const id = fs.readFileSync(f, "utf8").trim()
      if (id) return id
    } catch {}
  }
  return `nobuildid-${crypto.randomUUID()}`
}

let client
let connecting = false
let failures = 0
let unhealthyUntil = 0

function tripBreaker() {
  failures += 1
  if (failures >= BREAKER_THRESHOLD) {
    unhealthyUntil = Date.now() + BREAKER_COOLDOWN_MS
    failures = 0
  }
}
function resetBreaker() {
  failures = 0
  unhealthyUntil = 0
}

function db() {
  const url = process.env.STOREFRONT_REDIS_URL
  if (!url) return null
  if (client) return client
  if (connecting) return null
  connecting = true
  try {
    client = createClient({
      url,
      disableOfflineQueue: true, // fail fast instead of queueing during a flap
      socket: {
        connectTimeout: 500,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    })
    client.on("error", () => {}) // swallow — never let an 'error' event throw
    client.connect().catch(() => {})
  } catch {
    client = null
  } finally {
    connecting = false
  }
  return client
}

async function withTimeout(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("redis-timeout")), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function ready() {
  if (Date.now() < unhealthyUntil) return null // circuit open — skip Redis
  const c = db()
  if (!c || !c.isReady) return null
  return c
}

module.exports = class RedisCacheHandler {
  constructor(ctx) {
    this.buildId = resolveBuildId(ctx && ctx.serverDistDir)
  }

  key(k, isFetch) {
    return isFetch
      ? `${PREFIX}:fetch:${k}`
      : `${PREFIX}:route:v2:${this.buildId}:${k}`
  }

  legacyRouteKey(k) {
    return `${PREFIX}:route:${this.buildId}:${k}`
  }

  async get(cacheKey, ctx) {
    const c = await ready()
    if (!c) return null
    try {
      const isFetch = ctx && ctx.kind === "FETCH"
      let raw = await withTimeout(c.get(this.key(cacheKey, isFetch)), GET_TIMEOUT_MS)
      let value
      if (isFetch) {
        value = raw ? deserializeLegacy(raw) : null
      } else if (raw) {
        value = await deserializeRoute(raw)
      } else {
        // A same-build migration can reuse its old route entry. Never read a
        // different build's HTML, because it references different JS chunks.
        raw = await withTimeout(c.get(this.legacyRouteKey(cacheKey)), GET_TIMEOUT_MS)
        value = raw ? deserializeLegacy(raw) : null
      }
      resetBreaker()
      return value // CacheHandlerValue { value, lastModified, tags }
    } catch {
      tripBreaker()
      return null // miss -> Next renders from origin (== today)
    }
  }

  async set(cacheKey, data, ctx) {
    const c = await ready()
    if (!c || data == null) return
    try {
      const isFetch = ctx && ctx.fetchCache === true
      let tags = (ctx && ctx.tags) || []
      const header = data.headers && data.headers["x-next-cache-tags"]
      if (typeof header === "string" && header) tags = tags.concat(header.split(","))
      tags = [...new Set(tags)]

      const rk = this.key(cacheKey, isFetch)
      const entry = { value: data, lastModified: Date.now(), tags }
      const payload = isFetch ? serializeLegacy(entry) : await serializeRoute(entry)
      // Publish the value and its tag memberships together. Revalidation must
      // not miss an entry whose tag index is still being written in the background.
      const transaction = c.multi().set(rk, payload, { EX: isFetch ? FETCH_TTL : ROUTE_TTL })
      for (const t of tags) {
        const idx = `${PREFIX}:tag:${t}`
        transaction.sAdd(idx, rk).expire(idx, FETCH_TTL)
      }
      await withTimeout(transaction.exec(), SET_TIMEOUT_MS)
      resetBreaker()
    } catch {
      tripBreaker()
    }
  }

  async revalidateTag(tagOrTags) {
    const c = await ready()
    if (!c) return
    try {
      for (const t of [].concat(tagOrTags)) {
        const idx = `${PREFIX}:tag:${t}`
        await withTimeout(c.eval(REVALIDATE_TAG_SCRIPT, { keys: [idx] }), SET_TIMEOUT_MS)
      }
      resetBreaker()
    } catch {
      tripBreaker()
    }
  }

  resetRequestCache() {}
}
