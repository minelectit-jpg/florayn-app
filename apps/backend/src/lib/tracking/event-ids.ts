/**
 * Event ids. Every copy of one event (browser pixel, Meta CAPI, TikTok API,
 * dashboard hit) carries the same id so each platform can deduplicate it.
 *
 * Server ids are built from the order's display_id, never the raw order id:
 * `/order/<order.id>/` is a guest access capability and must not reach an ad
 * platform (TRACKING.md C1). The `fl-` prefix also keeps them apart from the
 * WooCommerce numeric ids already sent to the same Google conversion action.
 * Browser ids are checked against the shapes the storefront mints (4.1).
 */

export type StatusEventName = "OrderConfirmed" | "Delivered" | "Returned"

const STATUS_PREFIX: Record<StatusEventName, string> = { OrderConfirmed: "oc", Delivered: "dl", Returned: "rt" }
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const INITIATE_CHECKOUT_ID = /^ic-[0-9a-f]{24}$/
const PURCHASE_ID = /^fl-[1-9]\d{0,15}$/
const UUID_EVENTS = new Set(["PageView", "ViewContent", "AddToCart"])

/** The display id as a canonical positive integer string, or null. */
function displayNumber(displayId: unknown): string | null {
  const raw = typeof displayId === "string" ? displayId.trim() : displayId
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null
}

/** The Purchase id, `fl-<display_id>`; also the order_id / transaction_id sent to the platforms. Null for a bad display id. */
export function purchaseEventId(displayId: number | string): string | null {
  const n = displayNumber(displayId)
  return n ? `fl-${n}` : null
}

/** The COD status event id: `oc-fl-N`, `dl-fl-N` or `rt-fl-N`. Null for a bad display id or kind. */
export function statusEventId(kind: StatusEventName, displayId: number | string): string | null {
  const prefix = STATUS_PREFIX[kind]
  const n = displayNumber(displayId)
  return prefix && n ? `${prefix}-fl-${n}` : null
}

/** True for a well-formed `fl-N` id (the only order reference allowed to leave the backend). */
export function isPurchaseEventId(id: unknown): id is string {
  return typeof id === "string" && PURCHASE_ID.test(id)
}

/** True for a well-formed status event id of that kind (`dl-fl-N` for Delivered, ...). */
export function isStatusEventId(kind: StatusEventName, id: unknown): id is string {
  const prefix = STATUS_PREFIX[kind]
  return Boolean(prefix) && typeof id === "string" && id.startsWith(`${prefix}-`) && isPurchaseEventId(id.slice(prefix.length + 1))
}

/**
 * Whether a browser-reported event id has the shape the storefront mints for
 * that event: lowercase uuid v4 for PageView, ViewContent and AddToCart,
 * `ic-` + 24 hex for InitiateCheckout only. Server-only events never pass.
 */
export function isBrowserEventId(name: string, id: unknown): boolean {
  if (typeof id !== "string") return false
  if (UUID_EVENTS.has(name)) return UUID_V4.test(id)
  if (name === "InitiateCheckout") return INITIATE_CHECKOUT_ID.test(id)
  return false
}
