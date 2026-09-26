import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { assertServer } from "./guard"

assertServer()

/**
 * Secrets and the keys derived from them (TRACKING.md 4.7). The raw
 * TRACKING_INGEST_SECRET never leaves this process: headers and cookies carry
 * HMAC-SHA256(secret, "<purpose>-v1") in lowercase hex, computed the same way
 * as the backend's lib/tracking/secret.ts and tested against the same
 * Appendix C vectors. A secret shorter than 32 chars counts as unset, and
 * everything fails closed without one. Nothing here logs a secret, a key or a
 * header value.
 */
const MIN_SECRET_LENGTH = 32

export type HeaderReader = { get(name: string): string | null }

function readSecret(name: string): string | null {
  const value = process.env[name]
  return typeof value === "string" && value.length >= MIN_SECRET_LENGTH ? value : null
}

/** TRACKING_INGEST_SECRET (the same value as the backend's), or null when unset or short. */
export function ingestSecret(): string | null {
  return readSecret("TRACKING_INGEST_SECRET")
}

/** TRACKING_EDGE_SECRET: the value of the header Cloudflare's Transform Rule adds. */
export function edgeSecret(): string | null {
  return readSecret("TRACKING_EDGE_SECRET")
}

function hmacHex(message: string): string | null {
  const secret = ingestSecret()
  return secret ? createHmac("sha256", secret).update(message).digest("hex") : null
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** The `x-florayn-ingest-key` header for /tracking/ingest and the checkout context. */
export function derivedIngestKey(): string | null {
  return hmacHex("ingest-v1")
}

/** The InitiateCheckout event id for a cart: never the raw cart id, which is a capability. */
export function icEventId(cartId: string): string | null {
  if (typeof cartId !== "string" || !cartId) return null
  const digest = hmacHex(`ic-v1:${cartId}`)
  return digest ? `ic-${digest.slice(0, 24)}` : null
}

/** The `t` of the staff links Admin > Live hands out. */
export function staffLinkToken(): string | null {
  return hmacHex("staff-link-v1")
}

/** The `_fl_staff` cookie value. Rotating the secret invalidates it (staff click the new link). */
export function staffCookieValue(): string | null {
  return hmacHex("staff-cookie-v1")
}

/** Constant-time string equality after a length check; false for anything that is not two strings. */
export function timingSafeEqualStr(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}

/** True for a `_fl_staff` cookie minted from the current secret. */
export function isStaffCookie(value: unknown): boolean {
  const expected = staffCookieValue()
  return Boolean(expected) && timingSafeEqualStr(value, expected)
}

/**
 * Local development only: `next dev` with TRACKING_DEV_TRUST_EDGE=1 trusts
 * requests without the edge header. `next start` always runs with
 * NODE_ENV=production, so this can never switch on in a deployed app.
 */
export function devTrustEdge(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TRACKING_DEV_TRUST_EDGE === "1"
}

/**
 * The request came through Cloudflare: `x-florayn-edge` equals
 * TRACKING_EDGE_SECRET. Without the secret (or without the Cloudflare rule
 * that sends it) nothing is trusted and tracking stays inert (invariant 8).
 */
export function edgeOk(headers: HeaderReader): boolean {
  if (devTrustEdge()) return true
  const secret = edgeSecret()
  return Boolean(secret) && timingSafeEqualStr(headers.get("x-florayn-edge"), secret)
}
