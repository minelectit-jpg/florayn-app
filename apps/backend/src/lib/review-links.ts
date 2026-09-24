import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * The review link in a request email: `/product/<handle>/?review=<token>&r=<stars>`.
 *
 * The token names one order and is signed with the server secret, so it can
 * only be read, never forged or pointed at another order. It lets that order's
 * customer review the products they bought without signing in, as a verified
 * buyer. (florayn.com's link only pre-filled a form anyone could send.)
 */
const PREFIX = "florayn-review-invite|"
const STOREFRONT = process.env.STOREFRONT_URL || "https://new.florayn.com"

function secret(): string {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error("JWT_SECRET is not set; review links cannot be signed.")
  return value
}

function sign(orderId: string): string {
  return createHmac("sha256", secret()).update(PREFIX + orderId).digest("base64url").slice(0, 32)
}

export function reviewToken(orderId: string): string {
  return `${orderId}.${sign(orderId)}`
}

/** The order a token was issued for, or null when it is malformed or forged. */
export function readReviewToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 200) return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const orderId = token.slice(0, dot)
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return null
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(orderId))
  return given.length === expected.length && timingSafeEqual(given, expected) ? orderId : null
}

/** A star in the email: opens the product's review form with that rating chosen. */
export function reviewLink(handle: string, token: string, rating: number): string {
  const r = Math.min(5, Math.max(1, Math.round(rating)))
  return `${STOREFRONT}/product/${encodeURIComponent(handle)}/?review=${encodeURIComponent(token)}&r=${r}#customer-reviews`
}

export function storefrontUrl(): string {
  return STOREFRONT
}
