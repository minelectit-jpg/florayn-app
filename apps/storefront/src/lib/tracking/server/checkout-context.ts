import { cookies, headers } from "next/headers"

import { getTrackingConfig } from "./config"
import { decodeSource, isNewVisitor, isSessionId, isVisitorId, vendorIds } from "./cookies"
import { assertServer } from "./guard"
import { derivedIngestKey } from "./keys"
import { audienceFor, readHeaders, type DeviceClass } from "./request-context"

assertServer()

/**
 * The tracking context the checkout Server Action sends with placeOrder
 * (TRACKING.md 4.4). Deliberately NOT a "use server" file, so it adds no
 * Server Action. It reads only headers() and cookies() of the current
 * request, never the action's arguments, so a shopper cannot hand it values.
 * Staff, opted-out and edge-less requests still send a context with their
 * flags: the backend decides what may reach an ad platform. It returns null
 * only while TRACKING_INGEST_SECRET is unset (tracking off).
 */
export { icEventId } from "./keys"

export type CheckoutTrackingContext = {
  v: 1
  host: string | null
  page_url: string | null
  edge: boolean
  ip: string | null
  ua: string | null
  vid: string | null
  sid: string | null
  src: string | null
  camp: string | null
  fbp: string | null
  fbc: string | null
  ttp: string | null
  ttclid: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  country: string | null
  device: DeviceClass | null
  audience: "women" | "men" | null
  new: boolean
  staff: boolean
  optout: boolean
  consent_version: number | null
}

/** The 4.4 length caps; the backend drops a longer value rather than cutting it. */
const CAPS = {
  host: 100, page_url: 200, ip: 45, ua: 400, vid: 40, sid: 40, src: 40, camp: 80,
  fbp: 120, fbc: 600, ttp: 100, ttclid: 1000, gclid: 300, gbraid: 300, wbraid: 300,
} as const
export const MAX_TRACKING_HEADER = 4096
/** Left out, in this order, in the rare case the header would pass 4 KB. */
const SHED: (keyof typeof CAPS)[] = ["ttp", "camp", "gbraid", "wbraid", "gclid", "ttclid", "fbc", "ua"]

function capAll(context: CheckoutTrackingContext): CheckoutTrackingContext {
  const out = { ...context }
  for (const [key, max] of Object.entries(CAPS) as [keyof typeof CAPS, number][]) {
    const value = out[key]
    if (typeof value === "string" && (value.length > max || /[\u0000-\u001f\u007f]/.test(value))) out[key] = null
  }
  return out
}

/** base64url(JSON), at most 4 KB. */
export function encodeTrackingHeader(context: CheckoutTrackingContext): string {
  const out = capAll(context)
  let value = Buffer.from(JSON.stringify(out), "utf8").toString("base64url")
  for (const key of SHED) {
    if (value.length <= MAX_TRACKING_HEADER) break
    out[key] = null
    value = Buffer.from(JSON.stringify(out), "utf8").toString("base64url")
  }
  return value
}

export async function checkoutTrackingHeaders(): Promise<Record<string, string> | null> {
  const key = derivedIngestKey()
  if (!key) return null
  try {
    const [headerList, cookieStore, config] = await Promise.all([headers(), cookies(), getTrackingConfig()])
    const jar: Record<string, string> = Object.create(null)
    for (const { name, value } of cookieStore.getAll()) {
      if (!(name in jar)) jar[name] = value
    }
    const request = readHeaders(headerList, jar)
    const vid = isVisitorId(jar._fl_vid) ? jar._fl_vid : null
    const sid = isSessionId(jar._fl_sid) ? jar._fl_sid : null
    const source = decodeSource(jar._fl_src)
    const context: CheckoutTrackingContext = {
      v: 1,
      host: request.host || null,
      page_url: request.host ? `https://${request.host}/checkout/` : null,
      edge: request.edgeOk,
      ip: request.trustedIp,
      ua: request.ua || null,
      vid,
      sid,
      src: source?.s ?? null,
      camp: source?.c ?? null,
      ...vendorIds(jar),
      country: request.country,
      device: request.deviceClass,
      audience: audienceFor(request, "/checkout/"),
      new: Boolean(vid && sid && isNewVisitor(vid, sid)),
      staff: request.staff,
      optout: request.optout,
      consent_version: config.privacy.consent_version,
    }
    return { "x-florayn-ingest-key": key, "x-florayn-tracking": encodeTrackingHeader(context) }
  } catch {
    // Outside a request scope; the order must still go through. The backend's
    // checkout_without_tracking alert reports a context that never arrives.
    return null
  }
}
