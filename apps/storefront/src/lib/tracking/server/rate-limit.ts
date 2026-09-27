import { isIPv4, isIPv6 } from "node:net"

import { assertServer } from "./guard"

assertServer()

/**
 * In-memory token buckets for /api/t/e/ (TRACKING.md 4.2, I14): 120 events a
 * minute per visitor id with a burst of 60, and a higher 1,200 a minute per
 * trusted IP source, which many phones share behind carrier NAT. The visitor
 * id is the browser's own cookie, so the IP source is the ceiling that holds:
 * an IPv6 source is its whole /64 (ipSource), because one phone or home can
 * pick any address inside it. One Map holds both, least recently used keys
 * evicted past 50,000, so memory stays bounded whatever the traffic. Losing
 * it on a restart only resets the limits.
 */
export type Limit = { perMinute: number; burst: number }

export const VISITOR_LIMIT: Limit = { perMinute: 120, burst: 60 }
export const IP_LIMIT: Limit = { perMinute: 1200, burst: 1200 }
export const MAX_KEYS = 50_000

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

/**
 * The key one client cannot multiply: an IPv4 address as is, an IPv6 address
 * as its /64 ("2001:db8:1:2::/64", however it was written), and an
 * IPv4-mapped IPv6 address as its IPv4 address. Anything else is unchanged.
 * Only for limits: the ingest ctx keeps the full address.
 */
export function ipSource(ip: string): string {
  const mapped = MAPPED_IPV4.exec(ip)
  if (mapped && isIPv4(mapped[1])) return mapped[1]
  if (!isIPv6(ip)) return ip
  // An embedded IPv4 tail ("64:ff9b::192.0.2.1") fills the last two groups.
  const groups = (part: string) => (part ? part.split(":").flatMap((group) => (group.includes(".") ? ["0", "0"] : [group])) : [])
  const [head, tail] = ip.split("::")
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const full = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
  return `${full.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`
}

type Bucket = { tokens: number; at: number }

export type RateLimiter = {
  /** How many of `n` events may pass now for this visitor (and IP source); those tokens are spent. */
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
      const ipKey = ip ? `i:${ipSource(ip)}` : null
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
