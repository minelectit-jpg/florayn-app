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
//   - Every Redis op has a HARD timeout (Promise.race). A reachable-but-slow/hung
//     Redis can never block a render longer than the timeout; on timeout we treat
//     it as a miss (get) or no-op (set), i.e. render from origin like today.
//   - A circuit breaker skips Redis entirely for a cool-off window after repeated
//     failures, so a sustained outage adds ~0ms to requests.
//   - disableOfflineQueue + connectTimeout so commands fail fast instead of
//     queueing during a flap. If STOREFRONT_REDIS_URL is unset, the handler is
//     inert and the app behaves exactly as it does with the default fs cache.

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { createClient } = require("redis")

const PREFIX = "florayn:sf"
const ROUTE_TTL = 60 * 60 * 72 // 72h — old-build route namespaces self-evict
const FETCH_TTL = 60 * 60 * 24 * 7 // 7d backstop; Next's own revalidate governs freshness
const GET_TIMEOUT_MS = 60
const SET_TIMEOUT_MS = 200
const BREAKER_THRESHOLD = 4 // consecutive failures before tripping
const BREAKER_COOLDOWN_MS = 30_000

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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("redis-timeout")), ms)),
  ])
}

async function ready() {
  if (Date.now() < unhealthyUntil) return null // circuit open — skip Redis
  const c = db()
  if (!c || !c.isReady) return null
  return c
}

// Buffers (APP_PAGE.rscData, APP_ROUTE body) and Maps (APP_PAGE.segmentData) do
// not survive a naive JSON round-trip.
function serialize(o) {
  return JSON.stringify(o, (_k, v) =>
    v instanceof Map ? { __map__: Array.from(v.entries()) } : v
  )
}
function deserialize(s) {
  return JSON.parse(s, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.type === "Buffer" && Array.isArray(v.data)) return Buffer.from(v.data)
      if (Array.isArray(v.__map__)) return new Map(v.__map__)
    }
    return v
  })
}

module.exports = class RedisCacheHandler {
  constructor(ctx) {
    this.buildId = resolveBuildId(ctx && ctx.serverDistDir)
  }

  key(k, isFetch) {
    return isFetch
      ? `${PREFIX}:fetch:${k}`
      : `${PREFIX}:route:${this.buildId}:${k}`
  }

  async get(cacheKey, ctx) {
    const c = await ready()
    if (!c) return null
    try {
      const isFetch = ctx && ctx.kind === "FETCH"
      const raw = await withTimeout(c.get(this.key(cacheKey, isFetch)), GET_TIMEOUT_MS)
      resetBreaker()
      return raw ? deserialize(raw) : null // CacheHandlerValue { value, lastModified, tags }
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

      const rk = this.key(cacheKey, isFetch)
      const payload = serialize({ value: data, lastModified: Date.now(), tags })
      await withTimeout(c.set(rk, payload, { EX: isFetch ? FETCH_TTL : ROUTE_TTL }), SET_TIMEOUT_MS)
      resetBreaker()

      // Tag index — fire-and-forget so it never extends the response.
      if (tags.length) {
        for (const t of tags) {
          const idx = `${PREFIX}:tag:${t}`
          void withTimeout(
            (async () => {
              await c.sAdd(idx, rk)
              await c.expire(idx, FETCH_TTL)
            })(),
            SET_TIMEOUT_MS
          ).catch(() => {})
        }
      }
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
        const keys = await withTimeout(c.sMembers(idx), SET_TIMEOUT_MS)
        if (keys && keys.length) await withTimeout(c.del(keys), SET_TIMEOUT_MS)
        await withTimeout(c.del(idx), SET_TIMEOUT_MS)
      }
      resetBreaker()
    } catch {
      tripBreaker()
    }
  }

  resetRequestCache() {}
}
