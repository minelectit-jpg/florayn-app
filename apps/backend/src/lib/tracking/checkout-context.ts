import { parseCheckoutContext, type CheckoutTrackingContext } from "./contract"
import { bumpCounters, trackingDb } from "./db"
import { verifyIngestKey } from "./secret"

/**
 * Reads the shopper's tracking context from the /store/checkout request
 * headers (TRACKING.md 4.4). The storefront's Server Action builds it from
 * its own request's headers and cookies and signs the request with the
 * derived ingest key (`x-florayn-ingest-key`); the context itself is
 * `x-florayn-tracking`, base64url JSON of at most 4 KB.
 *
 * Only these two headers are read: never the request body and never cart
 * metadata, which the public Store API can write (C4). Nothing here throws,
 * so a malformed or hostile header can never fail an order; it only means
 * that order is placed without tracking.
 */

export const MAX_TRACKING_HEADER = 4096
const INGEST_KEY_HEADER = "x-florayn-ingest-key"
const TRACKING_HEADER = "x-florayn-tracking"
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

export type DecodedTrackingHeader = {
  ctx: CheckoutTrackingContext | null
  /** The tracking header was sent but its key did not verify (a secret mismatch between the two apps). */
  rejected: boolean
}

type HeaderSource = Record<string, unknown> | { get(name: string): unknown } | null | undefined

function readHeader(headers: HeaderSource, name: string): unknown {
  if (!headers || typeof headers !== "object") return undefined
  const getter = (headers as { get?: unknown }).get
  if (typeof getter === "function") {
    const value = getter.call(headers, name)
    return value === null ? undefined : value
  }
  return (headers as Record<string, unknown>)[name]
}

function decodeContext(value: unknown): CheckoutTrackingContext | null {
  if (typeof value !== "string" || !value || value.length > MAX_TRACKING_HEADER || !BASE64URL.test(value)) return null
  try {
    return parseCheckoutContext(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
  } catch {
    return null
  }
}

/**
 * `{ ctx, rejected }` from the request headers. No tracking header: nothing
 * to decode, not rejected. A tracking header whose key is missing or wrong
 * (or with no secret configured here): rejected. A verified header that is
 * over 4 KB, not base64url JSON, or of another version: no context. Unknown
 * keys are dropped and values over their caps left out (parseCheckoutContext).
 */
export function decodeTrackingHeader(headers: HeaderSource): DecodedTrackingHeader {
  try {
    const value = readHeader(headers, TRACKING_HEADER)
    if (value === undefined) return { ctx: null, rejected: false }
    if (!verifyIngestKey(readHeader(headers, INGEST_KEY_HEADER))) return { ctx: null, rejected: true }
    return { ctx: decodeContext(value), rejected: false }
  } catch {
    return { ctx: null, rejected: false }
  }
}

/**
 * Counts what the checkout could not use (fire-and-forget; a counter failure
 * never touches the order): `checkout.header_rejected` feeds the
 * checkout_without_tracking alert, `checkout.untrusted` (a context that did
 * not pass the Cloudflare edge check) the edge_missing alert.
 */
export function countCheckoutHeader(container: any, decoded: DecodedTrackingHeader): void {
  try {
    const deltas: Record<string, number> = {}
    if (decoded?.rejected) deltas["checkout.header_rejected"] = 1
    if (decoded?.ctx && decoded.ctx.edge !== true) deltas["checkout.untrusted"] = 1
    if (!Object.keys(deltas).length) return
    bumpCounters(trackingDb(container), deltas).catch(() => undefined)
  } catch {
    // Counting is best effort.
  }
}
