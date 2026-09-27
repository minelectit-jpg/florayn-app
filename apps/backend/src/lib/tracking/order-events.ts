import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { EventInput } from "./adapters/common"
import { buildMetaEvent } from "./adapters/meta"
import { buildTikTokEvent } from "./adapters/tiktok"
import { isVariantId, parseCheckoutContext, type CheckoutTrackingContext } from "./contract"
import { insertOutbox, trackingDb, type OrderContextRow, type OutboxInsert } from "./db"
import { purchaseEventId, statusEventId } from "./event-ids"
import { sha256Hex } from "./hash"
import { buildMatchKeys, type GoogleMatch } from "./match-keys"
import type { Env, TrackingConfig, TrackingSettingsView } from "./settings"

/**
 * The server copies of the order events (TRACKING.md 6.1, 6.5): Purchase at
 * checkout and reconcile (WP05), and the COD status events OrderConfirmed,
 * Delivered and Returned (WP06, which reuses this file unchanged). One
 * implementation decides, from the saved order and the checkout context stored
 * for it, which outbox rows exist and in which state, and what the browser's
 * Purchase block holds, so every caller gives the same answer on every retry.
 *
 * Nothing here reads cart or order metadata for tracking (C4): the context
 * comes from tracking_order_context. Names, phone, district and email are read
 * from the saved order only to hash them, and only while
 * `share_contact_hashes` is on AND that order's shopper was shown the consent
 * line (sharesContact). The raw order id stays in the outbox's internal
 * `order_id` column; the platforms only ever see `fl-N`.
 *
 * Raw SQL through the PG_CONNECTION knex is the documented exception of
 * lib/tracking/db.ts (tracking tables and the order_op lookups need
 * ON CONFLICT and plain id lists). Every statement uses bindings.
 */

export type OrderEventKind = "Purchase" | "OrderConfirmed" | "Delivered" | "Returned"
export type OrderEventSource = "checkout" | "reconcile" | "status"

export type OrderEventItem = { variant_id: string | null; quantity: number; unit_price: number; title: string | null }

export type OrderForEvents = {
  id: string
  display_id: number
  created_at: Date
  /** The order total including delivery, BDT major units (owner decision 7). */
  total: number
  currency_code: string
  email: string | null
  is_draft_order: boolean
  items: OrderEventItem[]
  shipping_address: { first_name: string | null; last_name: string | null; phone: string | null; province: string | null } | null
  metadata: Record<string, unknown> | null
}

/** The `tracking` block of a placed order's /store/checkout response (TRACKING.md 4.1, 4.4). */
export type PurchaseBlock = {
  event_id: string
  value: number
  currency: "BDT"
  num_items: number
  contents: { id: string; quantity: number; item_price: number }[]
  platforms: { meta: boolean; tiktok: boolean; google: boolean }
  match: { meta?: Record<string, string>; tiktok?: Record<string, string>; google?: GoogleMatch }
}

export type OrderEventRowsInput = {
  kind: OrderEventKind
  order: OrderForEvents
  ctx: OrderContextRow
  settings: TrackingSettingsView
  /** When the event happened: the status change for the COD events. Purchase always uses order.created_at. */
  at: Date
  source: OrderEventSource
}

type ServerPlatform = "meta" | "tiktok"
type Db = Knex | Knex.Transaction

/** The query.graph fields loadOrdersForEvents reads (no payment, no customer object). */
export const ORDER_EVENT_FIELDS = [
  "id", "display_id", "created_at", "total", "currency_code", "email", "is_draft_order", "metadata",
  "items.variant_id", "items.quantity", "items.unit_price", "items.title",
  "shipping_address.first_name", "shipping_address.last_name", "shipping_address.phone", "shipping_address.province",
]

/** COD status events go to Meta only (TikTok has no use for them, I26). */
const PLATFORMS_FOR: Record<OrderEventKind, readonly ServerPlatform[]> = {
  Purchase: ["meta", "tiktok"],
  OrderConfirmed: ["meta"],
  Delivered: ["meta"],
  Returned: ["meta"],
}
const LABEL: Record<ServerPlatform, string> = { meta: "Meta", tiktok: "TikTok" }
const GRAPH_CHUNK = 100
const SQL_CHUNK = 500
const CONTEXT_COLUMNS = "order_id, display_id, cart_id, host, env, context, trusted, staff, optout, purchase_time"

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function uniqueIds(ids: unknown[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))]
}

function marks(values: unknown[]): string {
  return values.map(() => "?").join(", ")
}

/** A Medusa amount (number, numeric string or BigNumber-like) as a number, or NaN. */
function amount(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return value.trim() ? Number(value) : NaN
  if (value && typeof value === "object") {
    const raw = value as { numeric?: unknown; value?: unknown; valueOf?: () => unknown }
    if (raw.numeric !== undefined) return amount(raw.numeric)
    if (raw.value !== undefined) return amount(raw.value)
    const primitive = typeof raw.valueOf === "function" ? raw.valueOf() : NaN
    return typeof primitive === "number" || typeof primitive === "string" ? amount(primitive) : NaN
  }
  return NaN
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function isDateLike(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === "[object Date]"
}

function asDate(value: unknown): Date {
  if (isDateLike(value)) return new Date(value.getTime())
  return new Date(typeof value === "string" || typeof value === "number" ? value : NaN)
}

function isValidDate(value: unknown): value is Date {
  return isDateLike(value) && Number.isFinite(value.getTime())
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return null
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** One query.graph order in the shape the builders read. Amounts are coerced with Number(). */
export function toOrderForEvents(raw: any): OrderForEvents | null {
  if (!raw || typeof raw.id !== "string") return null
  const address = raw.shipping_address && typeof raw.shipping_address === "object" ? raw.shipping_address : null
  return {
    id: raw.id,
    display_id: Number(raw.display_id),
    created_at: asDate(raw.created_at),
    total: amount(raw.total),
    currency_code: typeof raw.currency_code === "string" ? raw.currency_code : "",
    email: text(raw.email),
    is_draft_order: raw.is_draft_order === true,
    items: (Array.isArray(raw.items) ? raw.items : []).filter(Boolean).map((item: any) => ({
      variant_id: text(item.variant_id),
      quantity: amount(item.quantity),
      unit_price: amount(item.unit_price),
      title: text(item.title),
    })),
    shipping_address: address ? {
      first_name: text(address.first_name),
      last_name: text(address.last_name),
      phone: text(address.phone),
      province: text(address.province),
    } : null,
    metadata: asObject(raw.metadata),
  }
}

/** The saved orders by id (query.graph, 100 ids per call). Unknown ids are absent. */
export async function loadOrdersForEvents(container: any, orderIds: string[]): Promise<Map<string, OrderForEvents>> {
  const orders = new Map<string, OrderForEvents>()
  const ids = uniqueIds(orderIds)
  if (!ids.length) return orders
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  for (const part of chunks(ids, GRAPH_CHUNK)) {
    const { data } = await query.graph({ entity: "order", fields: ORDER_EVENT_FIELDS, filters: { id: part } })
    for (const raw of data ?? []) {
      const order = toOrderForEvents(raw)
      if (order) orders.set(order.id, order)
    }
  }
  return orders
}

/**
 * The orders imported from florayn.com (order_op.source set), which never
 * produce events (invariant 7). lib/order-ops.ts is not changed for this.
 */
export async function importedOrderIds(container: any, orderIds: string[]): Promise<Set<string>> {
  const imported = new Set<string>()
  const ids = uniqueIds(orderIds)
  if (!ids.length) return imported
  const db = trackingDb(container)
  for (const part of chunks(ids, SQL_CHUNK)) {
    const result: any = await db.raw(
      `select order_id from order_op where order_id in (${marks(part)}) and source is not null and source <> '' and deleted_at is null`,
      part
    )
    for (const row of result?.rows ?? []) imported.add(String(row.order_id))
  }
  return imported
}

function toEnv(value: unknown): Env | null {
  return value === "test" || value === "live" ? value : null
}

function toContextRow(raw: any): OrderContextRow {
  const context = parseCheckoutContext(asObject(raw.context)) ?? (parseCheckoutContext({}) as CheckoutTrackingContext)
  return {
    order_id: String(raw.order_id),
    display_id: Number(raw.display_id),
    cart_id: text(raw.cart_id),
    host: typeof raw.host === "string" ? raw.host : "",
    env: toEnv(raw.env),
    context,
    trusted: raw.trusted === true,
    staff: raw.staff === true,
    optout: raw.optout === true,
    purchase_time: asDate(raw.purchase_time),
  }
}

/** The stored checkout contexts by order id. Takes the caller's transaction so a retry reads the row it just kept. */
export async function loadOrderContexts(db: Db, orderIds: string[]): Promise<Map<string, OrderContextRow>> {
  const contexts = new Map<string, OrderContextRow>()
  const ids = uniqueIds(orderIds)
  for (const part of chunks(ids, SQL_CHUNK)) {
    const result: any = await db.raw(
      `select ${CONTEXT_COLUMNS} from tracking_order_context where order_id in (${marks(part)})`,
      part
    )
    for (const raw of result?.rows ?? []) {
      const row = toContextRow(raw)
      contexts.set(row.order_id, row)
    }
  }
  return contexts
}

/** Trusted (edge check passed on an allowlisted host), not staff, not opted out. */
function sendable(ctx: OrderContextRow): boolean {
  return ctx.trusted === true && ctx.staff !== true && ctx.optout !== true && ctx.env !== null
}

/**
 * Whether this order's contact details may be hashed (C7): sharing is on now
 * AND its shopper was shown the consent line at checkout. The storefront sends
 * `consent_version` only when the line rendered, so an order placed while
 * sharing was off keeps its status events and reconciled Purchase free of
 * contact hashes after sharing is turned on.
 */
function sharesContact(config: TrackingConfig, ctx: OrderContextRow): boolean {
  return config.privacy.share_contact_hashes === true && ctx.context.consent_version != null
}

/**
 * The dataset id or pixel code for the context's stored environment, or ""
 * when none is configured. Deliberately not gated on `enabled`: a platform
 * that is off still gets its destination on the skipped row, so "Send
 * skipped" can deliver it later (I3). The env was fixed at checkout, so a
 * later COD event goes to the same dataset as its Purchase.
 */
function destinationId(config: TrackingConfig, env: Env, platform: ServerPlatform): string {
  const settings = config[platform]
  return (env === "live" ? settings.live_id : settings.test_id) || ""
}

function orderItems(order: OrderForEvents): { id: string; quantity: number; price: number }[] {
  return order.items
    .filter((item) => isVariantId(item.variant_id) && Number.isInteger(item.quantity) && item.quantity >= 1
      && Number.isFinite(item.unit_price) && item.unit_price >= 0)
    .map((item) => ({ id: item.variant_id as string, quantity: item.quantity, price: item.unit_price }))
}

/** Every unit in the order, lines without a variant id included. */
function unitCount(order: OrderForEvents): number {
  return order.items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0)
}

function orderTotal(order: OrderForEvents): number {
  return Number.isFinite(order.total) && order.total >= 0 ? order.total : 0
}

function eventInput(kind: OrderEventKind, eventId: string, time: Date, order: OrderForEvents, ctx: OrderContextRow, share: boolean): EventInput {
  const context = ctx.context
  const keys = buildMatchKeys({ order, visitorId: context.vid, share })
  const orderId = purchaseEventId(order.display_id) as string
  const input: EventInput = {
    name: kind,
    eventId,
    time,
    // Purchase always reports the checkout page, never /order/<id>/ (C1).
    url: ctx.host ? `https://${ctx.host}/checkout/` : null,
    actionSource: kind === "Purchase" ? "website" : "system_generated",
    user: {
      ip: context.ip,
      ua: context.ua,
      fbp: context.fbp,
      fbc: context.fbc,
      externalId: sha256Hex(context.vid),
      country: context.country,
      ttclid: context.ttclid,
      ttp: context.ttp,
      meta: keys.metaCapi,
      tiktok: keys.tiktokApi,
    },
    custom: { items: orderItems(order), value: orderTotal(order), numItems: unitCount(order), orderId },
  }
  if (kind !== "Purchase") {
    input.original = { eventName: "Purchase", time: isValidDate(ctx.purchase_time) ? ctx.purchase_time : order.created_at, orderId, eventId: orderId }
  }
  return input
}

/** Why a row is deliberately not sent (6.1), or null when it may be. */
function skipReason(kind: OrderEventKind, config: TrackingConfig, platform: ServerPlatform): string | null {
  if (!config[platform].enabled) return `skipped: ${LABEL[platform]} is off`
  if (kind !== "Purchase" && config.meta.status_events[kind] !== true) return `skipped: ${kind} events are off`
  return null
}

/**
 * The outbox rows for one order event (TRACKING.md 6.1 table). Pure.
 * - untrusted, staff or opted-out context, or a host that was not allowlisted: none
 * - platform off, COD toggle off, or no dataset/pixel id: `skipped` (payload
 *   kept when an id existed, else payload null and destination "")
 * - no token for (platform, env): `blocked` with last_error "no token"
 * - otherwise `pending`
 * Purchase goes to Meta and TikTok with event_time = order.created_at; the COD
 * events go to Meta only, `system_generated`, with event_time = `at`. A Meta
 * Purchase without a user agent (the header shed it to fit 4 KB) is kept as
 * `skipped`: Meta refuses website events without one.
 */
export function buildOrderEventRows(input: OrderEventRowsInput): OutboxInsert[] {
  const { kind, order, ctx, settings, source } = input
  if (!ctx || !order || !sendable(ctx)) return []
  const env = ctx.env as Env
  const eventId = kind === "Purchase" ? purchaseEventId(order.display_id) : statusEventId(kind, order.display_id)
  const time = kind === "Purchase" ? order.created_at : input.at
  if (!eventId || !purchaseEventId(order.display_id) || !isValidDate(time)) return []
  const config = settings.config
  const event = eventInput(kind, eventId, time, order, ctx, sharesContact(config, ctx))
  const rows: OutboxInsert[] = []
  for (const platform of PLATFORMS_FOR[kind] ?? []) {
    const base = { platform, env, event_name: kind, event_id: eventId, event_time: time, source, order_id: order.id }
    const destination = destinationId(config, env, platform)
    const off = skipReason(kind, config, platform)
    if (!destination) {
      rows.push({ ...base, destination: "", payload: null, status: "skipped", last_error: off ?? `skipped: no ${LABEL[platform]} ${env} id` })
      continue
    }
    const payload = platform === "meta" ? buildMetaEvent(event) : buildTikTokEvent(event)
    let reason = off
    if (!reason && !payload) reason = "skipped: the event could not be built"
    if (!reason && platform === "meta" && event.actionSource === "website" && !ctx.context.ua) reason = "skipped: no user agent"
    if (reason) rows.push({ ...base, destination, payload, status: "skipped", last_error: reason })
    else if (!settings.tokenSet[platform][env]) rows.push({ ...base, destination, payload, status: "blocked", last_error: "no token" })
    else rows.push({ ...base, destination, payload, status: "pending", last_error: null })
  }
  return rows
}

/**
 * The browser's Purchase block (4.1, 4.4). Pure. `event_id` is `fl-<display_id>`
 * on every retry; `value` is the order total including delivery. Contents
 * keep only lines with a variant id (one bad line would make the storefront
 * drop the whole block). A platform is true only for a trusted, non-staff,
 * non-opted-out context whose platform has an id for its environment (Google:
 * live only). Match data exists only for a platform that is true, and follows
 * the share rule: `{ external_id }` only while sharing is off or when this
 * order's shopper was not shown the consent line. Null when the display id is
 * unusable.
 */
export function buildPurchaseBlock(order: OrderForEvents, ctx: OrderContextRow, settings: TrackingSettingsView): PurchaseBlock | null {
  const eventId = purchaseEventId(order.display_id)
  if (!eventId) return null
  const config = settings.config
  const ok = sendable(ctx)
  const env = ctx.env as Env
  const google = config.google
  const platforms = {
    meta: ok && config.meta.enabled && destinationId(config, env, "meta") !== "",
    tiktok: ok && config.tiktok.enabled && destinationId(config, env, "tiktok") !== "",
    google: ok && env === "live" && google.enabled && Boolean(google.conversion_id && google.purchase_label),
  }
  const keys = buildMatchKeys({ order, visitorId: ctx.context.vid, share: sharesContact(config, ctx) })
  const match: PurchaseBlock["match"] = {}
  if (platforms.meta && Object.keys(keys.metaPixel).length) match.meta = keys.metaPixel
  if (platforms.tiktok && Object.keys(keys.tiktokPixel).length) match.tiktok = keys.tiktokPixel
  if (platforms.google && keys.google) match.google = keys.google
  return {
    event_id: eventId,
    value: orderTotal(order),
    currency: "BDT",
    num_items: unitCount(order),
    contents: orderItems(order).map((item) => ({ id: item.id, quantity: item.quantity, item_price: item.price })),
    platforms,
    match,
  }
}

/** Inserts the rows in the caller's transaction; an existing (platform, event_name, event_id) is kept. */
export async function insertOrderEvents(trx: Db, rows: OutboxInsert[]): Promise<number> {
  return insertOutbox(trx, rows)
}
