import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ensureOps } from "../order-ops"
import { parseCheckoutContext, type CheckoutTrackingContext } from "./contract"
import { HIT_FLAGS, insertHits, trackingDb, withTransaction, type HitInsert, type OrderContextRow } from "./db"
import { purchaseEventId } from "./event-ids"
import { kickStaleJobs } from "./jobs"
import {
  buildOrderEventRows,
  buildPurchaseBlock,
  importedOrderIds,
  insertOrderEvents,
  loadOrderContexts,
  loadOrdersForEvents,
  type OrderForEvents,
  type PurchaseBlock,
} from "./order-events"
import { scheduleFlush } from "./outbox"
import { hostRole, loadTrackingSettings, normHost, type TrackingConfig } from "./settings"

/**
 * Purchase capture (TRACKING.md 6.5, 6.6, B2). The checkout stashes the
 * shopper's tracking context by cart before placing the order; once the order
 * exists, ONE transaction stores the order's context (first write wins), its
 * dashboard hit and its Purchase outbox rows, each idempotent by key, so a
 * retry, a concurrent submit or the reconcile job can never add a second
 * Purchase or leave half of one. Every five minutes reconcilePurchases()
 * repairs what a crash or a lost request left behind.
 *
 * The checkout must never fail or slow down because of tracking: the two
 * checkout helpers never throw, wait at most a short budget (the work then
 * finishes in the background, and reconcile covers a failure), and log one
 * short line without request bodies or customer data.
 *
 * Raw SQL through the PG_CONNECTION knex is the documented exception of
 * lib/tracking/db.ts. Every statement uses bindings.
 */

export type PurchaseSource = "checkout" | "reconcile"
export type RecordPurchaseInput = { orderId: string; cartId?: string | null; ctx?: CheckoutTrackingContext | null; source: PurchaseSource }
export type CheckoutTrackingInput = { body: unknown; complete: boolean; tracking?: CheckoutTrackingContext | null }
export type ReconcileStats = { carts: number; recorded: number; ops_created: number; rows_added: number }

const CART_ID = /^cart_[A-Za-z0-9]+$/
const STASH_BUDGET_MS = 1_000
const RECORD_BUDGET_MS = 3_000
const RECONCILE_LIMIT = 500
const GRAPH_CHUNK = 100
const SQL_CHUNK = 500
const DAY_MS = 86_400_000
/** Keys that identify a browser or a click; an opted-out shopper's stored context keeps none of them. */
const IDENTIFYING_KEYS = ["ip", "ua", "vid", "sid", "fbp", "fbc", "ttp", "ttclid", "gclid", "gbraid", "wbraid"] as const

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function marks(values: unknown[]): string {
  return values.map(() => "?").join(", ")
}

function cartIdOf(body: unknown): string | null {
  const id = body && typeof body === "object" ? (body as { cart_id?: unknown }).cart_id : null
  return typeof id === "string" && CART_ID.test(id) ? id : null
}

/** What is stored for a context: everything for a normal shopper, only flags and coarse facts after an opt-out. */
function storable(ctx: CheckoutTrackingContext): CheckoutTrackingContext {
  if (!ctx.optout) return ctx
  const stripped = { ...ctx }
  for (const key of IDENTIFYING_KEYS) stripped[key] = null
  return stripped
}

// ---------------------------------------------------------------- cart context

/** Keeps the latest checkout context for a cart (upsert), so reconcile can record a Purchase the checkout missed. */
export async function stashCartContext(container: any, cartId: string, ctx: CheckoutTrackingContext): Promise<void> {
  await trackingDb(container).raw(
    `insert into tracking_cart_context (cart_id, context, created_at, updated_at) values (?, ?::jsonb, now(), now())
on conflict (cart_id) do update set context = excluded.context, updated_at = now()`,
    [cartId, JSON.stringify(storable(ctx))]
  )
}

async function readCartContext(container: any, cartId: string): Promise<CheckoutTrackingContext | null> {
  const result: any = await trackingDb(container).raw("select context from tracking_cart_context where cart_id = ?", [cartId])
  const raw = result?.rows?.[0]?.context
  return raw == null ? null : parseCheckoutContext(typeof raw === "string" ? safeJson(raw) : raw)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- record

/** The row to store for an order: host and env from the allowlist, trusted only with the edge check on a known host. */
export function orderContextRow(order: OrderForEvents, cartId: string | null, ctx: CheckoutTrackingContext, config: TrackingConfig): OrderContextRow {
  const host = normHost(ctx.host ?? "")
  const env = host ? hostRole(config, host) : null
  return {
    order_id: order.id,
    display_id: order.display_id,
    cart_id: cartId,
    host,
    env,
    context: storable(ctx),
    trusted: ctx.edge === true && env !== null,
    staff: ctx.staff === true,
    optout: ctx.optout === true,
    purchase_time: order.created_at,
  }
}

/** The dashboard's Purchase hit: one per order, value = order total, path /checkout/ (6.5). */
export function purchaseHit(order: OrderForEvents, ctx: OrderContextRow): HitInsert {
  const context = ctx.context
  const units = order.items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0)
  return {
    event_name: "Purchase",
    event_id: purchaseEventId(order.display_id) as string,
    origin: "s",
    visitor_id: ctx.optout ? null : context.vid,
    session_id: ctx.optout ? null : context.sid,
    source: context.src,
    campaign: context.camp,
    device_class: context.device,
    audience: context.audience,
    host: ctx.host,
    path: "/checkout/",
    value: Number.isFinite(order.total) && order.total >= 0 ? order.total : 0,
    items: units,
    country: context.country,
    flags: (ctx.staff ? HIT_FLAGS.INTERNAL : 0) | (context.new ? HIT_FLAGS.NEW_VISITOR : 0),
  }
}

async function insertOrderContext(trx: any, row: OrderContextRow): Promise<void> {
  await trx.raw(
    `insert into tracking_order_context (order_id, display_id, cart_id, host, env, context, trusted, staff, optout, purchase_time)
values (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?) on conflict (order_id) do nothing`,
    [row.order_id, row.display_id, row.cart_id, row.host, row.env, JSON.stringify(row.context), row.trusted, row.staff,
      row.optout, row.purchase_time]
  )
}

/**
 * Records one placed order's Purchase (6.5 steps 1-5) and returns its browser
 * block, or null when there is no context, the order is a draft or imported,
 * or it cannot be found. The context is the one given, else the cart's stashed
 * one; the stored row wins over both, so every retry returns the same block.
 * Throws on a database error (after rolling back); the callers catch.
 */
export async function recordPurchase(container: any, input: RecordPurchaseInput): Promise<PurchaseBlock | null> {
  const cartId = typeof input.cartId === "string" && input.cartId ? input.cartId : null
  const context = input.ctx ?? (cartId ? await readCartContext(container, cartId) : null)
  if (!context || !input.orderId) return null
  const [orders, imported, settings] = await Promise.all([
    loadOrdersForEvents(container, [input.orderId]),
    importedOrderIds(container, [input.orderId]),
    loadTrackingSettings(container),
  ])
  const order = orders.get(input.orderId)
  if (!order || order.is_draft_order || imported.has(order.id) || !purchaseEventId(order.display_id)) return null
  const fresh = orderContextRow(order, cartId, context, settings.config)
  const { stored, inserted } = await withTransaction(container, async (trx) => {
    await trx.raw("set local statement_timeout = '5s'")
    await insertOrderContext(trx, fresh)
    const kept = (await loadOrderContexts(trx, [order.id])).get(order.id) ?? fresh
    await insertHits(trx, [purchaseHit(order, kept)])
    const rows = buildOrderEventRows({ kind: "Purchase", order, ctx: kept, settings, at: order.created_at, source: input.source })
    return { stored: kept, inserted: await insertOrderEvents(trx, rows) }
  })
  if (inserted) scheduleFlush(container)
  kickStaleJobs(container)
  return buildPurchaseBlock(order, stored, settings)
}

// ---------------------------------------------------------------- checkout helpers (never throw)

type Budgeted<T> = { ok: true; value: T } | { ok: false; reason: string }

function reasonOf(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown } | null
  const code = typeof e?.code === "string" && /^[A-Za-z0-9_]{1,20}$/.test(e.code) ? e.code : null
  const name = typeof e?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "Error"
  return code ? `${name} ${code}` : name
}

function logLine(container: any, message: string): void {
  try {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    if (typeof logger?.warn === "function") logger.warn(message)
    else logger?.error?.(message)
  } catch {
    // Logging is best effort.
  }
}

/**
 * Waits for `work` at most `ms`. Past the budget the work keeps running in
 * the background (its result is dropped; a late failure is logged). Never
 * rejects.
 */
function withinBudget<T>(container: any, work: () => Promise<T>, ms: number, what: string): Promise<Budgeted<T>> {
  return new Promise((resolve) => {
    let done = false
    let timer: any = null
    const finish = (outcome: Budgeted<T>) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(outcome)
    }
    let promise: Promise<T>
    try {
      promise = Promise.resolve(work())
    } catch (error) {
      finish({ ok: false, reason: reasonOf(error) })
      return
    }
    timer = setTimeout(() => finish({ ok: false, reason: `timeout after ${ms} ms` }), ms)
    timer?.unref?.()
    promise.then(
      (value) => finish({ ok: true, value }),
      (error) => {
        if (done) logLine(container, `Checkout tracking: the ${what} failed after its time budget (${reasonOf(error)}); the reconcile job retries it.`)
        finish({ ok: false, reason: reasonOf(error) })
      }
    )
  })
}

/** The stash step: store the context by cart before the order is placed. Never throws. */
export async function stashCheckoutTracking(container: any, input: CheckoutTrackingInput): Promise<void> {
  try {
    const cartId = cartIdOf(input?.body)
    if (!input?.complete || !input.tracking || !cartId) return
    const ctx = input.tracking
    const outcome = await withinBudget(container, () => stashCartContext(container, cartId, ctx), STASH_BUDGET_MS, "context stash")
    if (!outcome.ok) logLine(container, `Checkout tracking: the context was not stashed (${outcome.reason}).`)
  } catch {
    // Never let tracking touch the order.
  }
}

/**
 * The record step: only for a placed order (status 200 with an order id) with
 * a context. Returns the Purchase block, or null. Never throws.
 */
export async function recordCheckoutTracking(
  container: any,
  input: CheckoutTrackingInput,
  result: { status?: number; body?: Record<string, any> } | null | undefined
): Promise<PurchaseBlock | null> {
  try {
    const orderId = result?.status === 200 ? result.body?.order?.id : null
    if (typeof orderId !== "string" || !orderId || !input?.tracking) return null
    const ctx = input.tracking
    const cartId = cartIdOf(input.body)
    const outcome = await withinBudget(container,
      () => recordPurchase(container, { orderId, cartId, ctx, source: "checkout" }), RECORD_BUDGET_MS, "Purchase record")
    if (outcome.ok) return outcome.value
    logLine(container, `Checkout tracking: the Purchase was not recorded (${outcome.reason}); the reconcile job retries it.`)
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- reconcile (6.6)

/** (a) Stashed carts from the last 6 days that became orders without a stored context. */
async function reconcileCarts(container: any, stats: ReconcileStats, errors: unknown[]): Promise<void> {
  const db = trackingDb(container)
  const result: any = await db.raw(
    `select c.cart_id, c.context from tracking_cart_context c
where c.updated_at >= now() - interval '6 days' and c.updated_at < now() - interval '1 minute'
  and not exists (select 1 from tracking_order_context o where o.cart_id = c.cart_id)
order by c.updated_at desc limit ${RECONCILE_LIMIT}`
  )
  const contexts = new Map<string, CheckoutTrackingContext>()
  for (const row of result?.rows ?? []) {
    const ctx = parseCheckoutContext(typeof row.context === "string" ? safeJson(row.context) : row.context)
    if (ctx && typeof row.cart_id === "string") contexts.set(row.cart_id, ctx)
  }
  stats.carts = contexts.size
  if (!contexts.size) return
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const links: { order_id: string; cart_id: string }[] = []
  for (const part of chunks([...contexts.keys()], GRAPH_CHUNK)) {
    const { data } = await query.graph({ entity: "order_cart", fields: ["order_id", "cart_id"], filters: { cart_id: part } })
    for (const link of data ?? []) {
      if (typeof link?.order_id === "string" && typeof link?.cart_id === "string") links.push(link)
    }
  }
  if (!links.length) return
  const known = await loadOrderContexts(db, links.map((link) => link.order_id))
  for (const link of links) {
    if (known.has(link.order_id)) continue
    try {
      const block = await recordPurchase(container, { orderId: link.order_id, cartId: link.cart_id, ctx: contexts.get(link.cart_id), source: "reconcile" })
      if (block) stats.recorded += 1
    } catch (error) {
      errors.push(error)
    }
  }
}

/** (b) Orders from the last 48 h without an order_op row: the order.placed subscriber can be lost. */
async function reconcileOps(container: any, stats: ReconcileStats): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "is_draft_order"],
    filters: { created_at: { $gte: new Date(Date.now() - 2 * DAY_MS) } },
  })
  const ids = [...new Set((data ?? [])
    .filter((order: any) => typeof order?.id === "string" && order.is_draft_order !== true)
    .map((order: any) => order.id as string))] as string[]
  if (!ids.length) return
  const db = trackingDb(container)
  const present = new Set<string>()
  for (const part of chunks(ids, SQL_CHUNK)) {
    const result: any = await db.raw(`select order_id from order_op where order_id in (${marks(part)}) and deleted_at is null`, part)
    for (const row of result?.rows ?? []) present.add(String(row.order_id))
  }
  const missing = ids.filter((id) => !present.has(id))
  if (!missing.length) return
  await ensureOps(container, missing)
  stats.ops_created = missing.length
}

/**
 * (c) Trusted, non-staff, non-opted-out contexts from the last 6 days that
 * lack a Purchase row for a platform. buildOrderEventRows decides the missing
 * row's state, so a platform that is off gets its `skipped` row: this never
 * becomes a silent backfill. It also hashes contact details only for an order
 * whose stored context carries a consent version, so turning sharing on never
 * adds them to a Purchase placed before the shopper could see the line.
 */
async function reconcileRows(container: any, stats: ReconcileStats): Promise<void> {
  const db = trackingDb(container)
  const result: any = await db.raw(
    `select c.order_id from tracking_order_context c
where c.trusted and not c.staff and not c.optout and c.env is not null
  and c.created_at >= now() - interval '6 days' and c.purchase_time >= now() - interval '6 days'
  and (not exists (select 1 from tracking_event e where e.platform = 'meta' and e.event_name = 'Purchase' and e.event_id = 'fl-' || c.display_id)
    or not exists (select 1 from tracking_event e where e.platform = 'tiktok' and e.event_name = 'Purchase' and e.event_id = 'fl-' || c.display_id))
order by c.created_at limit ${RECONCILE_LIMIT}`
  )
  const ids = (result?.rows ?? []).map((row: any) => String(row.order_id))
  if (!ids.length) return
  const [orders, imported, contexts, settings] = await Promise.all([
    loadOrdersForEvents(container, ids),
    importedOrderIds(container, ids),
    loadOrderContexts(db, ids),
    loadTrackingSettings(container),
  ])
  const rows = ids.flatMap((id: string) => {
    const order = orders.get(id)
    const ctx = contexts.get(id)
    if (!order || !ctx || order.is_draft_order || imported.has(id)) return []
    return buildOrderEventRows({ kind: "Purchase", order, ctx, settings, at: order.created_at, source: "reconcile" })
  })
  if (!rows.length) return
  stats.rows_added = await withTransaction(container, (trx) => insertOrderEvents(trx, rows))
  if (stats.rows_added) scheduleFlush(container)
}

/**
 * The every-5-minutes repair (6.6): (a) record Purchases for stashed carts
 * that became orders, (b) give recent orders their order_op row, (c) add a
 * missing Purchase row per platform. Drafts and imported orders are skipped.
 * Each part runs even when an earlier one failed; the first error is thrown
 * at the end so the job state shows it. Returns what it did (for tests).
 */
export async function runReconcile(container: any): Promise<ReconcileStats> {
  const stats: ReconcileStats = { carts: 0, recorded: 0, ops_created: 0, rows_added: 0 }
  const errors: unknown[] = []
  try {
    await reconcileCarts(container, stats, errors)
  } catch (error) {
    errors.push(error)
  }
  try {
    await reconcileOps(container, stats)
  } catch (error) {
    errors.push(error)
  }
  try {
    await reconcileRows(container, stats)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw errors[0]
  return stats
}

/** The reconcile job's run (jobs/tracking-reconcile.ts). */
export async function reconcilePurchases(container: any): Promise<void> {
  await runReconcile(container)
}
