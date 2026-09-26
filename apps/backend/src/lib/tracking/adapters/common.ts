/**
 * The server event vocabulary shared by the Meta and TikTok adapters, and the
 * small guards both use before anything leaves the backend. It lives here,
 * not in the tracking foundation (settings/contract), so the adapters stay
 * pure: callers pass plain data in and get vendor JSON or per-row results
 * back, and nothing here reads settings, the database or the environment.
 *
 * The guards encode rules from TRACKING.md that must hold whatever a caller
 * passes: hashed fields are exactly 64 lowercase hex (a Parameter Builder
 * suffixed hash is dropped, never sent), no URL on a private path
 * (`/order/`, `/review/`, `/account/`) is sent, the only order reference is
 * `fl-N`, and a token never appears in a thrown error or returned message.
 */
import { isPurchaseEventId, isStatusEventId, type StatusEventName } from "../event-ids"
import { isSha256Hex } from "../hash"

export type ServerPlatform = "meta" | "tiktok"
export type ServerEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase"
  | "OrderConfirmed"
  | "Delivered"
  | "Returned"
export type ActionSource = "website" | "system_generated"

export type EventItemInput = { id: string; quantity: number; price: number }

export type EventInput = {
  name: ServerEventName
  eventId: string
  /** When the event happened (Purchase: order.created_at; COD: the status change). */
  time: Date
  /** The public page URL (`https://<host><safe path>`). Purchase always reports `https://<host>/checkout/`. */
  url?: string | null
  /** `website` for the funnel and Purchase, `system_generated` for the COD status events. */
  actionSource: ActionSource
  user: {
    /** cf-connecting-ip; Meta may take a Parameter Builder suffixed form, TikTok gets the plain address. */
    ip?: string | null
    ua?: string | null
    fbp?: string | null
    fbc?: string | null
    /** sha256 hex of the `_fl_vid` visitor id. */
    externalId?: string | null
    /** ISO country from Cloudflare (two letters). */
    country?: string | null
    ttclid?: string | null
    ttp?: string | null
    /** Extra Meta hashed keys (`buildMatchKeys().metaCapi`). */
    meta?: Record<string, string[]>
    /** Extra TikTok hashed keys (`buildMatchKeys().tiktokApi`). */
    tiktok?: Record<string, string>
  }
  custom: {
    items?: EventItemInput[]
    /** BDT major units; Purchase is the order total including delivery. */
    value?: number
    numItems?: number
    /** `fl-<display_id>` for Purchase and the COD events. */
    orderId?: string
  }
  /** The Purchase a COD status event follows up (Meta `original_event_data`). */
  original?: { eventName: "Purchase"; time: Date; orderId: string; eventId: string }
}

export type AdapterConfig = {
  /** Meta dataset id or TikTok pixel code, fixed when the row was enqueued. */
  destination: string
  token: string
  env: "test" | "live"
  /** Meta Graph API version, e.g. "v26.0". */
  apiVersion?: string
  /** Meta Test Events code; sent only when `env` is "test". */
  testEventCode?: string | null
}

/**
 * What happened to one row. `transient`: retry with backoff. `blocked`: bad
 * or missing token or permission; park until the token changes. `payload`:
 * the vendor rejected the content; split and retry, a single bad row fails.
 * `expired`: older than Meta's 7 days; never retry.
 */
export type ResultClass = "ok" | "transient" | "blocked" | "payload" | "expired"

/**
 * One row's result, `index` into the events that were sent. When the vendor
 * names the bad row (TikTok 40002), only that row is `payload` and the others
 * are `transient`, because nothing in the rejected request was accepted.
 * `message` never contains a token, and is at most 300 characters.
 */
export type SendResult = { index: number; cls: ResultClass; message: string; traceId?: string }

export const MAX_BATCH_EVENTS = 500
export const SEND_TIMEOUT_MS = 8000
export const CURRENCY = "BDT"

export const STATUS_EVENTS: ReadonlySet<string> = new Set(["OrderConfirmed", "Delivered", "Returned"])
const SERVER_EVENTS: ReadonlySet<string> = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
  "OrderConfirmed",
  "Delivered",
  "Returned",
])
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,100}$/
// A raw Medusa id (order_..., cart_...) is a capability or joins to one; it is never an event id.
const RAW_ID = /(^|[^a-z])(order|cart)_/i
const PRIVATE_SEGMENTS = new Set(["order", "review", "account"])

/** A structured error for caller mistakes (an oversized batch). Its message never holds a token. */
export class TrackingAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TrackingAdapterError"
  }
}

export function isServerEventName(value: unknown): value is ServerEventName {
  return typeof value === "string" && SERVER_EVENTS.has(value)
}

/** Meta's terms require an accurate action_source: the COD events are system generated, the rest are website. */
export function actionSourceFor(name: ServerEventName): ActionSource {
  return STATUS_EVENTS.has(name) ? "system_generated" : "website"
}

/** Purchase must be `fl-N`, a COD event its own `oc|dl|rt-fl-N`, anything else a short id that is not a raw Medusa id. */
export function isServerEventId(name: ServerEventName, id: unknown): id is string {
  if (typeof id !== "string") return false
  if (name === "Purchase") return isPurchaseEventId(id)
  if (STATUS_EVENTS.has(name)) return isStatusEventId(name as StatusEventName, id)
  return EVENT_ID.test(id) && !RAW_ID.test(id)
}

/** The shared header checks: a known event, a valid id for it, a real time and the right action source. */
export function checkEventInput(input: EventInput | null | undefined): { eventTime: number } | null {
  if (!input || !isServerEventName(input.name)) return null
  if (!isServerEventId(input.name, input.eventId)) return null
  if (input.actionSource !== actionSourceFor(input.name)) return null
  const eventTime = unixSeconds(input.time)
  return eventTime === null ? null : { eventTime }
}

/** Unix seconds (UTC) of a Date, or null for an invalid one. */
export function unixSeconds(value: Date | null | undefined): number | null {
  const ms = value && typeof (value as Date).getTime === "function" ? (value as Date).getTime() : NaN
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null
}

/** The value when it is a finished 64-hex hash, else null (never sent). */
export function hashOrNull(value: unknown): string | null {
  return isSha256Hex(value) ? value : null
}

/** The order reference when it is `fl-N`, else null: a raw `order_...` id never leaves the backend. */
export function orderRef(value: unknown): string | null {
  return isPurchaseEventId(value) ? value : null
}

/** A non-empty string without whitespace, at most `max` characters, else null. */
export function compact(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  return v && v.length <= max && !/\s/.test(v) ? v : null
}

/** A non-empty string at most `max` characters (inner spaces allowed, e.g. a user agent), else null. */
export function singleLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  return v && v.length <= max && !/[\r\n]/.test(v) ? v : null
}

/** A non-negative amount rounded to 2 decimals, or null. */
export function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null
}

/** Items with a real id, a whole positive quantity and a non-negative price; anything else is dropped. */
export function cleanItems(items: unknown): EventItemInput[] {
  if (!Array.isArray(items)) return []
  const out: EventItemInput[] = []
  for (const item of items.slice(0, 100)) {
    const id = compact(item?.id, 100)
    const quantity = item?.quantity
    const price = money(item?.price)
    if (!id || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000 || price === null) continue
    out.push({ id, quantity, price })
  }
  return out
}

/** `num_items`: the caller's count when it is a whole number, else the sum of the item quantities. */
export function itemCount(numItems: unknown, items: EventItemInput[]): number {
  if (Number.isSafeInteger(numItems) && (numItems as number) >= 0) return numItems as number
  return items.reduce((sum, item) => sum + item.quantity, 0)
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** A private storefront path: first segment (after one optional `/men`) is order, review or account. */
export function isPrivatePathname(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean).map((s) => decode(s).toLowerCase())
  if (segments[0] === "men") segments.shift()
  return PRIVATE_SEGMENTS.has(segments[0] ?? "")
}

/**
 * The page URL to report for an event, or null. Only http(s) URLs without
 * credentials, never a private path and never anything containing `/order/`.
 * Purchase always reports `<origin>/checkout/`, whatever page was passed:
 * the order page is a guest access capability (TRACKING.md C1, invariant 4).
 */
export function eventUrl(name: ServerEventName, url: unknown): string | null {
  if (typeof url !== "string" || !url || url.length > 1000) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || !parsed.hostname) return null
  if (name === "Purchase") return `${parsed.origin}/checkout/`
  const clean = `${parsed.origin}${parsed.pathname}${parsed.search}`
  if (isPrivatePathname(parsed.pathname) || /\/order\//i.test(decode(clean))) return null
  return clean
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function isIPv4(value: string): boolean {
  return IPV4.test(value)
}

function isIPv6(value: string): boolean {
  if (value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value) || !value.includes(":")) return false
  const halves = value.split("::")
  if (halves.length > 2) return false
  const groups = halves.flatMap((half) => (half ? half.split(":") : []))
  let count = groups.length
  const last = groups[groups.length - 1]
  if (last?.includes(".")) {
    if (!isIPv4(last)) return false
    groups.pop()
    count += 1
  }
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return halves.length === 2 ? count <= 7 : count === 8
}

export function isIp(value: string): boolean {
  return isIPv4(value) || isIPv6(value)
}

/**
 * The plain IPv4/IPv6 address at the start of a value, dropping a Parameter
 * Builder suffix ("103.4.145.2.AQQAAQMC" -> "103.4.145.2"); null otherwise.
 */
export function plainIp(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (isIp(v)) return v
  const cut = v.lastIndexOf(".")
  const head = cut > 0 ? v.slice(0, cut) : ""
  return head && isIp(head) ? head : null
}

/**
 * A vendor or network message made safe to store and show: the token (and
 * anything shaped like a Meta access token) replaced, one line, at most 300
 * characters. Never holds a request body.
 */
export function redact(message: unknown, secret: string | null | undefined): string {
  let text = typeof message === "string" ? message : String(message ?? "")
  if (secret && secret.length >= 4) text = text.split(secret).join("[token]")
  text = text.replace(/\bEAA[A-Za-z0-9]{20,}/g, "[token]").replace(/\s+/g, " ").trim()
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

/** A short description of a failed fetch (network error or the 8 s timeout). */
export function describeFailure(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown } | null
  const name = typeof e?.name === "string" ? e.name : "Error"
  if (name === "TimeoutError" || name === "AbortError") return `timeout: no answer within ${SEND_TIMEOUT_MS / 1000} s`
  return `network: ${name}${typeof e?.message === "string" && e.message ? `: ${e.message}` : ""}`
}

/** The same result for every row. */
export function everyRow(count: number, cls: ResultClass, message: string, traceId?: string): SendResult[] {
  return Array.from({ length: count }, (_, index) => (traceId ? { index, cls, message, traceId } : { index, cls, message }))
}

/** A response body as JSON, or null when it is not JSON. */
export function parseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}
