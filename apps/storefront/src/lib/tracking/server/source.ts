import { assertServer } from "./guard"

assertServer()

/**
 * Where a session came from (TRACKING.md 6.7), decided once when the session
 * starts and kept in `_fl_src`. Pure: it sees only the landing's allowlisted
 * query params, the referrer's ORIGIN and the User-Agent. The first rule that
 * matches wins, and an fbclid alone is "meta", not "meta_paid": Meta adds it to
 * organic clicks too. Tested against Appendix C `source`.
 */
export type SourceInput = {
  q: Record<string, string> | null | undefined
  ref: string | null | undefined
  ua: string | null | undefined
  host: string
}
export type SourceResult = { src: string; camp: string | null }

const PAID_MEDIUMS = ["paid", "cpc", "ads", "ppc", "paidsocial"]
const META_SOURCES = ["facebook", "fb", "instagram", "ig", "meta"]
export const MAX_CAMPAIGN = 80

function param(q: SourceInput["q"], key: string): string {
  const value = q?.[key]
  return typeof value === "string" ? value : ""
}

/** The referrer's host name, or null for none or anything that is not an http(s) URL. */
function referrerHost(ref: SourceInput["ref"]): string | null {
  if (!ref) return null
  try {
    const url = new URL(ref)
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d*$/, "").replace(/^www\./, "")
}

/** utm_source as a source class: known networks by name, anything else reduced to a slug. */
function paidSource(utmSource: string): string {
  const slug = utmSource.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30)
  if (META_SOURCES.includes(slug)) return "meta"
  if (slug === "tiktok" || slug === "google") return slug
  return slug || "unknown"
}

function sourceOf({ q, ref, ua, host }: SourceInput): string {
  const agent = ua ?? ""
  const from = referrerHost(ref)
  if (param(q, "ttclid")) return "tiktok_paid"
  if (param(q, "gclid") || param(q, "gbraid") || param(q, "wbraid")) return "google_paid"
  if (PAID_MEDIUMS.includes(param(q, "utm_medium").trim().toLowerCase())) return `${paidSource(param(q, "utm_source"))}_paid`
  if (param(q, "fbclid") || (from && /(^|\.)(facebook|instagram)\.com$/.test(from)) || /FBAN|FBAV|Instagram/.test(agent)) {
    return "meta"
  }
  if (/musical_ly|BytedanceWebview/.test(agent) || (from && /(^|\.)tiktok\.com$/.test(from))) return "tiktok"
  if (from && /(^|\.)google\.[a-z.]+$/.test(from)) return "google_organic"
  if ((from && /whatsapp|wa\.me|messenger\.com/.test(from)) || /WhatsApp/.test(agent)) return "messaging"
  if (from && bareHost(from) !== bareHost(host)) return "referral"
  return "direct"
}

export function classifySource(input: SourceInput): SourceResult {
  const campaign = param(input.q, "utm_campaign").slice(0, MAX_CAMPAIGN)
  return { src: sourceOf(input), camp: campaign || null }
}
