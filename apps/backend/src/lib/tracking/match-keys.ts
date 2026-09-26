/**
 * The customer match keys for one order, in every shape the platforms take:
 * Meta CAPI (arrays of hex), the Meta pixel's `fbq("init")` (flat hex),
 * TikTok's Events API (`phone`) and pixel (`phone_number`), and Google's
 * enhanced conversions. They are computed from the saved order at send time;
 * nothing hashed is stored in tracking context.
 *
 * Privacy (TRACKING.md C7, invariant 10): unless `share` is exactly true,
 * only the visitor's hashed first-party id goes out (plus Meta CAPI's hashed
 * country, which is not a contact detail), and there is no Google block. The
 * Meta pixel block with share OFF is `{ external_id }` only (4.1).
 *
 * Names come from the stored `shipping_address.first_name` / `last_name`
 * (checkout already split them: last word = last name). Phone from
 * `shipping_address.phone`, else `metadata.customer_phone`. City from
 * `shipping_address.province`, else `metadata.district`.
 */
import { e164Phone, googleEmail, isSha256Hex, metaName, metaPhone, normCity, normEmail, plainName, sha256Hex } from "./hash"

export type MatchOrder = {
  email?: string | null
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
    province?: string | null
  } | null
  metadata?: Record<string, unknown> | null
}

export type GoogleMatch = {
  sha256_phone_number?: string
  sha256_email_address?: string
  address?: { sha256_first_name?: string; sha256_last_name?: string; country: "BD" }
}

export type MatchKeys = {
  /** Meta CAPI `user_data` hashed keys, as arrays of hex. */
  metaCapi: Record<string, string[]>
  /** Meta pixel advanced matching for `fbq("init", id, keys)`, flat hex. */
  metaPixel: Record<string, string>
  /** TikTok Events API `user` hashed keys. */
  tiktokApi: Record<string, string>
  /** TikTok pixel `ttq.identify()` keys. */
  tiktokPixel: Record<string, string>
  /** Google `gtag("set", "user_data", ...)`; only with share ON and something to match on. */
  google?: GoogleMatch
}

export type MatchKeysInput = { order: MatchOrder | null | undefined; visitorId: string | null | undefined; share: boolean }

const META_COUNTRY_BD = sha256Hex("bd") as string

/** Drop the keys whose value is not a finished 64-hex hash. */
function hashesOnly(fields: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (isSha256Hex(value)) out[key] = value
  }
  return out
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** Every platform's match keys for one order (TRACKING.md 6.2). Empty fields are left out. */
export function buildMatchKeys({ order, visitorId, share }: MatchKeysInput): MatchKeys {
  const externalId = text(visitorId) ? sha256Hex(visitorId as string) : null
  const shareOn = share === true
  const address = order?.shipping_address ?? null
  const metadata = order?.metadata && typeof order.metadata === "object" ? order.metadata : null

  const mobile = shareOn ? metaPhone(address?.phone) ?? metaPhone(metadata?.customer_phone) : null
  const firstName = shareOn ? text(address?.first_name) : null
  const lastName = shareOn ? text(address?.last_name) : null
  const email = shareOn ? order?.email : null

  const meta = hashesOnly({
    ph: sha256Hex(mobile),
    fn: sha256Hex(metaName(firstName)),
    ln: sha256Hex(metaName(lastName)),
    ct: shareOn ? sha256Hex(normCity(address?.province) ?? normCity(metadata?.district)) : null,
    country: META_COUNTRY_BD,
    external_id: externalId,
    em: sha256Hex(normEmail(email)),
  })
  const metaCapi: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(meta)) metaCapi[key] = [value]
  const metaPixel = shareOn ? meta : hashesOnly({ external_id: externalId })

  const tiktokPhone = sha256Hex(e164Phone(mobile))
  const tiktokEmail = sha256Hex(normEmail(email))
  const tiktokApi = hashesOnly({ external_id: externalId, phone: tiktokPhone, email: tiktokEmail })
  const tiktokPixel = hashesOnly({ external_id: externalId, phone_number: tiktokPhone, email: tiktokEmail })

  const keys: MatchKeys = { metaCapi, metaPixel, tiktokApi, tiktokPixel }
  if (!shareOn) return keys

  const google = hashesOnly({
    sha256_phone_number: tiktokPhone,
    sha256_email_address: sha256Hex(googleEmail(email)),
  }) as GoogleMatch
  const names = hashesOnly({
    sha256_first_name: sha256Hex(plainName(firstName)),
    sha256_last_name: sha256Hex(plainName(lastName)),
  })
  if (Object.keys(names).length) google.address = { ...names, country: "BD" }
  if (Object.keys(google).length) keys.google = google
  return keys
}
