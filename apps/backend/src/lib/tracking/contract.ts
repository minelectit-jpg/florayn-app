/**
 * The backend copy of the tracking contract (TRACKING.md 4.1, 4.3, 4.4): the
 * private-path rule, the recorded-path and landing allowlists, the browser
 * event validator, and the parsers for the checkout tracking header and the
 * ingest envelope. The storefront keeps its own copy in
 * apps/storefront/src/lib/tracking/{paths,contract}.ts; both are tested
 * against the same Appendix C vectors (tests/fixtures/tracking-vectors.json),
 * so a change here must be made there too. Pure: no imports at runtime.
 */

// ---------------------------------------------------------------- paths

export const PRIVATE_SEGMENTS: readonly string[] = ["order", "review", "account"]
export const PATH_PARAMS = ["case", "device", "variant"] as const
export const LANDING_PARAMS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign"] as const
export const CLICK_KEYS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid"] as const

export function pathnameOf(p: string): string {
  return p.split(/[?#]/)[0]
}

/** /order, /review and /account pages, also under one /men (invariant 4). */
export function isPrivatePath(pathname: string): boolean {
  let path = pathnameOf(String(pathname))
  if (path === "/men" || path.startsWith("/men/")) path = path.slice(4)
  return PRIVATE_SEGMENTS.includes(path.split("/").filter(Boolean)[0])
}

function pick(search: string, keys: readonly string[], max: number): URLSearchParams {
  const from = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const key of keys) {
    const value = from.get(key)
    if (value !== null && value.length <= max) kept.set(key, value)
  }
  return kept
}

/** The pathname with only case/device/variant (values up to 80 chars), at most 300 chars. */
export function safePath(pathname: string, search = ""): string {
  const query = pick(search, PATH_PARAMS, 80).toString()
  const path = query ? `${pathname}?${query}` : pathname
  return path.length <= 300 ? path : pathname.slice(0, 300)
}

/** The landing's click ids and utm tags only; a value over 1000 chars is left out, never cut. */
export function landingParams(search: string): Record<string, string> {
  return Object.fromEntries(pick(search, LANDING_PARAMS, 1000))
}

// ---------------------------------------------------------------- events

export type BrowserEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout"
export type EventItem = { id: string; q: number; price: number }
export type BrowserEvent = { n: BrowserEventName; id: string; t: number; p: string; d?: Record<string, unknown> }

/** The only events a browser may report; Purchase and the COD events come from the backend. */
export const BROWSER_EVENTS: readonly BrowserEventName[] = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout"]

export const EVENT_LIMITS = {
  maxEventsPerBatch: 25,
  maxItems: 50,
  maxQty: 99,
  maxAmount: 1000000,
  maxString: 120,
  maxPath: 300,
} as const

/** One ingest request (4.3): the forwarder splits anything larger. */
export const INGEST_LIMITS = { maxEvents: 200, maxStats: 50 } as const

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CHECKOUT_ID = /^ic-[0-9a-f]{24}$/
const VARIANT_ID = /^variant_[A-Za-z0-9]{10,40}$/
/** A root-relative path of printable ASCII: no "//" (another host), no hash, no backslash. */
const PLAIN_PATH = /^\/(?!\/)[!-~]*$/

type Row = Record<string, unknown>
type Check = (value: unknown) => boolean

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= EVENT_LIMITS.maxAmount
}

function isQuantity(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= EVENT_LIMITS.maxQty
}

const isFlag: Check = (value) => typeof value === "boolean"
const isLabel: Check = (value) => typeof value === "string" && value.length <= EVENT_LIMITS.maxString
const isItemCount: Check = (value) => Number.isInteger(value) && (value as number) >= 1
  && (value as number) <= EVENT_LIMITS.maxItems * EVENT_LIMITS.maxQty

/** Optional `d` keys per event (items, value and currency are checked on their own). Others are dropped. */
const LABELS: Record<string, Check> = { handle: isLabel, device: isLabel, case_type: isLabel }
const OPTIONAL_KEYS: Record<BrowserEventName, Record<string, Check>> = {
  PageView: { first: isFlag },
  ViewContent: { ...LABELS, primary: isFlag },
  AddToCart: LABELS,
  InitiateCheckout: { ...LABELS, num_items: isItemCount },
}

/** uuid v4 (lower case) for PageView, ViewContent and AddToCart; `ic-` + 24 hex for InitiateCheckout only. */
export function isBrowserEventId(name: unknown, id: unknown): boolean {
  if (typeof id !== "string") return false
  if (name === "InitiateCheckout") return CHECKOUT_ID.test(id)
  return (name === "PageView" || name === "ViewContent" || name === "AddToCart") && UUID_V4.test(id)
}

export function isVariantId(id: unknown): id is string {
  return typeof id === "string" && VARIANT_ID.test(id)
}

/** A recorded path: absolute, public, at most 300 chars and already in safePath form. */
function isEventPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length > EVENT_LIMITS.maxPath || !PLAIN_PATH.test(p) || /[#\\]/.test(p)) return false
  const at = p.indexOf("?")
  const pathname = at < 0 ? p : p.slice(0, at)
  return !isPrivatePath(pathname) && safePath(pathname, at < 0 ? "" : p.slice(at)) === p
}

function readItems(raw: unknown): EventItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > EVENT_LIMITS.maxItems) return null
  const items: EventItem[] = []
  for (const item of raw) {
    if (!isRow(item) || !isVariantId(item.id) || !isQuantity(item.q) || !isAmount(item.price)) return null
    items.push({ id: item.id, q: item.q, price: item.price })
  }
  return items
}

/**
 * The event with only the fields the contract allows, or null when its shape
 * is wrong. Shape only: the ingest route checks the time window. Unknown `d`
 * keys are dropped and so are optional keys sent as null; a known key with the
 * wrong type or a string over 120 chars rejects the event.
 */
export function validateEvent(raw: unknown): BrowserEvent | null {
  if (!isRow(raw)) return null
  const { n, id, t, p } = raw
  if (!BROWSER_EVENTS.includes(n as BrowserEventName) || !isBrowserEventId(n, id)) return null
  if (!Number.isSafeInteger(t) || (t as number) <= 0 || !isEventPath(p)) return null
  const name = n as BrowserEventName
  const input = raw.d === undefined ? {} : raw.d
  if (!isRow(input)) return null
  const d: Row = {}
  if (name !== "PageView") {
    const items = readItems(input.items)
    if (!items || input.currency !== "BDT" || !isAmount(input.value)) return null
    d.items = items
    d.value = input.value
    d.currency = "BDT"
  }
  for (const [key, check] of Object.entries(OPTIONAL_KEYS[name])) {
    const value = input[key]
    if (value === undefined || value === null) continue
    if (!check(value)) return null
    d[key] = value
  }
  const event: BrowserEvent = { n: name, id: id as string, t: t as number, p }
  if (Object.keys(d).length) event.d = d
  return event
}

// ---------------------------------------------------------------- checkout context (4.4)

export type DeviceClass = "mobile" | "tablet" | "desktop"
export type Audience = "women" | "men"

/**
 * The `x-florayn-tracking` header after parsing, and the `ctx` of an ingest
 * batch. Every key is always present (null or false when missing), so it can
 * be stored as tracking_order_context.context as is. It carries no names,
 * phones or emails.
 */
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
  audience: Audience | null
  new: boolean
  staff: boolean
  optout: boolean
  consent_version: number | null
}

type TextKey = "host" | "page_url" | "ip" | "ua" | "vid" | "sid" | "src" | "camp" | "fbp" | "fbc"
  | "ttp" | "ttclid" | "gclid" | "gbraid" | "wbraid"

/** Length caps (4.4). A longer value is dropped, never cut: a cut click id is a wrong one. */
export const CONTEXT_CAPS: Record<TextKey, number> = {
  host: 100, page_url: 200, ip: 45, ua: 400, vid: 40, sid: 40, src: 40, camp: 80,
  fbp: 120, fbc: 600, ttp: 100, ttclid: 1000, gclid: 300, gbraid: 300, wbraid: 300,
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const IP_CHARS = /^[0-9A-Fa-f:.]+$/

function capped(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value || value.length > max || CONTROL_CHARS.test(value)) return null
  return value
}

/**
 * The context with the 4.4 keys and caps, unknown keys dropped; null for a
 * value that is not an object or declares another version. Never throws.
 */
export function parseCheckoutContext(raw: unknown): CheckoutTrackingContext | null {
  if (!isRow(raw)) return null
  if (raw.v !== undefined && raw.v !== 1) return null
  const text = {} as Record<TextKey, string | null>
  for (const [key, max] of Object.entries(CONTEXT_CAPS) as [TextKey, number][]) text[key] = capped(raw[key], max)
  if (text.ip && !IP_CHARS.test(text.ip)) text.ip = null
  if (text.host) text.host = text.host.toLowerCase()
  const country = typeof raw.country === "string" && /^[A-Z]{2}$/.test(raw.country) ? raw.country : null
  const device = raw.device === "mobile" || raw.device === "tablet" || raw.device === "desktop" ? raw.device : null
  const audience = raw.audience === "women" || raw.audience === "men" ? raw.audience : null
  const version = raw.consent_version
  const consentVersion = Number.isSafeInteger(version) && (version as number) >= 1 && (version as number) <= 1_000_000
    ? version as number : null
  return {
    v: 1,
    ...text,
    edge: raw.edge === true,
    country,
    device,
    audience,
    new: raw.new === true,
    staff: raw.staff === true,
    optout: raw.optout === true,
    consent_version: consentVersion,
  }
}

// ---------------------------------------------------------------- ingest envelope (4.3)

export type IngestBatch = {
  host: string
  ctx: CheckoutTrackingContext
  /** Raw events: the ingest route runs validateEvent on each and counts the invalid ones. */
  events: unknown[]
}
export type IngestEnvelope = { v: 1; stats: Record<string, number>; batches: IngestBatch[] }

const STAT_KEY = /^[a-z0-9_.:-]{1,60}$/

/**
 * The storefront-to-backend envelope `{ v: 1, stats?, batches: [{ host, ctx,
 * events }] }`, or null when its shape is wrong (the route answers 400). At
 * most 200 events across all batches; stats are counter deltas (non-negative
 * integers). Events are left raw for validateEvent. Never throws.
 */
export function parseIngestEnvelope(raw: unknown): IngestEnvelope | null {
  if (!isRow(raw) || raw.v !== 1) return null
  const stats: Record<string, number> = {}
  if (raw.stats !== undefined) {
    if (!isRow(raw.stats)) return null
    const entries = Object.entries(raw.stats)
    if (entries.length > INGEST_LIMITS.maxStats) return null
    for (const [key, value] of entries) {
      if (!STAT_KEY.test(key) || !Number.isSafeInteger(value) || (value as number) < 0) return null
      stats[key] = value as number
    }
  }
  if (!Array.isArray(raw.batches)) return null
  const batches: IngestBatch[] = []
  let total = 0
  for (const batch of raw.batches) {
    if (!isRow(batch) || !Array.isArray(batch.events)) return null
    const host = capped(batch.host, CONTEXT_CAPS.host)
    const ctx = parseCheckoutContext(batch.ctx)
    if (!host || !ctx) return null
    total += batch.events.length
    if (total > INGEST_LIMITS.maxEvents) return null
    batches.push({ host: host.toLowerCase(), ctx, events: batch.events })
  }
  return { v: 1, stats, batches }
}
