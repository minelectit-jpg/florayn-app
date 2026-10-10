import crypto from "node:crypto"

/**
 * The Google Drive pull token (BACKUP.md). It is shown to the admin once, when
 * made, and pasted into the Apps Script's Script Properties; the server keeps
 * only its SHA-256. It can only list and download ENCRYPTED backup files and
 * acknowledge them, so a leak exposes nothing readable.
 */
export function newPullToken(): { token: string; hash: string; hint: string } {
  const token = `flb_${crypto.randomBytes(32).toString("base64url")}`
  return { token, hash: hashToken(token), hint: token.slice(-4) }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex")
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: unknown): string | null {
  if (typeof header !== "string") return null
  const match = /^Bearer\s+(flb_[A-Za-z0-9_-]{43})$/.exec(header.trim())
  return match ? match[1] : null
}

/** Timing-safe check of a presented token against the stored hash. False when either is missing. */
export function verifyPullToken(token: string | null, storedHash: string | null): boolean {
  try {
    if (!token || !storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false
    const a = Buffer.from(hashToken(token), "hex")
    const b = Buffer.from(storedHash, "hex")
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Wrong tokens allowed per window across the process before every pull request
 * answers 429 until the window ends. A real Apps Script never fails auth, so
 * this only slows down guessing.
 */
const FAIL_LIMIT = 30
const FAIL_WINDOW_MS = 10 * 60_000
let failWindow = { start: 0, count: 0 }

export function tooManyFailures(now = Date.now()): boolean {
  if (now - failWindow.start > FAIL_WINDOW_MS) failWindow = { start: now, count: 0 }
  return failWindow.count >= FAIL_LIMIT
}

export function noteFailure(now = Date.now()): void {
  if (now - failWindow.start > FAIL_WINDOW_MS) failWindow = { start: now, count: 0 }
  failWindow.count += 1
}
