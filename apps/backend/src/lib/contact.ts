/**
 * How to reach a customer. Checkout lets a shopper leave the email blank, and
 * then stores `<phone>@no-email.florayn.local` on the order because Medusa
 * wants an address (workflows/checkout-service.ts). That placeholder must
 * never be mailed, so everything that sends to a customer reads the email
 * through `realEmail` and falls back to the phone (WhatsApp).
 */
export const NO_EMAIL_DOMAIN = "no-email.florayn.local"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A deliverable email address (lower-cased), or null for blanks and the checkout placeholder. */
export function realEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  if (!EMAIL.test(email) || email.endsWith(`@${NO_EMAIL_DOMAIN}`)) return null
  return email
}

/**
 * A Bangladeshi mobile number in the international form WhatsApp and wa.me
 * links use (8801XXXXXXXXX), from any of 01XXXXXXXXX, +880 1XXX-XXXXXX,
 * 8801XXXXXXXXX or 00880..., or null when it is not a BD mobile.
 */
export function bdMobile(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  let digits = String(value).replace(/\D/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith("880")) digits = digits.slice(3)
  else if (digits.startsWith("0")) digits = digits.slice(1)
  return /^1[3-9]\d{8}$/.test(digits) ? `880${digits}` : null
}

/** The customer's phone as they wrote it (01XXXXXXXXX), for display. */
export function localMobile(value: unknown): string | null {
  const mobile = bdMobile(value)
  return mobile ? `0${mobile.slice(3)}` : null
}
