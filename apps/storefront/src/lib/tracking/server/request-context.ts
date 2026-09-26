import { isIP } from "node:net"

import { AUDIENCE_COOKIE, audienceFromPath, isAudience, type Audience } from "../../audience"
import { isPrivatePath, LANDING_PARAMS, pathnameOf, type LandingSnapshot } from "../contract"
import { isBot } from "./bots"
import { normHost } from "./config"
import { vendorIds, type Session } from "./cookies"
import { assertServer } from "./guard"
import { devTrustEdge, edgeOk, isStaffCookie, type HeaderReader } from "./keys"

assertServer()

/**
 * What a /api/t/* request (or the checkout Server Action) may believe about
 * itself (TRACKING.md 4.2). The host comes only from the Host header. The IP
 * and country come only from Cloudflare's headers, and only when the request
 * proved it came through Cloudflare (`x-florayn-edge`): X-Forwarded-For and
 * X-Real-Ip are never read, because anyone can send them to the origin.
 * Also here: the bounded body readers and the private, no-store responses
 * every /api/t/* route answers with.
 */
export type DeviceClass = "mobile" | "tablet" | "desktop"

export type RequestContext = {
  host: string
  edgeOk: boolean
  /** TRACKING_DEV_TRUST_EDGE in `next dev`: also accepts http:// origins. */
  dev: boolean
  trustedIp: string | null
  country: string | null
  originOk: boolean
  ua: string
  bot: boolean
  deviceClass: DeviceClass
  cookies: Record<string, string>
  /** From the fl_audience cookie; audienceFor() prefers an event's own path. */
  audience: Audience | null
  /** A valid `_fl_staff` cookie. */
  staff: boolean
  /** `_fl_optout` is present. */
  optout: boolean
}

/** The `ctx` of an ingest batch (4.3). No names, phones or emails, ever. */
export type IngestContext = {
  ip: string | null
  ua: string | null
  vid: string
  sid: string
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
  device: DeviceClass
  audience: Audience | null
  new: boolean
  staff: boolean
}

export const MAX_UA = 400
const IP_CHARS = /^[0-9A-Fa-f:.]{2,45}$/
const BODY_TYPES = ["application/json", "text/plain"]

/** A Cookie header as name -> value (first copy wins), decoded like next/headers does. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null)
  if (!header) return cookies
  for (const part of header.split(";")) {
    const at = part.indexOf("=")
    if (at < 1) continue
    const name = part.slice(0, at).trim()
    if (!name || name in cookies) continue
    let value = part.slice(at + 1).trim()
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1)
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

export function deviceClassOf(ua: string): DeviceClass {
  if (/iPad|Tablet/i.test(ua)) return "tablet"
  return /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop"
}

/** CF-Connecting-IP verbatim (the backend drops anything but hex digits, ":" and "."), only through the edge. */
export function trustedIpOf(headers: HeaderReader, trusted: boolean): string | null {
  const ip = headers.get("cf-connecting-ip")?.trim()
  return trusted && ip && IP_CHARS.test(ip) && isIP(ip) ? ip : null
}

export function countryOf(headers: HeaderReader, trusted: boolean): string | null {
  const country = headers.get("cf-ipcountry")?.trim()
  return trusted && country && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null
}

function originAllowed(headers: HeaderReader, host: string, rawHost: string, dev: boolean): boolean {
  if (headers.get("sec-fetch-site") === "same-origin") return true
  const origin = headers.get("origin")?.trim().toLowerCase()
  if (!origin) return false
  const allowed = [`https://${host}`, `https://${rawHost}`]
  if (dev) allowed.push(`http://${host}`, `http://${rawHost}`)
  return allowed.includes(origin)
}

/** The shared reading of a request's headers and cookies (routes and the checkout Server Action). */
export function readHeaders(headers: HeaderReader, cookies: Record<string, string>): RequestContext {
  const rawHost = (headers.get("host") ?? "").trim().toLowerCase()
  const host = normHost(rawHost)
  const trusted = edgeOk(headers)
  const dev = devTrustEdge()
  const ua = (headers.get("user-agent") ?? "").slice(0, MAX_UA)
  const remembered = cookies[AUDIENCE_COOKIE]
  return {
    host,
    edgeOk: trusted,
    dev,
    trustedIp: trustedIpOf(headers, trusted),
    country: countryOf(headers, trusted),
    originOk: Boolean(host) && originAllowed(headers, host, rawHost, dev),
    ua,
    bot: isBot(ua),
    deviceClass: deviceClassOf(ua),
    cookies,
    audience: isAudience(remembered) ? remembered : null,
    staff: isStaffCookie(cookies._fl_staff),
    optout: Boolean(cookies._fl_optout),
  }
}

export function readRequest(req: Request): RequestContext {
  return readHeaders(req.headers, parseCookies(req.headers.get("cookie")))
}

/** An event's mode: its own path first (/men/... or a Women root page), else the remembered mode. */
export function audienceFor(context: RequestContext, path: string | null | undefined): Audience | null {
  return (path ? audienceFromPath(pathnameOf(path)) : null) ?? context.audience
}

/**
 * The body as text, refusing more than `max` bytes (413) without buffering
 * them, and anything but JSON or text/plain (415; sendBeacon sends
 * text/plain).
 */
export async function readBody(req: Request, max: number):
  Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 | 415 }> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (!BODY_TYPES.includes(type)) return { ok: false, status: 415 }
  const declared = Number(req.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > max) return { ok: false, status: 413 }
  if (!req.body) return { ok: true, text: "" }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400 }
  }
  return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) }
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A referrer reduced to its origin; anything that is not an http(s) URL is dropped. */
function originOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The stub's landing snapshot, re-checked here because the browser can send
 * anything: only the allowlisted params (values up to 1,000 chars), the
 * referrer's origin and a public root-relative path. A private or malformed
 * path drops the whole snapshot (invariant 4).
 */
export function readLanding(raw: unknown): LandingSnapshot | null {
  if (!isRow(raw) || typeof raw.path !== "string") return null
  const path = pathnameOf(raw.path)
  if (!/^\/(?!\/)[!-~]*$/.test(path) || path.length > 300 || /\\/.test(path) || isPrivatePath(path)) return null
  const q: Record<string, string> = {}
  const input = isRow(raw.q) ? raw.q : {}
  for (const key of LANDING_PARAMS) {
    const value = input[key]
    if (typeof value === "string" && value && value.length <= 1000) q[key] = value
  }
  return { q, ref: originOnly(raw.ref), path }
}

/** An EventBatch envelope with its events left raw for validateEvent, or null for a malformed body. */
export function readEventBatch(text: string): { sentAt: number; events: unknown[] } | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRow(raw) || raw.v !== 1 || !Array.isArray(raw.events)) return null
  const sentAt = raw.sent_at
  if (!Number.isSafeInteger(sentAt) || (sentAt as number) <= 0) return null
  return { sentAt: sentAt as number, events: raw.events }
}

// ---------------------------------------------------------------- responses

/** Every /api/t/* answer is per-browser and must never be cached by Cloudflare or Next. */
export const NO_STORE = "private, no-store"

export function respond(status: number, body: string | null = null,
  options: { cookies?: string[]; type?: string; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers({ "cache-control": NO_STORE })
  if (options.type) headers.set("content-type", options.type)
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
  for (const cookie of options.cookies ?? []) headers.append("set-cookie", cookie)
  return new Response(body, { status, headers })
}

export function respondJson(status: number, value: unknown, cookies: string[] = []): Response {
  return respond(status, JSON.stringify(value), { cookies, type: "application/json" })
}

/**
 * The tiny page the staff and opt-out links land on. No referrer leaves it
 * (the staff link's token is in its URL) and search engines skip it.
 */
export function respondPage(status: number, heading: string, message: string, cookies: string[] = []): Response {
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    + "<meta name=\"robots\" content=\"noindex\"><meta name=\"referrer\" content=\"no-referrer\">"
    + `<title>${heading} | Florayn</title></head>`
    + "<body style=\"margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#1a1a1a;background:#fff\">"
    + "<main style=\"max-width:32rem;margin:0 auto;padding:3rem 1rem\">"
    + `<h1 style="font-size:1.25rem;margin:0 0 .75rem">${heading}</h1>`
    + `<p style="margin:0 0 1.5rem">${message}</p>`
    + "<p style=\"margin:0\"><a href=\"/\" style=\"color:inherit\">Back to the shop</a></p>"
    + "</main></body></html>"
  return respond(status, html, {
    cookies,
    type: "text/html; charset=utf-8",
    headers: { "referrer-policy": "no-referrer", "x-robots-tag": "noindex" },
  })
}

/** The ingest `ctx` for one visitor, session and mode. */
export function ingestContext(context: RequestContext, input: {
  vid: string
  session: Session
  audience: Audience | null
  isNew: boolean
}): IngestContext {
  return {
    ip: context.trustedIp,
    ua: context.ua || null,
    vid: input.vid,
    sid: input.session.sid,
    src: input.session.src.s,
    camp: input.session.src.c,
    ...vendorIds(context.cookies),
    country: context.country,
    device: context.deviceClass,
    audience: input.audience,
    new: input.isNew,
    staff: context.staff,
  }
}
