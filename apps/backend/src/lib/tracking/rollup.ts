import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { getState, setState, withTransaction } from "./db"

/**
 * The Live dashboard rollup (TRACKING.md 9, WP07), run every minute by
 * jobs/tracking-rollup.ts. It folds the raw tracking_hit rows of one closed
 * time window into the dashboard tables, all in ONE transaction under an
 * advisory lock (a second process gives up quietly):
 * 1. the window is [rollup:watermark.done_through, date_trunc('minute',
 *    now() - 20 s)); hits carry clock_timestamp() and ingest's statement
 *    timeout is 5 s, so no hit can still land in a closed window (I15);
 * 2. tracking_minute is recomputed and SET for the window, so a rerun gives
 *    the same rows;
 * 3. tracking_session is upserted (least/greatest times, bit-or flags,
 *    pageviews and purchase value added); the attributes come from the
 *    session's first hit, the landing path from its first PageView;
 * 4. tracking_day_dim gets += for product (handle), device, case_type,
 *    source, audience, device_class and landing (the session's landing page);
 * 5. the watermark moves to the window's end.
 *
 * Staff hits (flag 8) are left out of tracking_minute and tracking_day_dim;
 * their sessions are kept, marked internal (session flag 16). Next to the
 * real event names both tables carry a derived "ProductView" row: the primary
 * ViewContent (flag 1), one per product page opened, which is what the
 * dashboard calls product views (variant switches are not views).
 *
 * A server Purchase hit has no product (one hit per order, path /checkout/),
 * so its product, device and case type rows come from the order's items
 * (count = units, value = line total), with names from the variant index.
 * That step runs in a savepoint: if it fails the rest of the rollup still
 * commits. Raw SQL through the PG_CONNECTION knex is the documented exception
 * of lib/tracking/db.ts; every value is a binding.
 */

type Trx = Knex | Knex.Transaction

export const WATERMARK_KEY = "rollup:watermark"
/** One run folds at most this much, so a long outage catches up in bounded transactions. */
export const MAX_WINDOW_MS = 6 * 3_600_000
/** The derived event name for primary ViewContent hits (one per product page opened); the SQL spells it out. */
export const PRODUCT_VIEW = "ProductView"
export const DAY_DIMS = ["product", "device", "case_type", "source", "audience", "device_class", "landing"] as const
export type DayDim = (typeof DAY_DIMS)[number]

export type Watermark = { done_through: string }
export type RollupWindow = { from: Date; to: Date }
export type RollupResult =
  | { status: "locked" }
  | { status: "idle"; done_through: string }
  | { status: "done"; from: string; to: string; minutes: number; sessions: number; dims: number; purchase_items: number }

export const LOCK_SQL = "select pg_try_advisory_xact_lock(hashtext('florayn-tracking-rollup')) as locked"

export const BOUNDS_SQL = `select date_trunc('minute', now() - interval '20 seconds') as until,
  date_trunc('minute', now() - interval '1 hour') as initial`

/** Step 3: per minute, event, source and host, non-staff hits only; SET, so a rerun is identical. */
export const MINUTE_SQL = `with w as (
  select received_at, event_name, source, host, value, flags from tracking_hit
  where received_at >= ? and received_at < ? and (flags & 8) = 0
), e as (
  select received_at, event_name, source, host, value from w
  union all
  select received_at, 'ProductView', source, host, value from w where event_name = 'ViewContent' and (flags & 1) <> 0
)
insert into tracking_minute (bucket, event_name, source, host, count, value)
select date_trunc('minute', received_at), event_name, coalesce(source, ''), host, count(*)::int, coalesce(sum(value), 0)
from e
group by 1, 2, 3, 4
on conflict (bucket, event_name, source, host) do update set count = excluded.count, value = excluded.value`

/**
 * Step 4a: one upsert per session seen in the window (staff hits included,
 * marked internal). Session flags: 1 VC, 2 ATC, 4 IC, 8 Purchase, 16 internal.
 * IC hits are keyed per cart and session (ingest's hitEventId), so a buyer who
 * reopens checkout in a later session gets flag 4 there too. The hit flag 16
 * (new visitor) of the session's first hit sets is_new_visitor.
 */
export const SESSION_SQL = `with w as (
  select event_id, event_name, received_at, visitor_id, session_id, source, campaign, device_class, audience,
    host, path, value, flags
  from tracking_hit where received_at >= ? and received_at < ? and session_id is not null
), agg as (
  select session_id, max(visitor_id) as visitor_id, min(received_at) as started_at, max(received_at) as last_at,
    bit_or(case event_name when 'ViewContent' then 1 when 'AddToCart' then 2 when 'InitiateCheckout' then 4
      when 'Purchase' then 8 else 0 end | case when (flags & 8) <> 0 then 16 else 0 end) as flags,
    (count(*) filter (where event_name = 'PageView'))::int as pageviews,
    coalesce(sum(value) filter (where event_name = 'Purchase'), 0) as purchase_value
  from w group by session_id
), first_hit as (
  select distinct on (session_id) session_id, source, campaign, device_class, audience, host, (flags & 16) <> 0 as is_new
  from w order by session_id, received_at, event_id
), landing as (
  select distinct on (session_id) session_id, path
  from w where event_name = 'PageView' and path is not null order by session_id, received_at, event_id
)
insert into tracking_session (session_id, visitor_id, day, started_at, last_at, source, campaign, landing_path,
  device_class, audience, host, is_new_visitor, pageviews, flags, purchase_value)
select a.session_id, coalesce(a.visitor_id, ''), (a.started_at at time zone 'Asia/Dhaka')::date, a.started_at, a.last_at,
  f.source, f.campaign, l.path, f.device_class, f.audience, f.host, f.is_new, a.pageviews, a.flags, a.purchase_value
from agg a join first_hit f on f.session_id = a.session_id left join landing l on l.session_id = a.session_id
on conflict (session_id) do update set
  started_at = least(tracking_session.started_at, excluded.started_at),
  last_at = greatest(tracking_session.last_at, excluded.last_at),
  flags = tracking_session.flags | excluded.flags,
  pageviews = tracking_session.pageviews + excluded.pageviews,
  purchase_value = tracking_session.purchase_value + excluded.purchase_value,
  landing_path = coalesce(tracking_session.landing_path, excluded.landing_path)`

/**
 * Step 4b: += per Dhaka day, dimension, key, event and host, non-staff hits
 * only. Purchase hits skip the item dims (product, device, case_type): those
 * come from the order items. Every hit has exactly one source row ("unknown"
 * when none), so summing the source dim gives a day's totals. The landing key
 * is the pathname of the session's first PageView (step 4a ran first);
 * chr(63) is "?", which knex would take for a binding even inside a literal.
 */
export const DAY_DIM_SQL = `with w as (
  select h.received_at, h.event_name, h.host, h.value, h.flags, h.handle, h.device, h.case_type, h.source, h.audience,
    h.device_class, s.landing_path
  from tracking_hit h left join tracking_session s on s.session_id = h.session_id
  where h.received_at >= ? and h.received_at < ? and (h.flags & 8) = 0
), e as (
  select received_at, event_name, host, value, handle, device, case_type, source, audience, device_class, landing_path from w
  union all
  select received_at, 'ProductView', host, value, handle, device, case_type, source, audience, device_class, landing_path
  from w where event_name = 'ViewContent' and (flags & 1) <> 0
)
insert into tracking_day_dim (day, dim, key, event_name, host, count, value)
select (e.received_at at time zone 'Asia/Dhaka')::date, d.dim, d.key, e.event_name, e.host, count(*)::int, coalesce(sum(e.value), 0)
from e cross join lateral (values
  ('product', case when e.event_name = 'Purchase' then null else e.handle end),
  ('device', case when e.event_name = 'Purchase' then null else e.device end),
  ('case_type', case when e.event_name = 'Purchase' then null else e.case_type end),
  ('source', coalesce(nullif(e.source, ''), 'unknown')),
  ('audience', e.audience),
  ('device_class', e.device_class),
  ('landing', split_part(e.landing_path, chr(63), 1))
) as d(dim, key)
where d.key is not null and d.key <> ''
group by 1, 2, 3, 4, 5
on conflict (day, dim, key, event_name, host) do update set
  count = tracking_day_dim.count + excluded.count, value = tracking_day_dim.value + excluded.value`

export const PURCHASE_HITS_SQL = `select event_id, host, received_at from tracking_hit
where received_at >= ? and received_at < ? and event_name = 'Purchase' and (flags & 8) = 0`

/** Asia/Dhaka is UTC+6 all year (no daylight saving). */
export const DHAKA_OFFSET_MS = 6 * 3_600_000
const MINUTE_MS = 60_000
const ORDER_ITEM_FIELDS = ["id", "items.variant_id", "items.product_handle", "items.quantity", "items.unit_price"]

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

function rowsOf(result: any): any[] {
  return result?.rows ?? []
}

function affected(result: any): number {
  return Number(result?.rowCount ?? result?.rows?.length ?? 0)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date : null
}

/** The Asia/Dhaka calendar date (UTC+6, no daylight saving) of an instant, as YYYY-MM-DD. */
export function dhakaDay(time: number): string {
  return new Date(time + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * The window one run folds: from the watermark (or `initial`, one hour back,
 * on the first run) to `until`, at most MAX_WINDOW_MS long. Null when there
 * is nothing closed to fold yet. Both ends stay whole minutes.
 */
export function rollupWindow(doneThrough: unknown, until: unknown, initial: unknown): RollupWindow | null {
  const end = toDate(until)
  const from = toDate(doneThrough) ?? toDate(initial)
  if (!end || !from || end.getTime() <= from.getTime()) return null
  const capped = Math.min(end.getTime(), from.getTime() + MAX_WINDOW_MS)
  const to = capped - (capped % MINUTE_MS)
  return to > from.getTime() ? { from, to: new Date(to) } : null
}

// ---------------------------------------------------------------- Purchase items

export type PurchaseHit = { event_id: string; host: string; received_at: Date | string }
export type PurchaseOrder = {
  id: string
  items?: { variant_id?: string | null; product_handle?: string | null; quantity?: unknown; unit_price?: unknown }[] | null
}
export type IndexedNames = { handle: string | null; device: string | null; case_type: string | null }
export type DimDelta = { day: string; dim: DayDim; key: string; host: string; count: number; value: number }

/** The display id in a Purchase event id (`fl-1234` gives 1234), or null. */
export function purchaseDisplayId(eventId: unknown): number | null {
  const match = typeof eventId === "string" ? /^fl-(\d{1,12})$/.exec(eventId) : null
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Pure: the product, device and case type rows of the window's Purchase
 * hits, from each order's items. Count = units, value = unit price x units.
 * Names come from the variant index (the same option names the browser hits
 * carry), the handle falls back to the line's product handle. Rows with the
 * same key are merged, as one INSERT cannot touch a row twice.
 */
export function purchaseItemDeltas(
  hits: readonly PurchaseHit[],
  orderByDisplayId: ReadonlyMap<number, PurchaseOrder>,
  variants: ReadonlyMap<string, IndexedNames>
): DimDelta[] {
  const merged = new Map<string, DimDelta>()
  const add = (day: string, dim: DayDim, key: string | null | undefined, host: string, count: number, value: number) => {
    if (typeof key !== "string" || !key) return
    const id = `${day}|${dim}|${key}|${host}`
    const entry = merged.get(id)
    if (entry) {
      entry.count += count
      entry.value += value
    } else {
      merged.set(id, { day, dim, key, host, count, value })
    }
  }
  for (const hit of hits) {
    const displayId = purchaseDisplayId(hit.event_id)
    const order = displayId === null ? undefined : orderByDisplayId.get(displayId)
    const at = toDate(hit.received_at)
    if (!order || !at || !hit.host) continue
    const day = dhakaDay(at.getTime())
    for (const item of order.items ?? []) {
      const quantity = Math.round(num(item?.quantity))
      if (quantity <= 0) continue
      const value = Math.max(0, num(item?.unit_price)) * quantity
      const names = item?.variant_id ? variants.get(item.variant_id) : undefined
      add(day, "product", names?.handle || item?.product_handle, hit.host, quantity, value)
      add(day, "device", names?.device, hit.host, quantity, value)
      add(day, "case_type", names?.case_type, hit.host, quantity, value)
    }
  }
  return [...merged.values()]
}

async function purchaseItemRows(trx: Trx, container: any, window: RollupWindow): Promise<DimDelta[]> {
  const hits: PurchaseHit[] = rowsOf(await trx.raw(PURCHASE_HITS_SQL, [window.from, window.to]))
  const displayIds = [...new Set(hits.map((hit) => purchaseDisplayId(hit.event_id)).filter((id): id is number => id !== null))]
  if (!displayIds.length) return []
  const contexts = rowsOf(await trx.raw(
    `select order_id, display_id from tracking_order_context where display_id in (${marks(displayIds.length)})`, displayIds))
  const displayByOrder = new Map<string, number>()
  for (const row of contexts) {
    if (typeof row.order_id === "string" && Number.isSafeInteger(Number(row.display_id))) displayByOrder.set(row.order_id, Number(row.display_id))
  }
  if (!displayByOrder.size) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_ITEM_FIELDS,
    filters: { id: [...displayByOrder.keys()] },
    pagination: { skip: 0, take: displayByOrder.size },
  })
  const orders = new Map<number, PurchaseOrder>()
  for (const order of (data ?? []) as PurchaseOrder[]) {
    const displayId = displayByOrder.get(order?.id)
    if (displayId !== undefined) orders.set(displayId, order)
  }
  const variantIds = [...new Set([...orders.values()].flatMap((order) => (order.items ?? [])
    .map((item) => item?.variant_id).filter((id): id is string => typeof id === "string" && id.length > 0)))]
  const variants = new Map<string, IndexedNames>()
  if (variantIds.length) {
    for (const row of rowsOf(await trx.raw(
      `select variant_id, handle, device, case_type from tracking_variant where variant_id in (${marks(variantIds.length)})`, variantIds))) {
      variants.set(row.variant_id, { handle: row.handle ?? null, device: row.device ?? null, case_type: row.case_type ?? null })
    }
  }
  return purchaseItemDeltas(hits, orders, variants)
}

async function insertPurchaseDeltas(trx: Trx, deltas: readonly DimDelta[]): Promise<number> {
  if (!deltas.length) return 0
  const bindings: unknown[] = []
  for (const delta of deltas) bindings.push(delta.day, delta.dim, delta.key, delta.host, delta.count, delta.value)
  const groups = deltas.map(() => "(?::date, ?, ?, 'Purchase', ?, ?, ?)").join(", ")
  const result = await trx.raw(
    `insert into tracking_day_dim (day, dim, key, event_name, host, count, value) values ${groups}
on conflict (day, dim, key, event_name, host) do update set
  count = tracking_day_dim.count + excluded.count, value = tracking_day_dim.value + excluded.value`,
    bindings as any[]
  )
  return affected(result)
}

/**
 * Runs the Purchase item step inside a savepoint (a knex nested
 * transaction): a failed order lookup or a missing table rolls back only this
 * step and the rest of the rollup still commits. Returns the rows written.
 */
async function foldPurchaseItems(trx: Knex.Transaction, container: any, window: RollupWindow): Promise<number> {
  try {
    return await trx.transaction(async (savepoint) => insertPurchaseDeltas(savepoint, await purchaseItemRows(savepoint, container, window)))
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------- the run

/** One rollup pass (steps 1-5 of TRACKING.md 9). Returns what it did; the job ignores it. */
export async function rollupOnce(container: any): Promise<RollupResult> {
  return withTransaction(container, async (trx): Promise<RollupResult> => {
    const [lock] = rowsOf(await trx.raw(LOCK_SQL))
    if (!lock?.locked) return { status: "locked" }
    await trx.raw("set local statement_timeout = '120s'")

    const watermark = await getState<Watermark>(trx, WATERMARK_KEY)
    const [bounds] = rowsOf(await trx.raw(BOUNDS_SQL))
    const window = rollupWindow(watermark?.done_through, bounds?.until, bounds?.initial)
    if (!window) return { status: "idle", done_through: toDate(watermark?.done_through)?.toISOString() ?? "" }

    const range = [window.from, window.to]
    const minutes = affected(await trx.raw(MINUTE_SQL, range))
    const sessions = affected(await trx.raw(SESSION_SQL, range))
    const dims = affected(await trx.raw(DAY_DIM_SQL, range))
    const purchaseItems = await foldPurchaseItems(trx, container, window)
    const next: Watermark = { done_through: window.to.toISOString() }
    await setState(trx, WATERMARK_KEY, next)
    return {
      status: "done",
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      minutes,
      sessions,
      dims,
      purchase_items: purchaseItems,
    }
  })
}

/** The rollup job body for the jobs registry (6.4). */
export async function runRollup(container: any): Promise<void> {
  await rollupOnce(container)
}

/** Seconds between now and the watermark (null before the first run). */
export function rollupLagSeconds(doneThrough: unknown, now: number): number | null {
  const done = toDate(doneThrough)
  return done ? Math.max(0, Math.round((now - done.getTime()) / 1000)) : null
}
