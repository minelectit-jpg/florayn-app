/**
 * TikTok Events API 2.0 (v1.3): the event JSON (TRACKING.md 5.4 and 6.2) and
 * one batch send. Pure apart from the injected fetch.
 *
 * - Only ViewContent, AddToCart, InitiateCheckout and Purchase are built. The
 *   Events API has no web PageView (the pixel's `ttq.page()` covers it), and
 *   custom COD events cannot be optimised on (I26), so those return null.
 * - The token goes in the `Access-Token` header, never the URL or body, and
 *   never into a thrown error or a returned message.
 * - The TEST environment is a separate test pixel; TikTok's v1.3 docs do not
 *   document a test event code for /event/track/, so none is sent.
 * - `ip` is the plain address (a Parameter Builder suffix is cut off);
 *   `ttclid` is sent whole (up to 1,000 characters) or not at all.
 * - Rate limiting comes back as HTTP 401 with code 40100: that is transient,
 *   not a token problem.
 */
import {
  CURRENCY,
  MAX_BATCH_EVENTS,
  SEND_TIMEOUT_MS,
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
  type AdapterConfig,
  type EventInput,
  type ResultClass,
  type SendResult,
} from "./common"

const TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/"
const PIXEL_CODE = /^[A-Z0-9]{16,24}$/
const TIKTOK_EVENTS: ReadonlySet<string> = new Set(["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"])

export type TikTokEvent = {
  event: "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase"
  event_time: number
  event_id: string
  user: Record<string, string>
  properties: Record<string, unknown>
  page?: { url: string }
}

/** One TikTok event, or null for PageView, the COD events and inputs that are not sendable. */
export function buildTikTokEvent(input: EventInput): TikTokEvent | null {
  if (!input || !TIKTOK_EVENTS.has(input.name)) return null
  const head = checkEventInput(input)
  if (!head) return null
  const source = input.user ?? {}
  const user: Record<string, string> = {}
  const externalId = hashOrNull(source.externalId) ?? hashOrNull(source.tiktok?.external_id)
  if (externalId) user.external_id = externalId
  const phone = hashOrNull(source.tiktok?.phone)
  if (phone) user.phone = phone
  const email = hashOrNull(source.tiktok?.email)
  if (email) user.email = email
  const ttclid = compact(source.ttclid, 1000)
  if (ttclid) user.ttclid = ttclid
  const ttp = compact(source.ttp, 200)
  if (ttp) user.ttp = ttp
  const ip = plainIp(source.ip)
  if (ip) user.ip = ip
  const ua = singleLine(source.ua, 1000)
  if (ua) user.user_agent = ua

  const custom = input.custom ?? {}
  const items = cleanItems(custom.items)
  const properties: Record<string, unknown> = { currency: CURRENCY }
  const value = money(custom.value)
  if (value !== null) properties.value = value
  if (items.length) {
    properties.content_type = "product"
    properties.contents = items.map((item) => ({ content_id: item.id, quantity: item.quantity, price: item.price }))
  }
  if (input.name === "InitiateCheckout" || input.name === "Purchase") properties.num_items = itemCount(custom.numItems, items)
  if (input.name === "Purchase") {
    const ref = orderRef(custom.orderId)
    if (ref) properties.order_id = ref
  }

  const event: TikTokEvent = {
    event: input.name as TikTokEvent["event"],
    event_time: head.eventTime,
    event_id: input.eventId,
    user,
    properties,
  }
  const url = eventUrl(input.name, input.url)
  if (url) event.page = { url }
  return event
}

/**
 * The zero-based index of the bad event named in a 40002 message
 * ("data[2]...", "data.2...", "index 2"), or null when there is none or it is
 * outside the batch.
 */
export function tiktokBadIndex(message: unknown, count?: number): number | null {
  if (typeof message !== "string") return null
  const match =
    message.match(/data\s*\[\s*(\d{1,4})\s*\]/i) ??
    message.match(/\bdata\.(\d{1,4})\b/i) ??
    message.match(/\bindex\s*(?:[:=#]|is|of)?\s*(\d{1,4})\b/i)
  if (!match) return null
  const index = Number(match[1])
  return count === undefined || index < count ? index : null
}

/**
 * The result class of one TikTok response (TRACKING.md 6.2), plus the bad
 * row's index for a 40002 when the message names it.
 */
export function classifyTikTok(
  response: { status?: number; code?: number | null; message?: string | null; network?: boolean },
  count?: number
): { cls: ResultClass; index: number | null } {
  if (response.network) return { cls: "transient", index: null }
  const status = response.status ?? 0
  const code = typeof response.code === "number" ? response.code : null
  if (status >= 500) return { cls: "transient", index: null }
  if (code === 40100) return { cls: "transient", index: null }
  if (code === 0 && status >= 200 && status < 300) return { cls: "ok", index: null }
  if (code === 40001 || code === 40104 || status === 401) return { cls: "blocked", index: null }
  if (code === 40002) return { cls: "payload", index: tiktokBadIndex(response.message, count) }
  return { cls: "transient", index: null }
}

/**
 * Send up to 500 built events to one pixel in one request. Resolves with a
 * result per event and never rejects for a vendor or network failure; throws
 * only for a batch over 500 (a caller bug).
 */
export async function sendTikTokBatch(fetchImpl: typeof fetch, cfg: AdapterConfig, events: readonly TikTokEvent[]): Promise<SendResult[]> {
  if (events.length > MAX_BATCH_EVENTS) {
    throw new TrackingAdapterError(`A TikTok request takes at most ${MAX_BATCH_EVENTS} events; got ${events.length}.`)
  }
  if (!events.length) return []
  const secret = typeof cfg.token === "string" ? cfg.token.trim() : ""
  if (!secret) return everyRow(events.length, "blocked", "no token")
  if (!PIXEL_CODE.test(cfg.destination ?? "")) return everyRow(events.length, "blocked", "no valid pixel code")

  let status: number
  let json: any
  try {
    const res = await fetchImpl(TRACK_URL, {
      method: "POST",
      headers: { "Access-Token": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ event_source: "web", event_source_id: cfg.destination, data: events }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    status = res.status
    json = parseJson(await res.text())
  } catch (error) {
    return everyRow(events.length, "transient", redact(describeFailure(error), secret))
  }

  const code = typeof json?.code === "number" ? json.code : null
  const vendorMessage = typeof json?.message === "string" ? json.message : ""
  const { cls, index } = classifyTikTok({ status, code, message: vendorMessage }, events.length)
  const traceId = compact(json?.request_id, 100) ?? undefined
  if (cls === "ok") return everyRow(events.length, "ok", "ok", traceId)
  const message = redact(`HTTP ${status} code ${code ?? "?"}: ${vendorMessage || "no message"}`, secret)
  if (cls !== "payload" || index === null) return everyRow(events.length, cls, message, traceId)

  // TikTok rejects the whole request and names the first bad event: only that
  // row is payload; the others were not accepted either and go back for a resend.
  return events.map((_, i) => {
    const row: SendResult =
      i === index ? { index: i, cls: "payload", message } : { index: i, cls: "transient", message: redact(`not sent: row ${index} was invalid`, secret) }
    if (traceId) row.traceId = traceId
    return row
  })
}
