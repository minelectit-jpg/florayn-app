import { assertServer } from "./guard"

assertServer()

/**
 * In-memory token buckets for /api/t/e/ (TRACKING.md 4.2, I14): 120 events a
 * minute per visitor id with a burst of 60, and a higher 1,200 a minute per
 * trusted IP, which many phones share behind carrier NAT. One Map holds both,
 * least recently used keys evicted past 50,000, so memory stays bounded
 * whatever the traffic. Losing it on a restart only resets the limits.
 */
export type Limit = { perMinute: number; burst: number }

export const VISITOR_LIMIT: Limit = { perMinute: 120, burst: 60 }
export const IP_LIMIT: Limit = { perMinute: 1200, burst: 1200 }
export const MAX_KEYS = 50_000

type Bucket = { tokens: number; at: number }

export type RateLimiter = {
  /** How many of `n` events may pass now for this visitor (and IP); those tokens are spent. */
  take(visitorId: string, ip: string | null, n: number): number
  size(): number
}

export function createRateLimiter(options: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? MAX_KEYS
  const buckets = new Map<string, Bucket>()

  function available(key: string, limit: Limit, at: number): number {
    const bucket = buckets.get(key)
    if (!bucket) return limit.burst
    const refill = (Math.max(0, at - bucket.at) * limit.perMinute) / 60_000
    return Math.min(limit.burst, bucket.tokens + refill)
  }

  function spend(key: string, limit: Limit, at: number, n: number): void {
    const tokens = available(key, limit, at) - n
    buckets.delete(key)
    buckets.set(key, { tokens, at })
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  return {
    take(visitorId, ip, n) {
      const at = now()
      const visitorKey = `v:${visitorId}`
      const ipKey = ip ? `i:${ip}` : null
      let granted = Math.min(Math.max(0, Math.floor(n)), Math.floor(available(visitorKey, VISITOR_LIMIT, at)))
      if (ipKey) granted = Math.min(granted, Math.floor(available(ipKey, IP_LIMIT, at)))
      granted = Math.max(0, granted)
      spend(visitorKey, VISITOR_LIMIT, at, granted)
      if (ipKey) spend(ipKey, IP_LIMIT, at, granted)
      return granted
    },
    size: () => buckets.size,
  }
}

/** The process-wide limiter /api/t/e/ uses. */
export const rateLimiter = createRateLimiter()
