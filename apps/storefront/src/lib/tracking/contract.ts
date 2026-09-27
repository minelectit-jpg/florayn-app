/**
 * The storefront's one tracking contract (TRACKING.md 4.1): the types the stub,
 * the lazy chunks, the /api/t/* routes and checkout share, the URL parts
 * tracking keeps (safePath, landingParams and their allowlists), and the pure
 * validators the server routes and checkout run. Client code in the layout
 * chunk (queue, stub) imports only TYPES from here; only the lazy chunks
 * (boot.ts, batch.ts) import values, the URL helpers, and the production
 * build drops the validators from them. The backend keeps its own copy of
 * the validators in apps/backend/src/lib/tracking/contract.ts; both are
 * tested against the same Appendix C vectors.
 */
import { isPrivatePath } from "./paths"

export * from "./paths"

export const PATH_PARAMS = ["case", "device", "variant"] as const
export const CLICK_KEYS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid"] as const
export const LANDING_PARAMS = [...CLICK_KEYS, "utm_source", "utm_medium", "utm_campaign"] as const

function pick(search: string, keys: readonly string[], max: number): URLSearchParams {
  const from = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const key of keys) {
    const value = from.get(key)
    if (value !== null && value.length <= max) kept.set(key, value)
  }
  return kept
}

/** The pathname plus only case/device/variant, <= 300 chars. */
export function safePath(pathname: string, search = ""): string {
  const query = pick(search, PATH_PARAMS, 80).toString()
  const path = query ? `${pathname}?${query}` : pathname
  return path.length <= 300 ? path : pathname.slice(0, 300)
}

export function landingParams(search: string): Record<string, string> {
  return Object.fromEntries(pick(search, LANDING_PARAMS, 1000))
}

export type BrowserEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout"
export type EventItem = { id: string; q: number; price: number }
export type BrowserEvent = { n: BrowserEventName; id: string; t: number; p: string; d?: Record<string, unknown> }
export type EventBatch = { v: 1; rv?: string; sent_at: number; events: BrowserEvent[] }

export type LandingSnapshot = { q: Record<string, string>; ref: string | null; path: string }
export type IdRequest = { v: 1; landing: LandingSnapshot | null }
export type ClickKey = "fbclid" | "ttclid" | "gclid" | "gbraid" | "wbraid"
export type IdResponse = {
  v: 1
  on: boolean                       // false: tracking inert for this browser (no edge, unknown host, optout)
  env: "test" | "live" | null
  ext: string | null                // sha256 hex of _fl_vid (external_id)
  sid: string | null
  src: string | null                // session source class (section 6.7)
  staff: boolean
  optout: boolean
  share: boolean                    // privacy.share_contact_hashes
  consent_version: number
  landing: { url: string | null; click: ClickKey | null; src: string | null } | null
  meta: { id: string; load: boolean } | null
  tiktok: { id: string; load: boolean } | null
  google: { id: string; label: string; load: boolean } | null
}

export type PurchaseBlock = {
  event_id: string                  // fl-<display_id>
  value: number                     // order total incl. delivery, BDT major units
  currency: "BDT"
  num_items: number
  contents: { id: string; quantity: number; item_price: number }[]
  platforms: { meta: boolean; tiktok: boolean; google: boolean }
  match: {
    meta?: Record<string, string>   // share OFF: { external_id } only
    tiktok?: Record<string, string> // share OFF: { external_id } only
    google?: { sha256_phone_number?: string; sha256_email_address?: string;
               address?: { sha256_first_name?: string; sha256_last_name?: string; country: "BD" } }
  }
}

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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CHECKOUT_ID = /^ic-[0-9a-f]{24}$/
const VARIANT_ID = /^variant_[A-Za-z0-9]{10,40}$/
const PURCHASE_ID = /^fl-\d+$/
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
 * is wrong. Shape only: time windows and clock fixes are the endpoints' job.
 * Unknown `d` keys are dropped and so are optional keys sent as null; a known
 * key with the wrong type or a string over 120 chars rejects the event.
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

function isTextRecord(value: unknown): value is Record<string, string> {
  return isRow(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function isGoogleMatch(value: unknown): boolean {
  if (!isRow(value)) return false
  return Object.entries(value).every(([key, entry]) => key === "address"
    ? isTextRecord(entry) && entry.country === "BD"
    : typeof entry === "string")
}

function isNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isPurchaseLine(value: unknown): boolean {
  return isRow(value) && isVariantId(value.id) && Number.isInteger(value.quantity) && (value.quantity as number) >= 1
    && typeof value.item_price === "number" && Number.isFinite(value.item_price)
}

/** A strict check of the checkout response's `tracking` block; a malformed block is ignored by the caller. */
export function isPurchaseBlock(value: unknown): value is PurchaseBlock {
  if (!isRow(value) || typeof value.event_id !== "string" || !PURCHASE_ID.test(value.event_id)) return false
  if (value.currency !== "BDT" || !isNonNegative(value.value) || !isNonNegative(value.num_items)) return false
  if (!Array.isArray(value.contents) || !value.contents.every(isPurchaseLine)) return false
  const { platforms, match } = value
  if (!isRow(platforms) || !["meta", "tiktok", "google"].every((key) => typeof platforms[key] === "boolean")) return false
  if (!isRow(match)) return false
  if (match.meta !== undefined && !isTextRecord(match.meta)) return false
  if (match.tiktok !== undefined && !isTextRecord(match.tiktok)) return false
  return match.google === undefined || isGoogleMatch(match.google)
}

/** The answer that keeps a browser untracked: no cookies were set and no vendor may load. */
export function inertIdResponse(consentVersion = 1): IdResponse {
  return {
    v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false, optout: false, share: false,
    consent_version: consentVersion, landing: null, meta: null, tiktok: null, google: null,
  }
}
