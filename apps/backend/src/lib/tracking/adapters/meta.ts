/**
 * Meta Conversions API: the event JSON (TRACKING.md 5.4 and 6.2) and one
 * batch send. Pure apart from the injected fetch; the outbox (WP03) decides
 * what to do with each row's result class.
 *
 * - The token goes in the JSON body, never the URL, and never into a thrown
 *   error or a returned message. `test_event_code` is added only for the TEST
 *   environment (it does not keep events out of ad data; the TEST dataset does).
 * - ip, user agent, fbp and fbc are sent raw (never hashed); every hashed key
 *   must be 64 lowercase hex or it is dropped.
 * - `event_source_url` is sent only for website events, never on a private
 *   path, and is always `https://<host>/checkout/` for Purchase.
 * - The COD events (OrderConfirmed, Delivered, Returned) are
 *   `system_generated` with `original_event_data` pointing at the Purchase.
 */
import { sha256Hex } from "../hash"
import {
  CURRENCY,
  MAX_BATCH_EVENTS,
  SEND_TIMEOUT_MS,
  STATUS_EVENTS,
  TrackingAdapterError,
  checkEventInput,
  cleanItems,
  compact,
  describeFailure,
  eventUrl,
  everyRow,
  hashOrNull,
  itemCount,
  money,
  orderRef,
  parseJson,
  plainIp,
  redact,
  singleLine,
  unixSeconds,
  type ActionSource,
  type AdapterConfig,
  type EventInput,
  type ResultClass,
  type SendResult,
  type ServerEventName,
} from "./common"

const GRAPH = "https://graph.facebook.com"
export const DEFAULT_META_API_VERSION = "v26.0"
const API_VERSION = /^v\d{2}\.\d$/
const DATASET_ID = /^\d{10,20}$/
const FB_COOKIE = /^fb\.\d\.\d{10,16}\.\S{1,1000}$/
const META_HASHED_KEYS = ["em", "ph", "fn", "ln", "ge", "db", "ct", "st", "zp", "country", "external_id"]
const META_COUNTRY_BD = sha256Hex("bd") as string
const SEVEN_DAYS_S = 7 * 24 * 60 * 60

// Graph API error codes (developers.facebook.com/docs/graph-api/guides/error-handling).
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 341, 368])
const BLOCKED_CODES = new Set([10, 102, 190])
const EXPIRED_MESSAGE = /\b(7|seven) days\b|too far in the past|timestamp too old/i

export type MetaEvent = {
  event_name: ServerEventName
  event_time: number
  event_id: string
  action_source: ActionSource
  event_source_url?: string
  user_data: Record<string, string | string[]>
  custom_data?: Record<string, unknown>
  original_event_data?: { event_name: "Purchase"; event_time: number; order_id: string; event_id: string }
  opt_out: false
}

export type MetaGraphError = {
  code?: number
  error_subcode?: number
  type?: string
  message?: string
  error_user_title?: string
  error_user_msg?: string
  fbtrace_id?: string
  is_transient?: boolean
}

function fbCookie(value: unknown): string | null {
  const v = compact(value, 1100)
  return v && FB_COOKIE.test(v) ? v : null
}

function metaUserData(input: EventInput): Record<string, string | string[]> {
  const user = input.user ?? {}
  const data: Record<string, string | string[]> = {}
  // ip and user agent describe the browser that made a website event; a COD
  // status change happens days later with no browser, so they are left out.
  if (input.actionSource === "website") {
    const ip = plainIp(user.ip) ? compact(user.ip, 100) : null
    if (ip) data.client_ip_address = ip
    const ua = singleLine(user.ua, 1000)
    if (ua) data.client_user_agent = ua
  }
  const fbp = fbCookie(user.fbp)
  if (fbp) data.fbp = fbp
  const fbc = fbCookie(user.fbc)
  if (fbc) data.fbc = fbc

  const hashed = new Map<string, Set<string>>()
  const add = (key: string, value: unknown) => {
    const hash = hashOrNull(value)
    if (!hash) return
    const set = hashed.get(key) ?? new Set<string>()
    set.add(hash)
    hashed.set(key, set)
  }
  add("external_id", user.externalId)
  // The shop only ships to Bangladesh, so only a BD visitor's country is a useful match key.
  if (typeof user.country === "string" && user.country.trim().toUpperCase() === "BD") add("country", META_COUNTRY_BD)
  for (const key of META_HASHED_KEYS) {
    const values = user.meta?.[key]
    for (const value of Array.isArray(values) ? values : [values]) add(key, value)
  }
  for (const [key, values] of hashed) data[key] = [...values]
  return data
}

function metaCustomData(input: EventInput): Record<string, unknown> | null {
  const name = input.name
  if (name === "PageView") return null
  const custom = input.custom ?? {}
  const items = cleanItems(custom.items)
  const status = STATUS_EVENTS.has(name)
  const data: Record<string, unknown> = {}
  if (items.length) {
    data.content_type = "product"
    data.content_ids = [...new Set(items.map((item) => item.id))]
    if (!status) data.contents = items.map((item) => ({ id: item.id, quantity: item.quantity, item_price: item.price }))
  }
  const value = money(custom.value)
  if (value !== null) data.value = value
  data.currency = CURRENCY
  if (name === "InitiateCheckout" || name === "Purchase") data.num_items = itemCount(custom.numItems, items)
  if (name === "Purchase" || status) {
    const ref = orderRef(custom.orderId)
    if (ref) data.order_id = ref
  }
  if (name === "Purchase") data.delivery_category = "home_delivery"
  return data
}

function originalEventData(input: EventInput): MetaEvent["original_event_data"] | null {
  const original = input.original
  if (!STATUS_EVENTS.has(input.name) || !original || original.eventName !== "Purchase") return null
  const eventTime = unixSeconds(original.time)
  const orderId = orderRef(original.orderId)
  const eventId = orderRef(original.eventId)
  return eventTime !== null && orderId && eventId ? { event_name: "Purchase", event_time: eventTime, order_id: orderId, event_id: eventId } : null
}

/**
 * One Meta CAPI event, or null when the input is not a sendable event (unknown
 * name, malformed id, invalid time, or an action source that does not match
 * the event).
 */
export function buildMetaEvent(input: EventInput): MetaEvent | null {
  const head = checkEventInput(input)
  if (!head) return null
  const event: MetaEvent = {
    event_name: input.name,
    event_time: head.eventTime,
    event_id: input.eventId,
    action_source: input.actionSource,
    user_data: metaUserData(input),
    opt_out: false,
  }
  if (input.actionSource === "website") {
    const url = eventUrl(input.name, input.url)
    if (url) event.event_source_url = url
  }
  const custom = metaCustomData(input)
  if (custom) event.custom_data = custom
  const original = originalEventData(input)
  if (original) event.original_event_data = original
  return event
}

/**
 * The result class of one Meta response (TRACKING.md 6.2). Specific codes win
 * over the error `type`, because Graph reports almost every error, invalid
 * parameters included, as an OAuthException.
 */
export function classifyMeta(response: { status?: number; error?: MetaGraphError | null; network?: boolean }): ResultClass {
  if (response.network) return "transient"
  const status = response.status ?? 0
  const error = response.error ?? null
  if (!error && status >= 200 && status < 300) return "ok"
  if (error) {
    const text = [error.message, error.error_user_title, error.error_user_msg].filter((t) => typeof t === "string").join(" ")
    if (EXPIRED_MESSAGE.test(text)) return "expired"
    const code = error.code
    if (typeof code === "number") {
      if (TRANSIENT_CODES.has(code)) return "transient"
      if (BLOCKED_CODES.has(code) || (code >= 200 && code <= 299)) return "blocked"
      if (code === 100) return "payload"
    }
    if (error.is_transient === true) return "transient"
    if (error.type === "OAuthException") return "blocked"
  }
  if (status >= 500 || status === 429) return "transient"
  if (status === 401 || status === 403) return "blocked"
  return "transient"
}

function metaErrorText(status: number, error: MetaGraphError | null): string {
  if (!error) return `HTTP ${status}`
  const code = typeof error.code === "number" ? String(error.code) : "?"
  const subcode = typeof error.error_subcode === "number" ? `/${error.error_subcode}` : ""
  const type = typeof error.type === "string" ? ` ${error.type}` : ""
  const parts = [error.error_user_title, error.message, error.error_user_msg].filter((t): t is string => typeof t === "string" && t.trim() !== "")
  return `HTTP ${status} code ${code}${subcode}${type}: ${[...new Set(parts)].join(" - ") || "no message"}`
}

/**
 * Send up to 500 built events to one dataset in one request. Resolves with a
 * result per event and never rejects for a vendor or network failure; throws
 * only for a batch over 500 (a caller bug). `now` is for tests.
 */
export async function sendMetaBatch(
  fetchImpl: typeof fetch,
  cfg: AdapterConfig,
  events: readonly MetaEvent[],
  options: { now?: number } = {}
): Promise<SendResult[]> {
  if (events.length > MAX_BATCH_EVENTS) {
    throw new TrackingAdapterError(`A Meta request takes at most ${MAX_BATCH_EVENTS} events; got ${events.length}.`)
  }
  if (!events.length) return []
  const secret = typeof cfg.token === "string" ? cfg.token.trim() : ""
  if (!secret) return everyRow(events.length, "blocked", "no token")
  if (!DATASET_ID.test(cfg.destination ?? "")) return everyRow(events.length, "blocked", "no valid dataset id")
  const version = cfg.apiVersion && API_VERSION.test(cfg.apiVersion) ? cfg.apiVersion : DEFAULT_META_API_VERSION

  const body: Record<string, unknown> = { data: events, access_token: secret }
  const testCode = cfg.env === "test" ? compact(cfg.testEventCode, 40) : null
  if (testCode) body.test_event_code = testCode

  let status: number
  let json: any
  try {
    const res = await fetchImpl(`${GRAPH}/${version}/${cfg.destination}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    status = res.status
    json = parseJson(await res.text())
  } catch (error) {
    return everyRow(events.length, "transient", redact(describeFailure(error), secret))
  }

  const error: MetaGraphError | null = json?.error && typeof json.error === "object" ? json.error : null
  const cls = classifyMeta({ status, error })
  const traceId = compact(error?.fbtrace_id ?? json?.fbtrace_id, 100) ?? undefined
  if (cls === "ok") {
    const received = typeof json?.events_received === "number" ? json.events_received : events.length
    return everyRow(events.length, "ok", `ok, ${received} received`, traceId)
  }
  const message = redact(metaErrorText(status, error), secret)
  if (cls !== "expired" || events.length === 1) return everyRow(events.length, cls, message, traceId)

  // One event older than 7 days fails the whole request: those rows expire,
  // the rest go back as payload so the outbox resends them without it.
  const cutoff = Math.floor((options.now ?? Date.now()) / 1000) - SEVEN_DAYS_S
  return events.map((event, index) => {
    const old = !(typeof event?.event_time === "number" && event.event_time >= cutoff)
    const row: SendResult = { index, cls: old ? "expired" : "payload", message: old ? message : redact(`not sent: ${message}`, secret) }
    if (traceId) row.traceId = traceId
    return row
  })
}
