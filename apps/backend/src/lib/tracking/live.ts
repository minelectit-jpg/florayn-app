import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { feedMeta, lastFeedFetches, type FeedFetch, type FeedMeta, type FeedPlatform } from "./catalog-feed"
import { getState, trackingDb } from "./db"
import { outboxHealth, type OutboxHealthRow } from "./health"
import { jobStates, kickStaleJobs, type JobState, type TrackingJobName } from "./jobs"
import { DHAKA_OFFSET_MS, WATERMARK_KEY, dhakaDay, rollupLagSeconds, type Watermark } from "./rollup"
import { loadTrackingSettings, normHost, parseTrackingConfig, type TrackingConfig } from "./settings"
import type { VariantIndexState } from "./variant-index"

/**
 * The numbers behind Admin > Live (TRACKING.md 9, WP07): who is on the shop
 * now, today against yesterday at the same time, orders against the daily
 * target with a pace projection, the funnel, a 5-minute sparkline, today's
 * sources/products/devices/case types, recent activity and the tracking
 * health; plus the 7/30-day report and the staff exclusion links.
 *
 * "Today" is Asia/Dhaka midnight to now. Event counts are the closed-minute
 * rollups (tracking_minute) plus the raw hits since the rollup watermark, so
 * they stay exact while the rollup job is behind and never count a hit twice.
 * Staff hits (flag 8) are never counted. Orders come from the order module's
 * tables, not from tracking: drafts and imported florayn.com orders are left
 * out, cancelled ones are counted apart and add no revenue. They are one SQL
 * read with the totals Medusa stores in order_summary, never query.graph with
 * `total` (that loads every line, tax line and adjustment and recomputes the
 * totals on the event loop that serves checkout).
 *
 * One result is shared for poll_seconds (at least 10 s) per host filter, so
 * any number of open Live tabs cost one computation per poll. The outbox
 * counts and today's unknown content ids are shared for 60 s, the 7-day order
 * history until Dhaka midnight (its cancellations re-read every 5 minutes)
 * and the report for 5 minutes. Each part is read on its own, so a missing
 * table blanks one card, not the page.
 * Raw SQL through the PG_CONNECTION knex is the documented exception of
 * lib/tracking/db.ts; every value is a binding. Nothing here returns customer
 * data: hits carry no names, phones, emails, IPs or user agents.
 */

type Db = ReturnType<typeof trackingDb>

export type EventKey = "PageView" | "ProductView" | "AddToCart" | "InitiateCheckout" | "Purchase"
export const EVENT_KEYS: readonly EventKey[] = ["PageView", "ProductView", "AddToCart", "InitiateCheckout", "Purchase"]
export type EventTotals = Record<EventKey, { n: number; v: number }>

export type LiveCounts = {
  visitors: number
  sessions: number
  page_views: number
  product_views: number
  add_to_cart: number
  initiate_checkout: number
  web_purchases: number
  revenue_web: number
  orders_all: number
  orders_cancelled: number
  revenue_all: number
  aov: number
  target: number
  pace_projection: number | null
}

export type LiveNow = {
  visitors_5m: number
  visitors_30m: number
  by_source: { source: string; label: string; visitors: number }[]
  top_pages: { path: string; visitors: number }[]
}

export type LiveFunnel = {
  sessions: number
  vc: number
  atc: number
  ic: number
  purchase: number
  vc_rate: number
  atc_rate: number
  ic_rate: number
  purchase_rate: number
  conversion: number
}

export type SparkPoint = { t: string; pv: number; vc: number; atc: number; ic: number; p: number }

export type DimRow = {
  key: string
  label: string
  sessions?: number
  page_views: number
  product_views: number
  add_to_cart: number
  initiate_checkout: number
  purchases: number
  revenue: number
}

export type LiveTables = { sources: DimRow[]; products: DimRow[]; devices: DimRow[]; case_types: DimRow[] }

export type RecentHit = {
  event: string
  label: string
  source: string | null
  source_label: string | null
  host: string
  value: number | null
  internal: boolean
  ago_s: number
}

export type LiveHealth = {
  outbox: OutboxHealthRow[] | null
  jobs: Record<TrackingJobName, JobState | null> | null
  rollup_lag_s: number | null
  watermark: string | null
  feed: { builds: FeedMeta[]; last_fetch: Partial<Record<FeedPlatform, FeedFetch>> } | null
  variant_index: VariantIndexState | null
  unknown_content_ids_today: number | null
}

export type HostFilter = { key: string; hosts: string[] | null; label: string }

export type LivePayload = {
  generated_at: string
  day: string
  filter: HostFilter & { options: { value: string; label: string }[] }
  poll_seconds: number
  now: LiveNow
  today: LiveCounts
  yesterday_same_time: LiveCounts
  funnel: LiveFunnel
  spark: SparkPoint[]
  tables: LiveTables
  recent: RecentHit[]
  health: LiveHealth
  errors: string[]
}

export type ReportRange = "7d" | "30d"

export type ReportDay = {
  day: string
  visitors: number
  sessions: number
  page_views: number
  product_views: number
  add_to_cart: number
  initiate_checkout: number
  purchases: number
  revenue: number
}

export type ReportPayload = {
  generated_at: string
  range: ReportRange
  from_day: string
  to_day: string
  filter: HostFilter
  days: ReportDay[]
  totals: ReportDay
  funnel: LiveFunnel
  tables: LiveTables & { audiences: DimRow[]; device_classes: DimRow[]; landing: DimRow[] }
  errors: string[]
}

export type StaffLink = { host: string; list: "test" | "live"; url: string; off_url: string }

/** An unknown `?host=` (the route answers 400). */
export class LiveInputError extends Error {}

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const SPARK_STEP_MS = 5 * MINUTE_MS
/** The shortest Live cache; it is poll_seconds when that is longer. */
const LIVE_CACHE_MS = 10_000
const HISTORY_PATCH_MS = 5 * MINUTE_MS
const HEALTH_CACHE_MS = 60_000
const REPORT_CACHE_MS = 5 * MINUTE_MS
const LAG_KICK_S = 120
const TABLE_ROWS = 25
const NAMED_ROWS = 10
const MAX_ORDERS = 20_000

const SOURCE_LABELS: Record<string, string> = {
  meta_paid: "Meta ads",
  meta: "Facebook / Instagram",
  tiktok_paid: "TikTok ads",
  tiktok: "TikTok",
  google_paid: "Google ads",
  google_organic: "Google search",
  messaging: "Messaging apps",
  referral: "Other websites",
  direct: "Direct",
  unknown: "Unknown",
}

// ---------------------------------------------------------------- pure helpers

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function time(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime()
  return Number.isFinite(ms) ? ms : null
}

function rowsOf(result: any): any[] {
  return result?.rows ?? []
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

/** ` and <column> in (?, ...)` for a host filter, or nothing for all hosts. */
function hostSql(column: string, hosts: string[] | null): { sql: string; bindings: string[] } {
  return hosts ? { sql: ` and ${column} in (${marks(hosts.length)})`, bindings: hosts } : { sql: "", bindings: [] }
}

/** The instant of 00:00 Asia/Dhaka on the Dhaka day of `ms`. */
export function dhakaMidnight(ms: number): number {
  return Math.floor((ms + DHAKA_OFFSET_MS) / DAY_MS) * DAY_MS - DHAKA_OFFSET_MS
}

/** `2026-09-27T10:05:00+06:00` (Dhaka wall clock with its offset). */
export function dhakaIso(ms: number): string {
  return `${new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(0, 19)}+06:00`
}

/**
 * Where rollups stop and raw hits start for the span [from, to): at the
 * watermark (buckets before it are rolled up), never before `from` and never
 * after the last whole minute of `to`. Without a watermark everything is raw.
 * Minute rows then cover [from, split) and raw hits [split, to): no gap, no
 * hit counted twice.
 */
export function rollupSplit(from: number, to: number, doneThrough: number | null): number {
  if (doneThrough === null) return from
  const closed = to - (((to % MINUTE_MS) + MINUTE_MS) % MINUTE_MS)
  return Math.max(from, Math.min(doneThrough, closed))
}

export function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0
}

export function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source]
  const paid = /^(.+)_paid$/.exec(source)
  return paid ? `${paid[1]} (paid)` : source
}

/** `zebra-stark` gives `Zebra Stark` (a product without a resolved title). */
export function humanize(handle: string): string {
  return handle.split("-").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
}

export function emptyTotals(): EventTotals {
  const totals = {} as EventTotals
  for (const key of EVENT_KEYS) totals[key] = { n: 0, v: 0 }
  return totals
}

/** Adds rows of `{ event_name, n, v }` into totals; unknown names are ignored. */
export function addTotals(totals: EventTotals, rows: readonly { event_name: string; n: unknown; v?: unknown }[]): EventTotals {
  for (const row of rows) {
    const entry = totals[row.event_name as EventKey]
    if (!entry) continue
    entry.n += num(row.n)
    entry.v += num(row.v)
  }
  return totals
}

export type OrderFact = { id: string; at: number; total: number; cancelled: boolean }
export type OrderSummary = { orders_all: number; orders_cancelled: number; net: number; revenue_all: number; aov: number }

/** Orders placed in [from, to): all, cancelled, net, revenue without the cancelled ones, average order value. */
export function summarizeOrders(orders: readonly OrderFact[], from: number, to: number): OrderSummary {
  let all = 0
  let cancelled = 0
  let revenue = 0
  for (const order of orders) {
    if (order.at < from || order.at >= to) continue
    all += 1
    if (order.cancelled) cancelled += 1
    else revenue += order.total
  }
  const net = all - cancelled
  return { orders_all: all, orders_cancelled: cancelled, net, revenue_all: Math.round(revenue), aov: net ? Math.round(revenue / net) : 0 }
}

/**
 * Pace (TRACKING.md 9): today's net orders divided by the share of the last 7
 * days' net orders that were placed by this time of day (Dhaka). Null without
 * history, or when none of it was placed this early.
 */
export function paceProjection(netToday: number, history: readonly OrderFact[], now: number): number | null {
  const midnight = dhakaMidnight(now)
  const elapsed = now - midnight
  const start = midnight - 7 * DAY_MS
  let total = 0
  let byNow = 0
  for (const order of history) {
    if (order.cancelled || order.at < start || order.at >= midnight) continue
    total += 1
    if (order.at - dhakaMidnight(order.at) < elapsed) byNow += 1
  }
  if (!total || !byNow) return null
  return Math.round(netToday / (byNow / total))
}

/**
 * Pure: turns Medusa orders and their order_op rows into order facts. Drafts
 * and imported orders (order_op.source set) are dropped; cancelled means
 * canceled_at is set or the order manager status is "cancelled".
 */
export function orderFacts(
  orders: readonly any[],
  ops: ReadonlyMap<string, { source: string | null; workflow_status: string | null }>
): OrderFact[] {
  const facts: OrderFact[] = []
  for (const order of orders) {
    if (!order?.id || order.is_draft_order === true) continue
    const op = ops.get(order.id)
    if (op?.source) continue
    const at = time(order.created_at)
    if (at === null) continue
    facts.push({
      id: String(order.id),
      at,
      total: Math.max(0, num(order.total)),
      cancelled: Boolean(time(order.canceled_at)) || op?.workflow_status === "cancelled",
    })
  }
  return facts
}

export function funnelOf(row: { sessions?: unknown; vc?: unknown; atc?: unknown; ic?: unknown; purchase?: unknown } | undefined): LiveFunnel {
  const sessions = num(row?.sessions)
  const vc = num(row?.vc)
  const atc = num(row?.atc)
  const ic = num(row?.ic)
  const purchase = num(row?.purchase)
  return {
    sessions, vc, atc, ic, purchase,
    vc_rate: rate(vc, sessions),
    atc_rate: rate(atc, vc),
    ic_rate: rate(ic, atc),
    purchase_rate: rate(purchase, ic),
    conversion: rate(purchase, sessions),
  }
}

/** 5-minute points from Dhaka midnight to the bucket holding `now`, zeros where nothing happened. */
export function buildSpark(rows: readonly { t5: unknown; event_name: string; n: unknown }[], midnight: number, now: number): SparkPoint[] {
  const field: Partial<Record<string, keyof Omit<SparkPoint, "t">>> = {
    PageView: "pv", ProductView: "vc", AddToCart: "atc", InitiateCheckout: "ic", Purchase: "p",
  }
  const byBucket = new Map<number, SparkPoint>()
  const points: SparkPoint[] = []
  for (let t = midnight; t <= now; t += SPARK_STEP_MS) {
    const point = { t: dhakaIso(t), pv: 0, vc: 0, atc: 0, ic: 0, p: 0 }
    byBucket.set(t, point)
    points.push(point)
  }
  for (const row of rows) {
    const key = field[row.event_name]
    const point = byBucket.get(num(row.t5) * 1000)
    if (key && point) point[key] += num(row.n)
  }
  return points
}

function blankRow(key: string, label: string): DimRow {
  return { key, label, page_views: 0, product_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0, revenue: 0 }
}

const ROW_FIELD: Record<EventKey, keyof DimRow> = {
  PageView: "page_views",
  ProductView: "product_views",
  AddToCart: "add_to_cart",
  InitiateCheckout: "initiate_checkout",
  Purchase: "purchases",
}

/**
 * Pure: day-dim rows `{ dim, key, event_name, n, v }` pivoted into one row
 * per key and dimension, most active first, at most 25 per dimension.
 * `sessions` (by dim and key) is added where given. Sources sort by sessions,
 * pages by page views, everything else by product views, add to cart and
 * purchases.
 */
export function pivotDims(
  rows: readonly { dim: string; key: string; event_name: string; n: unknown; v: unknown }[],
  dims: readonly string[],
  sessions: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map()
): Record<string, DimRow[]> {
  const byDim = new Map<string, Map<string, DimRow>>()
  for (const dim of dims) byDim.set(dim, new Map())
  const rowFor = (dim: string, key: string): DimRow | null => {
    const table = byDim.get(dim)
    if (!table || !key) return null
    let row = table.get(key)
    if (!row) {
      row = blankRow(key, key)
      table.set(key, row)
    }
    return row
  }
  for (const entry of rows) {
    const field = ROW_FIELD[entry.event_name as EventKey]
    const row = field ? rowFor(entry.dim, String(entry.key ?? "")) : null
    if (!row || !field) continue
    ;(row[field] as number) += num(entry.n)
    if (entry.event_name === "Purchase") row.revenue += num(entry.v)
  }
  for (const [dim, counts] of sessions) {
    for (const [key, n] of counts) {
      const row = rowFor(dim, key)
      if (row) row.sessions = (row.sessions ?? 0) + n
    }
  }
  const result: Record<string, DimRow[]> = {}
  for (const [dim, table] of byDim) {
    const list = [...table.values()]
    for (const row of list) row.revenue = Math.round(row.revenue)
    const bySessions = dim === "source" || dim === "landing" || dim === "audience" || dim === "device_class"
    list.sort((a, b) => (bySessions ? (b.sessions ?? 0) - (a.sessions ?? 0) || b.page_views - a.page_views : 0)
      || b.product_views - a.product_views || b.add_to_cart - a.add_to_cart || b.purchases - a.purchases
      || b.page_views - a.page_views || a.key.localeCompare(b.key))
    result[dim] = list.slice(0, TABLE_ROWS)
  }
  return result
}

/** Labels: source classes in words, product titles for the top rows (else the handle in words), the rest as stored. */
export function labelRows(dim: string, rows: DimRow[], titles: ReadonlyMap<string, string> = new Map()): DimRow[] {
  for (const row of rows) {
    if (dim === "source") row.label = sourceLabel(row.key)
    else if (dim === "product") row.label = titles.get(row.key) ?? humanize(row.key)
    else if (dim === "landing") row.label = row.key
  }
  return rows
}

/** Pure: the recent-activity line of one hit; product events name the product, model and case, never a customer. */
export function recentLabel(hit: { event_name: string; handle?: string | null; device?: string | null; case_type?: string | null; items?: unknown },
  titles: ReadonlyMap<string, string> = new Map()): string {
  if (hit.event_name === "InitiateCheckout" || hit.event_name === "Purchase") {
    const items = num(hit.items)
    const what = hit.event_name === "Purchase" ? "Order placed" : "Checkout started"
    return items ? `${what}, ${items} item${items === 1 ? "" : "s"}` : what
  }
  const name = hit.handle ? titles.get(hit.handle) ?? humanize(hit.handle) : ""
  return [name, hit.device, hit.case_type].filter((part) => typeof part === "string" && part).join(" - ") || hit.event_name
}

/**
 * The host filter for `?host=`: empty gives the default (every host before
 * live sending is armed, the live hosts after), `all`/`test`/`live` give those
 * groups, a listed host gives that host. Null for anything else.
 */
export function resolveHostFilter(config: TrackingConfig, requested?: string | null): HostFilter | null {
  const clean = (list: string[]) => [...new Set(list.map(normHost).filter(Boolean))]
  const test = clean(config.test_hosts)
  const live = clean(config.live_hosts)
  const all: HostFilter = { key: "all", hosts: null, label: "All hosts" }
  const liveFilter: HostFilter = { key: "live", hosts: live, label: "Live hosts" }
  const raw = typeof requested === "string" ? requested.trim().toLowerCase() : ""
  if (!raw) return config.live_armed && live.length ? liveFilter : all
  if (raw === "all") return all
  if (raw === "live") return live.length ? liveFilter : null
  if (raw === "test") return test.length ? { key: "test", hosts: test, label: "Test hosts" } : null
  const host = normHost(raw)
  return test.includes(host) || live.includes(host) ? { key: `host:${host}`, hosts: [host], label: host } : null
}

function filterOptions(config: TrackingConfig): { value: string; label: string }[] {
  const options = [{ value: "all", label: "All hosts" }]
  if (config.live_hosts.length) options.push({ value: "live", label: "Live hosts" })
  if (config.test_hosts.length) options.push({ value: "test", label: "Test hosts" })
  for (const host of new Set([...config.test_hosts, ...config.live_hosts].map(normHost).filter(Boolean))) {
    options.push({ value: host, label: host })
  }
  return options
}

/** Pure: "Exclude this browser" links (TRACKING.md 4.2), one per test and live host. */
export function staffLinks(config: TrackingConfig, token: string): StaffLink[] {
  const links: StaffLink[] = []
  const seen = new Set<string>()
  const t = encodeURIComponent(token)
  for (const [list, hosts] of [["test", config.test_hosts], ["live", config.live_hosts]] as const) {
    for (const raw of hosts) {
      const host = normHost(raw)
      if (!host || seen.has(host)) continue
      seen.add(host)
      links.push({ host, list, url: `https://${host}/api/t/staff/?t=${t}&on=1`, off_url: `https://${host}/api/t/staff/?t=${t}&on=0` })
    }
  }
  return links
}

// ---------------------------------------------------------------- reads

async function eventTotals(db: Db, from: number, to: number, doneThrough: number | null, hosts: string[] | null): Promise<EventTotals> {
  const totals = emptyTotals()
  const split = rollupSplit(from, to, doneThrough)
  if (split > from) {
    const h = hostSql("host", hosts)
    addTotals(totals, rowsOf(await db.raw(
      `select event_name, sum(count)::int as n, coalesce(sum(value), 0)::float8 as v from tracking_minute
where bucket >= ? and bucket < ? and event_name in (${marks(EVENT_KEYS.length)})${h.sql}
group by event_name`,
      [new Date(from), new Date(split), ...EVENT_KEYS, ...h.bindings])))
  }
  if (to > split) {
    const h = hostSql("host", hosts)
    addTotals(totals, rowsOf(await db.raw(
      `select case when event_name = 'ViewContent' and (flags & 1) <> 0 then 'ProductView' else event_name end as event_name,
  count(*)::int as n, coalesce(sum(value), 0)::float8 as v
from tracking_hit where received_at >= ? and received_at < ? and (flags & 8) = 0${h.sql}
group by 1`,
      [new Date(split), new Date(to), ...h.bindings])))
  }
  return totals
}

/**
 * Distinct visitors and sessions of a Dhaka day up to `end`: the rolled-up
 * sessions of that day plus sessions only seen in the raw hits since the
 * watermark. Staff sessions are left out.
 */
async function people(db: Db, dayStart: number, end: number, doneThrough: number | null, hosts: string[] | null): Promise<{ visitors: number; sessions: number }> {
  const tailFrom = Math.max(dayStart, doneThrough ?? dayStart)
  const s = hostSql("host", hosts)
  const h = hostSql("h.host", hosts)
  const [row] = rowsOf(await db.raw(
    `select count(distinct nullif(visitor_id, ''))::int as visitors, count(distinct session_id)::int as sessions from (
  select visitor_id, session_id from tracking_session
  where day = ?::date and started_at < ? and (flags & 16) = 0${s.sql}
  union all
  select h.visitor_id, h.session_id from tracking_hit h
  where h.received_at >= ? and h.received_at < ? and (h.flags & 8) = 0 and h.session_id is not null${h.sql}
    and not exists (select 1 from tracking_session s where s.session_id = h.session_id)
) x`,
    [dhakaDay(dayStart), new Date(end), ...s.bindings, new Date(tailFrom), new Date(Math.max(tailFrom, end)), ...h.bindings]))
  return { visitors: num(row?.visitors), sessions: num(row?.sessions) }
}

async function liveNow(db: Db, now: number, hosts: string[] | null): Promise<LiveNow> {
  const h = hostSql("host", hosts)
  const since30 = new Date(now - 30 * MINUTE_MS)
  const base = `from tracking_hit where received_at >= ? and origin = 'b' and (flags & 8) = 0 and visitor_id is not null${h.sql}`
  const [totals] = rowsOf(await db.raw(
    `select (count(distinct visitor_id) filter (where received_at >= ?))::int as v5, count(distinct visitor_id)::int as v30 ${base}`,
    [new Date(now - 5 * MINUTE_MS), since30, ...h.bindings]))
  const sources = rowsOf(await db.raw(
    `select coalesce(nullif(source, ''), 'unknown') as source, count(distinct visitor_id)::int as visitors ${base}
group by 1 order by 2 desc, 1 limit 8`,
    [since30, ...h.bindings]))
  const pages = rowsOf(await db.raw(
    `select path, count(distinct visitor_id)::int as visitors ${base} and event_name = 'PageView' and path is not null
group by 1 order by 2 desc, 1 limit 8`,
    [since30, ...h.bindings]))
  return {
    visitors_5m: num(totals?.v5),
    visitors_30m: num(totals?.v30),
    by_source: sources.map((row) => ({ source: String(row.source), label: sourceLabel(String(row.source)), visitors: num(row.visitors) })),
    top_pages: pages.map((row) => ({ path: String(row.path), visitors: num(row.visitors) })),
  }
}

const FUNNEL_COLUMNS = `count(*)::int as sessions,
  (count(*) filter (where (flags & 1) <> 0))::int as vc,
  (count(*) filter (where (flags & 2) <> 0))::int as atc,
  (count(*) filter (where (flags & 4) <> 0))::int as ic,
  (count(*) filter (where (flags & 8) <> 0))::int as purchase`

async function funnel(db: Db, fromDay: string, toDay: string, hosts: string[] | null): Promise<LiveFunnel> {
  const h = hostSql("host", hosts)
  const [row] = rowsOf(await db.raw(
    `select ${FUNNEL_COLUMNS} from tracking_session where day >= ?::date and day <= ?::date and (flags & 16) = 0${h.sql}`,
    [fromDay, toDay, ...h.bindings]))
  return funnelOf(row)
}

async function sparkRows(db: Db, midnight: number, now: number, doneThrough: number | null, hosts: string[] | null) {
  const split = rollupSplit(midnight, now, doneThrough)
  const rows: { t5: unknown; event_name: string; n: unknown }[] = []
  if (split > midnight) {
    const h = hostSql("host", hosts)
    rows.push(...rowsOf(await db.raw(
      `select (floor(extract(epoch from bucket) / 300) * 300)::bigint as t5, event_name, sum(count)::int as n from tracking_minute
where bucket >= ? and bucket < ? and event_name in (${marks(EVENT_KEYS.length)})${h.sql}
group by 1, 2`,
      [new Date(midnight), new Date(split), ...EVENT_KEYS, ...h.bindings])))
  }
  if (now > split) {
    const h = hostSql("host", hosts)
    rows.push(...rowsOf(await db.raw(
      `select (floor(extract(epoch from received_at) / 300) * 300)::bigint as t5,
  case when event_name = 'ViewContent' and (flags & 1) <> 0 then 'ProductView' else event_name end as event_name, count(*)::int as n
from tracking_hit where received_at >= ? and received_at < ? and (flags & 8) = 0${h.sql}
group by 1, 2`,
      [new Date(split), new Date(now), ...h.bindings])))
  }
  return buildSpark(rows, midnight, now)
}

async function dimRows(db: Db, fromDay: string, toDay: string, dims: readonly string[], hosts: string[] | null) {
  const h = hostSql("host", hosts)
  return rowsOf(await db.raw(
    `select dim, key, event_name, sum(count)::int as n, coalesce(sum(value), 0)::float8 as v from tracking_day_dim
where day >= ?::date and day <= ?::date and dim in (${marks(dims.length)})${h.sql}
group by dim, key, event_name`,
    [fromDay, toDay, ...dims, ...h.bindings]))
}

/** Rolled-up sessions per source (and, for the report, per landing page, audience and device class). */
async function sessionCounts(db: Db, fromDay: string, toDay: string, dims: readonly ("source" | "landing" | "audience" | "device_class")[],
  hosts: string[] | null): Promise<Map<string, Map<string, number>>> {
  const expressions: Record<string, string> = {
    source: "coalesce(nullif(source, ''), 'unknown')",
    landing: "split_part(landing_path, chr(63), 1)",
    audience: "audience",
    device_class: "device_class",
  }
  const result = new Map<string, Map<string, number>>()
  for (const dim of dims) {
    const h = hostSql("host", hosts)
    const counts = new Map<string, number>()
    for (const row of rowsOf(await db.raw(
      `select ${expressions[dim]} as key, count(*)::int as n from tracking_session
where day >= ?::date and day <= ?::date and (flags & 16) = 0${h.sql} group by 1`,
      [fromDay, toDay, ...h.bindings]))) {
      if (typeof row.key === "string" && row.key) counts.set(row.key, num(row.n))
    }
    result.set(dim, counts)
  }
  return result
}

async function productTitles(container: any, handles: readonly string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const wanted = [...new Set(handles.filter(Boolean))]
  if (!wanted.length) return titles
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["handle", "title"],
    filters: { handle: wanted },
    pagination: { skip: 0, take: wanted.length },
  })
  for (const product of data ?? []) {
    if (typeof product?.handle === "string" && typeof product.title === "string" && product.title) titles.set(product.handle, product.title)
  }
  return titles
}

async function recentHits(db: Db, now: number, hosts: string[] | null) {
  const h = hostSql("host", hosts)
  return rowsOf(await db.raw(
    `select event_name, handle, device, case_type, source, host, value, items, flags, received_at from tracking_hit
where received_at >= ? and event_name <> 'PageView'${h.sql}
order by received_at desc limit 20`,
    [new Date(now - DAY_MS), ...h.bindings]))
}

/**
 * One order's facts, drafts left out: its order_op row (imported orders are
 * dropped, the manager's cancellations seen) and the total Medusa stores in
 * order_summary for the order's current version (current_order_total, the
 * same figure as the computed `total`; order edits write a new version).
 */
const ORDER_COLUMNS = `select o.id, o.created_at, o.canceled_at, o.is_draft_order, op.source, op.workflow_status,
  (select case when jsonb_typeof(s.totals->'current_order_total') = 'number' then (s.totals->>'current_order_total')::float8 end
    from order_summary s where s.order_id = o.id and s.deleted_at is null and s.version <= o.version
    order by s.version desc limit 1) as total
from "order" o left join order_op op on op.order_id = o.id and op.deleted_at is null
where o.deleted_at is null and o.is_draft_order is not true`

/** Orders placed in [from, to) (to open-ended when null), in one query. */
async function loadOrders(db: Db, from: number, to: number | null): Promise<OrderFact[]> {
  const bindings: unknown[] = [new Date(from)]
  if (to !== null) bindings.push(new Date(to))
  bindings.push(MAX_ORDERS)
  const rows = rowsOf(await db.raw(
    `${ORDER_COLUMNS} and o.created_at >= ?${to !== null ? " and o.created_at < ?" : ""}
order by o.created_at limit ?`,
    bindings as any[]))
  const ops = new Map<string, { source: string | null; workflow_status: string | null }>()
  for (const row of rows) ops.set(row.id, { source: row.source ?? null, workflow_status: row.workflow_status ?? null })
  return orderFacts(rows, ops)
}

/** Which of these orders are cancelled now (canceled_at, or the order manager's status). */
async function cancelledNow(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = rowsOf(await db.raw(
    `select o.id from "order" o left join order_op op on op.order_id = o.id and op.deleted_at is null
where o.id in (select jsonb_array_elements_text(?::jsonb)) and (o.canceled_at is not null or op.workflow_status = 'cancelled')`,
    [JSON.stringify(ids)]))
  return new Set(rows.map((row) => String(row.id)))
}

let historyCache: { midnight: number; at: number; orders: Promise<OrderFact[]> } | null = null

/**
 * The 7 Dhaka days before today (pace and yesterday). Those orders are all
 * placed, so they are read once per Dhaka day; every 5 minutes only their
 * cancellations are read again (by id).
 */
function orderHistory(db: Db, midnight: number, now: number): Promise<OrderFact[]> {
  const cached = historyCache
  if (cached && cached.midnight === midnight && now - cached.at < HISTORY_PATCH_MS) return cached.orders
  const orders = cached && cached.midnight === midnight
    ? cached.orders.then(async (facts) => {
      const cancelled = await cancelledNow(db, facts.map((fact) => fact.id))
      return facts.map((fact) => ({ ...fact, cancelled: cancelled.has(fact.id) }))
    })
    : loadOrders(db, midnight - 7 * DAY_MS, midnight)
  const entry = { midnight, at: now, orders }
  historyCache = entry
  // A failed read is not kept: the next poll reads the whole history again.
  entry.orders.catch(() => { if (historyCache === entry) historyCache = null })
  return entry.orders
}

const sharedReads = new Map<string, { until: number; value: Promise<unknown> }>()

/** One read per key shared for `ttlMs`; a failed read is not kept. */
function sharedRead<T>(key: string, now: number, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const cached = sharedReads.get(key)
  if (cached && now < cached.until) return cached.value as Promise<T>
  for (const [other, entry] of sharedReads) if (now >= entry.until) sharedReads.delete(other)
  const entry = { until: now + ttlMs, value: read() as Promise<unknown> }
  sharedReads.set(key, entry)
  entry.value.catch(() => { if (sharedReads.get(key) === entry) sharedReads.delete(key) })
  return entry.value as Promise<T>
}

async function unknownToday(db: Db, midnight: number, hosts: string[] | null): Promise<number> {
  const h = hostSql("host", hosts)
  const [row] = rowsOf(await db.raw(
    `select count(*)::int as n from tracking_hit where received_at >= ? and (flags & 64) <> 0${h.sql}`,
    [new Date(midnight), ...h.bindings]))
  return num(row?.n)
}

// ---------------------------------------------------------------- Live

function counts(events: EventTotals, visitors: { visitors: number; sessions: number }, orders: OrderSummary,
  target: number, pace: number | null): LiveCounts {
  return {
    visitors: visitors.visitors,
    sessions: visitors.sessions,
    page_views: events.PageView.n,
    product_views: events.ProductView.n,
    add_to_cart: events.AddToCart.n,
    initiate_checkout: events.InitiateCheckout.n,
    web_purchases: events.Purchase.n,
    revenue_web: Math.round(events.Purchase.v),
    orders_all: orders.orders_all,
    orders_cancelled: orders.orders_cancelled,
    revenue_all: orders.revenue_all,
    aov: orders.aov,
    target,
    pace_projection: pace,
  }
}

const NO_ORDERS: OrderSummary = { orders_all: 0, orders_cancelled: 0, net: 0, revenue_all: 0, aov: 0 }

async function buildLive(container: any, config: TrackingConfig, filter: HostFilter, now: number): Promise<LivePayload> {
  const db = trackingDb(container)
  const errors: string[] = []
  async function part<T>(name: string, fallback: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch {
      errors.push(`${name} could not be read`)
      return fallback
    }
  }
  const hosts = filter.hosts
  const midnight = dhakaMidnight(now)
  const yesterday = midnight - DAY_MS
  const day = dhakaDay(now)
  const target = config.dashboard.daily_order_target

  const watermark = await part("rollup watermark", null as Watermark | null, () => getState<Watermark>(db, WATERMARK_KEY))
  const done = time(watermark?.done_through)
  const lag = rollupLagSeconds(watermark?.done_through, now)
  if (lag === null || lag > LAG_KICK_S) kickStaleJobs(container)

  const nowBlock = await part("live visitors", { visitors_5m: 0, visitors_30m: 0, by_source: [], top_pages: [] } as LiveNow,
    () => liveNow(db, now, hosts))
  const todayEvents = await part("today's events", emptyTotals(), () => eventTotals(db, midnight, now, done, hosts))
  const todayPeople = await part("today's visitors", { visitors: 0, sessions: 0 }, () => people(db, midnight, now, done, hosts))
  const pastEvents = await part("yesterday's events", emptyTotals(), () => eventTotals(db, yesterday, now - DAY_MS, done, hosts))
  const pastPeople = await part("yesterday's visitors", { visitors: 0, sessions: 0 }, () => people(db, yesterday, now - DAY_MS, done, hosts))
  const todayOrders = await part("today's orders", null as OrderFact[] | null, () => loadOrders(db, midnight, null))
  const history = await part("the last 7 days of orders", null as OrderFact[] | null, () => orderHistory(db, midnight, now))
  const today = todayOrders ? summarizeOrders(todayOrders, midnight, Number.POSITIVE_INFINITY) : NO_ORDERS
  const past = history ? summarizeOrders(history, yesterday, now - DAY_MS) : NO_ORDERS
  const pace = history ? paceProjection(today.net, history, now) : null

  const funnelToday = await part("the funnel", funnelOf(undefined), () => funnel(db, day, day, hosts))
  const spark = await part("the sparkline", buildSpark([], midnight, now), () => sparkRows(db, midnight, now, done, hosts))
  const tableDims = ["source", "product", "device", "case_type"]
  const pivot = await part("today's tables", pivotDims([], tableDims), async () =>
    pivotDims(await dimRows(db, day, day, tableDims, hosts), tableDims, await sessionCounts(db, day, day, ["source"], hosts)))
  const recent = await part("recent activity", [] as any[], () => recentHits(db, now, hosts))
  const handles = [...(pivot.product ?? []).slice(0, NAMED_ROWS).map((row) => row.key),
    ...recent.map((hit) => hit.handle).filter((handle): handle is string => typeof handle === "string")]
  const titles = await part("product names", new Map<string, string>(), () => productTitles(container, handles))

  // The outbox counts scan tracking_event and the unknown ids a day of hits: both change slowly, so 60 s old is fine.
  const health: LiveHealth = {
    outbox: await part<LiveHealth["outbox"]>("the outbox", null, () => outboxHealth(container, { maxAgeMs: HEALTH_CACHE_MS })),
    jobs: await part<LiveHealth["jobs"]>("the jobs", null, () => jobStates(container)),
    rollup_lag_s: lag,
    watermark: watermark?.done_through ?? null,
    feed: await part<LiveHealth["feed"]>("the catalog feed", null,
      async () => ({ builds: await feedMeta(container), last_fetch: await lastFeedFetches(container) })),
    variant_index: await part<LiveHealth["variant_index"]>("the variant index", null,
      () => getState<VariantIndexState>(db, "variant_index")),
    unknown_content_ids_today: await part<number | null>("unknown content ids", null,
      () => sharedRead(`unknown:${filter.key}:${midnight}`, now, HEALTH_CACHE_MS, () => unknownToday(db, midnight, hosts))),
  }

  return {
    generated_at: new Date(now).toISOString(),
    day,
    filter: { ...filter, options: filterOptions(config) },
    poll_seconds: config.dashboard.poll_seconds,
    now: nowBlock,
    today: counts(todayEvents, todayPeople, today, target, pace),
    yesterday_same_time: counts(pastEvents, pastPeople, past, target, null),
    funnel: funnelToday,
    spark,
    tables: {
      sources: labelRows("source", pivot.source ?? []),
      products: labelRows("product", pivot.product ?? [], titles),
      devices: labelRows("device", pivot.device ?? []),
      case_types: labelRows("case_type", pivot.case_type ?? []),
    },
    recent: recent.map((hit): RecentHit => ({
      event: String(hit.event_name),
      label: recentLabel(hit, titles),
      source: typeof hit.source === "string" && hit.source ? hit.source : null,
      source_label: typeof hit.source === "string" && hit.source ? sourceLabel(hit.source) : null,
      host: String(hit.host ?? ""),
      value: hit.value === null || hit.value === undefined ? null : Math.round(num(hit.value)),
      internal: (num(hit.flags) & 8) !== 0,
      ago_s: Math.max(0, Math.round((now - (time(hit.received_at) ?? now)) / 1000)),
    })),
    health,
    errors,
  }
}

/** The saved settings, or the defaults when they cannot be read (the page still renders). */
async function settingsOrDefaults(container: any): Promise<{ config: TrackingConfig; ok: boolean }> {
  try {
    return { config: (await loadTrackingSettings(container)).config, ok: true }
  } catch {
    return { config: parseTrackingConfig(null), ok: false }
  }
}

const liveCache = new Map<string, { at: number; value: Promise<LivePayload> }>()

/**
 * GET /admin/tracking/live. One result per host filter is shared for
 * poll_seconds (at least 10 s), so any number of open Live tabs cost one
 * computation per poll. Throws LiveInputError for an unknown `host`.
 */
export async function computeLive(container: any, options: { host?: string | null } = {}): Promise<LivePayload> {
  const { config, ok } = await settingsOrDefaults(container)
  const filter = resolveHostFilter(config, options.host)
  if (!filter) throw new LiveInputError("Pick one of the listed hosts, or all hosts.")
  const now = Date.now()
  const cacheMs = Math.max(LIVE_CACHE_MS, config.dashboard.poll_seconds * 1000)
  const cached = liveCache.get(filter.key)
  if (cached && now - cached.at < cacheMs) return cached.value
  const entry = {
    at: now,
    value: buildLive(container, config, filter, now).then((payload) => {
      if (!ok) payload.errors.unshift("the tracking settings could not be read (defaults shown)")
      return payload
    }),
  }
  liveCache.set(filter.key, entry)
  // A failed build is not shared; the caller still sees the error.
  entry.value.catch(() => { if (liveCache.get(filter.key) === entry) liveCache.delete(filter.key) })
  return entry.value
}

// ---------------------------------------------------------------- report

export function isReportRange(value: unknown): value is ReportRange {
  return value === "7d" || value === "30d"
}

/** Pure: one row per Dhaka day from the source-dim totals and the session counts, oldest first, zeros for empty days. */
export function reportDays(fromDay: string, toDay: string,
  events: readonly { day: string; event_name: string; n: unknown; v: unknown }[],
  sessions: readonly { day: string; sessions: unknown; visitors: unknown }[]): ReportDay[] {
  const days = new Map<string, ReportDay>()
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    days.set(day, { day, visitors: 0, sessions: 0, page_views: 0, product_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0, revenue: 0 })
  }
  for (const row of events) {
    const entry = days.get(String(row.day).slice(0, 10))
    const field = ROW_FIELD[row.event_name as EventKey]
    if (!entry || !field) continue
    ;(entry[field as keyof ReportDay] as number) += num(row.n)
    if (row.event_name === "Purchase") entry.revenue += num(row.v)
  }
  for (const row of sessions) {
    const entry = days.get(String(row.day).slice(0, 10))
    if (!entry) continue
    entry.sessions += num(row.sessions)
    entry.visitors += num(row.visitors)
  }
  const list = [...days.values()]
  for (const entry of list) entry.revenue = Math.round(entry.revenue)
  return list
}

async function buildReport(container: any, range: ReportRange, filter: HostFilter, now: number): Promise<ReportPayload> {
  const db = trackingDb(container)
  const errors: string[] = []
  async function part<T>(name: string, fallback: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch {
      errors.push(`${name} could not be read`)
      return fallback
    }
  }
  const hosts = filter.hosts
  const span = range === "7d" ? 7 : 30
  const toDay = dhakaDay(now)
  const fromDay = dhakaDay(now - (span - 1) * DAY_MS)
  const h = hostSql("host", hosts)

  const events = await part("daily events", [] as any[], async () => rowsOf(await db.raw(
    `select day::text as day, event_name, sum(count)::int as n, coalesce(sum(value), 0)::float8 as v from tracking_day_dim
where dim = 'source' and day >= ?::date and day <= ?::date${h.sql}
group by 1, 2`,
    [fromDay, toDay, ...h.bindings])))
  const sessions = await part("daily sessions", [] as any[], async () => rowsOf(await db.raw(
    `select day::text as day, count(*)::int as sessions, count(distinct nullif(visitor_id, ''))::int as visitors from tracking_session
where day >= ?::date and day <= ?::date and (flags & 16) = 0${h.sql}
group by 1`,
    [fromDay, toDay, ...h.bindings])))
  const [whole] = await part("visitors", [] as any[], async () => rowsOf(await db.raw(
    `select count(distinct nullif(visitor_id, ''))::int as visitors from tracking_session
where day >= ?::date and day <= ?::date and (flags & 16) = 0${h.sql}`,
    [fromDay, toDay, ...h.bindings])))
  const funnelRange = await part("the funnel", funnelOf(undefined), () => funnel(db, fromDay, toDay, hosts))
  const dims = ["source", "product", "device", "case_type", "audience", "device_class", "landing"]
  const pivot = await part("the tables", pivotDims([], dims), async () => pivotDims(
    await dimRows(db, fromDay, toDay, dims, hosts), dims,
    await sessionCounts(db, fromDay, toDay, ["source", "landing", "audience", "device_class"], hosts)))
  const titles = await part("product names", new Map<string, string>(),
    () => productTitles(container, (pivot.product ?? []).slice(0, NAMED_ROWS).map((row) => row.key)))

  const days = reportDays(fromDay, toDay, events, sessions)
  const totals: ReportDay = { day: `${fromDay}..${toDay}`, visitors: num(whole?.visitors), sessions: 0, page_views: 0, product_views: 0,
    add_to_cart: 0, initiate_checkout: 0, purchases: 0, revenue: 0 }
  for (const entry of days) {
    totals.sessions += entry.sessions
    totals.page_views += entry.page_views
    totals.product_views += entry.product_views
    totals.add_to_cart += entry.add_to_cart
    totals.initiate_checkout += entry.initiate_checkout
    totals.purchases += entry.purchases
    totals.revenue += entry.revenue
  }
  return {
    generated_at: new Date(now).toISOString(),
    range,
    from_day: fromDay,
    to_day: toDay,
    filter,
    days,
    totals,
    funnel: funnelRange,
    tables: {
      sources: labelRows("source", pivot.source ?? []),
      products: labelRows("product", pivot.product ?? [], titles),
      devices: labelRows("device", pivot.device ?? []),
      case_types: labelRows("case_type", pivot.case_type ?? []),
      audiences: labelRows("audience", pivot.audience ?? []),
      device_classes: labelRows("device_class", pivot.device_class ?? []),
      landing: labelRows("landing", pivot.landing ?? []),
    },
    errors,
  }
}

const reportCache = new Map<string, { at: number; value: Promise<ReportPayload> }>()

/**
 * GET /admin/tracking/report: the last 7 or 30 Dhaka days (today included,
 * up to the last rollup) from tracking_day_dim and tracking_session, shared
 * for 5 minutes per range and host filter.
 */
export async function computeReport(container: any, range: ReportRange, options: { host?: string | null } = {}): Promise<ReportPayload> {
  const { config } = await settingsOrDefaults(container)
  const filter = resolveHostFilter(config, options.host)
  if (!filter) throw new LiveInputError("Pick one of the listed hosts, or all hosts.")
  const key = `${range}:${filter.key}`
  const now = Date.now()
  const cached = reportCache.get(key)
  if (cached && now - cached.at < REPORT_CACHE_MS) return cached.value
  const entry = { at: now, value: buildReport(container, range, filter, now) }
  reportCache.set(key, entry)
  entry.value.catch(() => { if (reportCache.get(key) === entry) reportCache.delete(key) })
  return entry.value
}
