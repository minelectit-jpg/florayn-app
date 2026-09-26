/**
 * Customer details in the exact forms the ad platforms match on, and their
 * SHA-256. Each vendor wants a slightly different form of the same value
 * (Meta's phone has no "+", TikTok's and Google's do; Meta's names lose every
 * space, Google's keep one), so all the forms live side by side here and are
 * tested against the shared vectors in TRACKING.md Appendix C.
 *
 * Every helper returns null for an empty or unusable input, so callers chain
 * `sha256Hex(metaPhone(value))` and simply leave the field out. Phones go
 * through `bdMobile()` and emails through `realEmail()` (never the checkout's
 * no-email placeholder); Parameter Builder's own normaliser is never used for
 * PII (it hashes 01XXXXXXXXX as 1XXXXXXXXX).
 */
import { createHash } from "node:crypto"
import { bdMobile, realEmail } from "../contact"

const SHA256_HEX = /^[0-9a-f]{64}$/
const PUNCTUATION_SYMBOLS_SPACES = /[\p{P}\p{S}\s]/gu
const PUNCTUATION_SYMBOLS = /[\p{P}\p{S}]/gu
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"])

function lowerText(value: unknown): string | null {
  return typeof value === "string" ? value.normalize("NFC").toLowerCase() : null
}

/** Lowercase hex SHA-256 of a UTF-8 string, or null for an empty or missing one. */
export function sha256Hex(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value === "") return null
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** A finished hash: exactly 64 lowercase hex characters (a Parameter Builder "<hex>.AQQC..." is not). */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value)
}

/** Meta's phone form: 8801XXXXXXXXX (country code, no plus). */
export function metaPhone(value: unknown): string | null {
  return bdMobile(value)
}

/** E.164, the form TikTok and Google want: +8801XXXXXXXXX. */
export function e164Phone(value: unknown): string | null {
  const mobile = bdMobile(value)
  return mobile ? `+${mobile}` : null
}

/** Meta fn/ln: lowercase with every punctuation mark, symbol and space removed ("Md Shamim" -> "mdshamim"). */
export function metaName(value: unknown): string | null {
  const name = lowerText(value)?.replace(PUNCTUATION_SYMBOLS_SPACES, "")
  return name || null
}

/** Meta ct: the district, lowercase with no spaces or punctuation ("Cox's Bazar" -> "coxsbazar"). */
export function normCity(value: unknown): string | null {
  const city = lowerText(value)?.replace(PUNCTUATION_SYMBOLS_SPACES, "")
  return city || null
}

/** Google's name form: lowercase, no punctuation, single spaces, trimmed. */
export function plainName(value: unknown): string | null {
  const name = lowerText(value)?.replace(PUNCTUATION_SYMBOLS, "").replace(/\s+/g, " ").trim()
  return name || null
}

/** A real customer email, trimmed and lowercased; null for blanks and the checkout placeholder. */
export function normEmail(value: unknown): string | null {
  return realEmail(value)
}

/** Google's email form: `normEmail`, then no dots in the local part of gmail.com / googlemail.com addresses. */
export function googleEmail(value: unknown): string | null {
  const email = normEmail(value)
  if (!email) return null
  const at = email.lastIndexOf("@")
  const domain = email.slice(at + 1)
  if (!GMAIL_DOMAINS.has(domain)) return email
  const local = email.slice(0, at).replace(/\./g, "")
  return local ? `${local}@${domain}` : null
}
