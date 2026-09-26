import { randomBytes } from "node:crypto"
import { ParamBuilder, PlainDataObject } from "capi-param-builder-nodejs"

import { CLICK_KEYS, type LandingSnapshot } from "../contract"
import { destinationFor, normHost, type PublicTrackingConfig } from "./config"
import { assertServer } from "./guard"
import { sha256Hex, staffCookieValue } from "./keys"
import { classifySource, MAX_CAMPAIGN } from "./source"

assertServer()

/**
 * Every cookie ad tracking sets, reads and clears (TRACKING.md 4.2 cookie
 * table). All are `Path=/; Secure; SameSite=Lax` and host-only, except on a
 * host in `live_hosts`, where `Domain` is the host without a leading "www."
 * (so florayn.com and www.florayn.com share one visitor). Our own values are
 * plain ids or base64url JSON; vendor click ids are set only when they are
 * cookie-safe, never escaped or cut. Meta's Parameter Builder is used ONLY to
 * produce `_fbp`/`_fbc`: its hashing, IP and URL helpers are never called and
 * its `_fbi` cookie is ignored.
 */
export const VISITOR_COOKIE = "_fl_vid"
export const SESSION_COOKIE = "_fl_sid"
export const SOURCE_COOKIE = "_fl_src"
export const GCLID_COOKIE = "_fl_gclid"
export const STAFF_COOKIE = "_fl_staff"
export const OPTOUT_COOKIE = "_fl_optout"

/** Cleared by the opt-out link. `_fl_staff` stays: it only ever removes tracking. */
export const TRACKING_COOKIES = [VISITOR_COOKIE, SESSION_COOKIE, SOURCE_COOKIE, "_fbp", "_fbc", "ttclid", GCLID_COOKIE, "_gcl_aw"]

const DAY = 86_400
export const MAX_AGE = { visitor: 400 * DAY, session: 30 * 60, vendor: 90 * DAY, flag: 400 * DAY } as const

/** RFC 6265 cookie-octets: no space, quote, comma, semicolon or backslash. */
const COOKIE_SAFE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/
const VISITOR_ID = /^v1\.(\d{1,12})\.[0-9a-f]{16}$/
const SESSION_ID = /^s1\.(\d{1,12})\.[0-9a-f]{8}$/
const SOURCE_CLASS = /^[a-z0-9_-]{1,40}$/
const MAX_FBC = 600
const MAX_TTCLID = 1000
const MAX_GOOGLE_CLICK = 300

export type SessionSource = { s: string; c: string | null; k: string }
export type GoogleClickKey = "gclid" | "gbraid" | "wbraid"
export type GoogleClick = { k: GoogleClickKey; v: string; t: number }
export type CookieOptions = { maxAge: number; httpOnly: boolean; domain: string | null }

const unix = (now: number) => Math.floor(now / 1000)

// ---------------------------------------------------------------- ids

export function newVisitorId(now = Date.now()): string {
  return `v1.${unix(now)}.${randomBytes(8).toString("hex")}`
}

export function newSessionId(now = Date.now()): string {
  return `s1.${unix(now)}.${randomBytes(4).toString("hex")}`
}

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID.test(value)
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value)
}

/**
 * A visitor is "new" during the session its id was minted in: both ids carry
 * their creation time, so no server state is needed.
 */
export function isNewVisitor(vid: string, sid: string): boolean {
  const visitor = VISITOR_ID.exec(vid)
  const session = SESSION_ID.exec(sid)
  return Boolean(visitor && session && Number(visitor[1]) >= Number(session[1]))
}

/** First 8 hex of sha256(click id): tells a new ad click apart without storing the id. */
export function clickHash(clickId: string): string {
  return sha256Hex(clickId).slice(0, 8)
}

// ---------------------------------------------------------------- base64url JSON values

export function encodeCookieJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

export function decodeCookieJson(value: unknown): unknown {
  if (typeof value !== "string" || !value || value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

export function decodeSource(value: unknown): SessionSource | null {
  const raw = decodeCookieJson(value) as Record<string, unknown> | null
  if (!raw || typeof raw !== "object" || typeof raw.s !== "string" || !SOURCE_CLASS.test(raw.s)) return null
  const campaign = raw.c === null || raw.c === undefined ? null : raw.c
  if (campaign !== null && (typeof campaign !== "string" || !campaign || campaign.length > MAX_CAMPAIGN)) return null
  if (typeof raw.k !== "string" || !/^([0-9a-f]{8})?$/.test(raw.k)) return null
  return { s: raw.s, c: campaign, k: raw.k }
}

export function decodeGoogleClick(value: unknown): GoogleClick | null {
  const raw = decodeCookieJson(value) as Record<string, unknown> | null
  if (!raw || typeof raw !== "object") return null
  const { k, v, t } = raw
  if (k !== "gclid" && k !== "gbraid" && k !== "wbraid") return null
  if (typeof v !== "string" || !v || v.length > MAX_GOOGLE_CLICK || /[\u0000-\u001f\u007f]/.test(v)) return null
  return Number.isSafeInteger(t) && (t as number) > 0 ? { k, v, t: t as number } : null
}

// ---------------------------------------------------------------- serialisation

/** The shared Domain on a live host (florayn.com for both florayn.com and www.florayn.com), else host-only. */
export function cookieDomain(config: PublicTrackingConfig, host: string): string | null {
  const name = normHost(host)
  return name && config.live_hosts.includes(name) ? name.replace(/^www\./, "") : null
}

export function isCookieSafe(value: unknown): value is string {
  return typeof value === "string" && COOKIE_SAFE.test(value)
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${options.maxAge}`]
  if (options.domain) parts.push(`Domain=${options.domain}`)
  parts.push("Secure")
  if (options.httpOnly) parts.push("HttpOnly")
  parts.push("SameSite=Lax")
  return parts.join("; ")
}

function expired(name: string, domain: string | null): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"]
  if (domain) parts.push(`Domain=${domain}`)
  parts.push("Secure", "SameSite=Lax")
  return parts.join("; ")
}

/**
 * Every Domain a copy of a cookie can live under on this host: the live
 * Domain, the host itself and its parent (fbevents.js writes `_fbp`/`_fbc`
 * with `domain=.florayn.com` even on new.florayn.com, TRACKING.md C6).
 */
function domainVariants(config: PublicTrackingConfig, host: string): string[] {
  const name = normHost(host)
  const variants = new Set<string>()
  const live = cookieDomain(config, host)
  if (live) variants.add(live)
  if (name.includes(".") && !/^[0-9.]+$/.test(name) && !name.startsWith("[")) {
    variants.add(name.replace(/^www\./, ""))
    const labels = name.split(".")
    if (labels.length > 2) variants.add(labels.slice(-2).join("."))
  }
  return [...variants]
}

/** Set-Cookie values that expire the host-only copy and every Domain copy of each cookie. */
export function expireCookies(config: PublicTrackingConfig, host: string, names: readonly string[]): string[] {
  const domains = [null, ...domainVariants(config, host)]
  return names.flatMap((name) => domains.map((domain) => expired(name, domain)))
}

// ---------------------------------------------------------------- sessions

export type Session = { sid: string; src: SessionSource; rotated: boolean }

/**
 * The session for a landing (/api/t/id/): kept while `_fl_sid` is alive (30
 * minutes sliding) unless the landing carries a different ad click or
 * utm_campaign; a new session is classified from the landing (6.7).
 */
export function resolveSession(cookies: Record<string, string>, landing: LandingSnapshot | null, ua: string,
  host: string, now = Date.now()): Session {
  const current = isSessionId(cookies[SESSION_COOKIE]) ? cookies[SESSION_COOKIE] : null
  const saved = decodeSource(cookies[SOURCE_COOKIE])
  const q = landing?.q ?? {}
  const click = CLICK_KEYS.find((key) => q[key])
  const key = click ? clickHash(q[click]) : ""
  const campaign = q.utm_campaign ? q.utm_campaign.slice(0, MAX_CAMPAIGN) : null
  if (current && saved && (!key || key === saved.k) && (campaign === null || campaign === saved.c)) {
    return { sid: current, src: saved, rotated: false }
  }
  const { src, camp } = classifySource({ q, ref: landing?.ref ?? null, ua, host })
  return { sid: newSessionId(now), src: { s: src, c: camp, k: key }, rotated: true }
}

/** The session for an event batch (/api/t/e/): the live one, or a new "direct" one after 30 idle minutes. */
export function slideSession(cookies: Record<string, string>, now = Date.now()): Session {
  const current = isSessionId(cookies[SESSION_COOKIE]) ? cookies[SESSION_COOKIE] : null
  const saved = decodeSource(cookies[SOURCE_COOKIE])
  if (current && saved) return { sid: current, src: saved, rotated: false }
  return { sid: newSessionId(now), src: { s: "direct", c: null, k: "" }, rotated: true }
}

/** `_fl_sid` and `_fl_src` with a fresh 30-minute life. */
export function sessionCookies(config: PublicTrackingConfig, host: string, session: Session): string[] {
  const options = { maxAge: MAX_AGE.session, httpOnly: true, domain: cookieDomain(config, host) }
  return [
    serializeCookie(SESSION_COOKIE, session.sid, options),
    serializeCookie(SOURCE_COOKIE, encodeCookieJson(session.src), options),
  ]
}

// ---------------------------------------------------------------- vendor cookies

type CookieValue = { name: string; value: string }

/** The payload segment of an `_fbc` (fb.<index>.<time>.<fbclid>[.<appendix>]). */
function fbcPayload(value: string | undefined): string | null {
  return value ? value.split(".")[3] ?? null : null
}

/**
 * `_fbp` (only when the browser has no usable one) and `_fbc` (only when the
 * landing's fbclid is new or differs from the saved one) from Meta's Parameter
 * Builder. It gets the landing's allowlisted query, only the `_fbp`/`_fbc`
 * cookies, the referrer origin and the edge-trusted IP; of its CookieSettings
 * only `_fbp`/`_fbc` are used, with our own attributes. The builder also
 * re-issues an existing pixel cookie with its version suffix appended; those
 * rewrites are skipped so the pixel's own cookie is left alone.
 */
export function metaCookies(domain: string | null, host: string, landing: LandingSnapshot | null,
  cookies: Record<string, string>, trustedIp: string | null): CookieValue[] {
  const query = { ...(landing?.q ?? {}) }
  const known: Record<string, string> = {}
  if (cookies._fbp) known._fbp = cookies._fbp
  if (cookies._fbc) known._fbc = cookies._fbc
  let settings: { name: string; value: string }[]
  try {
    const builder = new ParamBuilder([domain ?? normHost(host)])
    settings = builder.processRequestFromContext(new PlainDataObject(
      normHost(host), query, known, landing?.ref ?? null, trustedIp, null, "https", landing?.path ?? "/",
    ))
  } catch {
    return []
  }
  const out: CookieValue[] = []
  for (const setting of settings ?? []) {
    const value = setting?.value
    if (!isCookieSafe(value)) continue
    const rewrite = Boolean(cookies._fbp) && value.startsWith(`${cookies._fbp}.`)
    if (setting.name === "_fbp" && !rewrite && value.length <= 120) out.push({ name: "_fbp", value })
    if (setting.name === "_fbc" && query.fbclid && fbcPayload(cookies._fbc) !== query.fbclid && value.length <= MAX_FBC) {
      out.push({ name: "_fbc", value })
    }
  }
  return out
}

function googleClick(landing: LandingSnapshot | null): { k: GoogleClickKey; v: string } | null {
  const q = landing?.q ?? {}
  for (const k of ["gclid", "gbraid", "wbraid"] as const) {
    const v = q[k]
    if (v && v.length <= MAX_GOOGLE_CLICK && !/[\u0000-\u001f\u007f]/.test(v)) return { k, v }
  }
  return null
}

export type Identity = {
  vid: string
  session: Session
  /** `_fl_vid` was minted by this response. */
  newVisitor: boolean
  /** Set-Cookie header values, in order. */
  setCookies: string[]
  /** Names of the click cookies this response sets (for the ads_only load rule). */
  justSet: string[]
}

/**
 * The cookies of a trusted /api/t/id/ call on a known host (4.2 step 5):
 * create or keep `_fl_vid`, rotate or slide the session, and set a vendor's
 * cookies only when that vendor has a destination on this host. Staff browsers
 * get no vendor cookies: nothing of theirs goes to an ad platform.
 */
export function identify(input: {
  config: PublicTrackingConfig
  host: string
  cookies: Record<string, string>
  landing: LandingSnapshot | null
  ua: string
  trustedIp: string | null
  staff: boolean
  now?: number
}): Identity {
  const { config, host, cookies, landing, ua, trustedIp, staff } = input
  const now = input.now ?? Date.now()
  const domain = cookieDomain(config, host)
  const setCookies: string[] = []
  const justSet: string[] = []

  const known = isVisitorId(cookies[VISITOR_COOKIE]) ? cookies[VISITOR_COOKIE] : null
  const vid = known ?? newVisitorId(now)
  if (!known) setCookies.push(serializeCookie(VISITOR_COOKIE, vid, { maxAge: MAX_AGE.visitor, httpOnly: true, domain }))

  const session = resolveSession(cookies, landing, ua, host, now)
  setCookies.push(...sessionCookies(config, host, session))

  if (!staff) {
    const vendor = { maxAge: MAX_AGE.vendor, httpOnly: false, domain }
    if (destinationFor(config, host, "meta")) {
      for (const { name, value } of metaCookies(domain, host, landing, cookies, trustedIp)) {
        setCookies.push(serializeCookie(name, value, vendor))
        if (name === "_fbc") justSet.push("_fbc")
      }
    }
    const ttclid = landing?.q.ttclid
    if (destinationFor(config, host, "tiktok") && isCookieSafe(ttclid) && ttclid.length <= MAX_TTCLID) {
      setCookies.push(serializeCookie("ttclid", ttclid, vendor))
      justSet.push("ttclid")
    }
    const google = googleClick(landing)
    if (destinationFor(config, host, "google") && google) {
      const saved: GoogleClick = { ...google, t: unix(now) }
      setCookies.push(serializeCookie(GCLID_COOKIE, encodeCookieJson(saved), { ...vendor, httpOnly: true }))
      justSet.push(GCLID_COOKIE)
      if (google.k === "gclid" && isCookieSafe(google.v)) {
        setCookies.push(serializeCookie("_gcl_aw", `GCL.${unix(now)}.${google.v}`, vendor))
      }
    }
  }
  return { vid, session, newVisitor: !known, setCookies, justSet }
}

/** Sets or clears `_fl_staff` (the staff link). */
export function staffCookies(config: PublicTrackingConfig, host: string, on: boolean): string[] {
  const value = staffCookieValue()
  if (!on || !value) return expireCookies(config, host, [STAFF_COOKIE])
  return [serializeCookie(STAFF_COOKIE, value, { maxAge: MAX_AGE.flag, httpOnly: true, domain: cookieDomain(config, host) })]
}

/** Sets `_fl_optout` and expires every tracking cookie, or clears `_fl_optout` (the Privacy page links). */
export function optoutCookies(config: PublicTrackingConfig, host: string, on: boolean): string[] {
  if (!on) return expireCookies(config, host, [OPTOUT_COOKIE])
  return [
    ...expireCookies(config, host, TRACKING_COOKIES),
    serializeCookie(OPTOUT_COOKIE, "1", { maxAge: MAX_AGE.flag, httpOnly: false, domain: cookieDomain(config, host) }),
  ]
}

// ---------------------------------------------------------------- reading click ids back

export type VendorIds = {
  fbp: string | null
  fbc: string | null
  ttp: string | null
  ttclid: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
}

function capped(value: string | undefined, max: number): string | null {
  return value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}

/** The ad-platform ids the browser holds, as the checkout context and ingest `ctx` carry them (4.4 caps). */
export function vendorIds(cookies: Record<string, string>): VendorIds {
  const google = decodeGoogleClick(cookies[GCLID_COOKIE])
  return {
    fbp: capped(cookies._fbp, 120),
    fbc: capped(cookies._fbc, MAX_FBC),
    ttp: capped(cookies._ttp, 100),
    ttclid: capped(cookies.ttclid, MAX_TTCLID),
    gclid: google?.k === "gclid" ? google.v : null,
    gbraid: google?.k === "gbraid" ? google.v : null,
    wbraid: google?.k === "wbraid" ? google.v : null,
  }
}
