import crypto from "node:crypto"

/**
 * Keys derived from TRACKING_INGEST_SECRET (TRACKING.md 4.7, C8, I18). The
 * secret itself never goes over the wire: headers carry
 * HMAC-SHA256(secret, "<purpose>-v1") in lowercase hex. While the secret is
 * rotated the backend (deployed first) also accepts the key derived from
 * TRACKING_INGEST_SECRET_PREVIOUS. Everything fails closed: a missing or short
 * secret means no header verifies. Nothing here logs a secret or a key.
 */
const MIN_SECRET_LENGTH = 32

function readSecret(name: string): string | null {
  const value = process.env[name]
  return typeof value === "string" && value.length >= MIN_SECRET_LENGTH ? value : null
}

/** The current secret, or null when unset or shorter than 32 chars. */
export function ingestSecret(): string | null {
  return readSecret("TRACKING_INGEST_SECRET")
}

/** The previous secret, accepted for verification only while rotating. */
export function previousIngestSecret(): string | null {
  return readSecret("TRACKING_INGEST_SECRET_PREVIOUS")
}

export function hmacHex(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex")
}

/** The `x-florayn-ingest-key` value (ingest and the checkout tracking header). */
export function derivedIngestKey(secret: string): string {
  return hmacHex(secret, "ingest-v1")
}

function sameKey(provided: Buffer, expected: string): boolean {
  const wanted = Buffer.from(expected, "utf8")
  return provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted)
}

/**
 * True when the header equals the key derived from the current secret, or from
 * the previous one while rotating. False when no current secret is configured,
 * for a missing, repeated or wrong-length header, and on any error.
 */
export function verifyIngestKey(header: unknown): boolean {
  try {
    const current = ingestSecret()
    if (!current || typeof header !== "string" || !header) return false
    const provided = Buffer.from(header, "utf8")
    if (sameKey(provided, derivedIngestKey(current))) return true
    const previous = previousIngestSecret()
    return Boolean(previous && previous !== current && sameKey(provided, derivedIngestKey(previous)))
  } catch {
    return false
  }
}

/** The `t` of the staff links (`/api/t/staff/?t=...`), or null without a secret. */
export function staffLinkToken(): string | null {
  const secret = ingestSecret()
  return secret ? hmacHex(secret, "staff-link-v1") : null
}
