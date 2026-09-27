import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { emailConfigured, sendEmail } from "../send-email"
import { getState, setState, trackingDb } from "./db"
import { purchaseEventId } from "./event-ids"
import { lastErrorKey, type OutboxLastError } from "./health"
import { jobStates, TRACKING_JOB_NAMES, type TrackingJobName } from "./jobs"
import { loadTrackingSettings, type Env, type TrackingConfig } from "./settings"

/**
 * Tracking alerts by email (TRACKING.md section 10). checkAlerts() runs every
 * minute from the outbox job: each check below reads the outbox, counters,
 * hits, contexts or job states and says whether its problem is present now.
 * An alert opens with one email, repeats at most every `alerts.repeat_hours`
 * while it stays, and sends one recovery email when it clears; the state
 * lives in tracking_state `alert:<kind>` (per platform where the kind is per
 * platform, e.g. `alert:token:meta:live`). Only this file emails: other
 * packages write state it reads (catalog:alert, rollup:watermark, job:*).
 *
 * Emails carry counts and the admin link, never a token or customer data.
 * With alerts switched off nothing is checked or sent; without email
 * configured the checks still run and the Health page shows the warning.
 * Raw SQL through the PG_CONNECTION knex is the documented exception of
 * lib/tracking/db.ts; every value is a binding.
 */

type Db = Knex | Knex.Transaction
type OutboxPlatform = "meta" | "tiktok"

export type AlertKind =
  | "token"
  | "payload"
  | "send_failures"
  | "checkout_without_tracking"
  | "purchase_not_enqueued"
  | "edge_missing"
  | "no_purchase"
  | "sweep_stale"
  | "rollup_lag"
  | "live_disarmed"
  | "unknown_variants"
  | "feed_guard"
  | "feed_error"
  | "feed_not_fetched"

export type AlertState = {
  open: boolean
  title: string
  /** When the problem was first seen in this episode. */
  since: string | null
  last_sent_at: string | null
  last_try_at: string | null
}

/** One check's verdict for one alert key. `silent` closes an open alert without a recovery email. */
export type AlertFinding = { key: string; kind: AlertKind; active: boolean; title: string; lines: string[]; silent?: boolean }

export type AlertRun = {
  at: string
  disabled?: boolean
  sent: string[]
  recovered: string[]
  open: string[]
  /** Alerts (or recoveries) that are due but could not be emailed. */
  pending: string[]
  warning: string | null
  errors: string[]
}

type CheckContext = { container: any; db: Db; config: TrackingConfig; now: number }

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const RETRY_FAILED_EMAIL_MS = 15 * MINUTE_MS
const PLATFORMS: readonly OutboxPlatform[] = ["meta", "tiktok"]
const ENVS: readonly Env[] = ["test", "live"]
const LABEL: Record<OutboxPlatform, string> = { meta: "Meta", tiktok: "TikTok" }
const NO_PURCHASE_MIN_AVERAGE = 4.6
const PAYLOAD_FAILED_MIN = 10
const RETRY_BACKLOG_MIN = 50
const UNTRUSTED_MIN = 50
const UNKNOWN_VARIANT_MIN_HITS = 50
const UNKNOWN_VARIANT_SHARE = 0.2
const ROLLUP_LAG_MS = 10 * MINUTE_MS
const FEED_FETCH_MAX_AGE_MS = 36 * HOUR_MS
const DHAKA_OFFSET_MS = 6 * HOUR_MS

/** staleAfterMs of each job (6.4); a job is stale after max(10 min, 3 x this). */
export const JOB_STALE_AFTER_MS: Record<TrackingJobName, number> = {
  outbox: 180_000,
  rollup: 180_000,
  reconcile: 900_000,
  catalog: 2_700_000,
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Epoch ms of a Date (pg timestamptz), an ISO string or a number; NaN otherwise. */
function time(value: unknown): number {
  const ms = typeof (value as Date | null)?.getTime === "function"
    ? (value as Date).getTime()
    : typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : NaN
  return Number.isFinite(ms) ? ms : NaN
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function marks(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ")
}

async function rows(db: Db, sql: string, bindings: unknown[] = []): Promise<any[]> {
  const result: any = await db.raw(sql, bindings as any[])
  return result?.rows ?? []
}

/** Counter sums over the current and the previous hourly bucket (covers at least the last 60 minutes). */
async function recentCounters(db: Db, keys: string[]): Promise<Record<string, number>> {
  const sums: Record<string, number> = {}
  if (!keys.length) return sums
  for (const row of await rows(db,
    `select key, sum(n)::bigint as n from tracking_counter where hour >= date_trunc('hour', now()) - interval '1 hour' and key in (${marks(keys)}) group by key`,
    keys)) {
    sums[row.key] = num(row.n)
  }
  return sums
}

/** The Asia/Dhaka hour (UTC+6, no daylight saving) of an instant. */
export function dhakaHour(now: number): number {
  return new Date(now + DHAKA_OFFSET_MS).getUTCHours()
}

function anyPlatformOn(config: TrackingConfig): boolean {
  return config.meta.enabled || config.tiktok.enabled || config.google.enabled
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------- the checks

/** token: a row became blocked in the last hour (rejected token or permission, or no token) for an enabled platform. */
async function checkToken(ctx: CheckContext): Promise<AlertFinding[]> {
  const recent = await rows(ctx.db,
    `select platform, env, count(*)::int as n, count(*) filter (where last_error = 'no token')::int as missing
from tracking_event where status = 'blocked' and created_at >= now() - interval '1 hour' group by platform, env`)
  const counters = await recentCounters(ctx.db, PLATFORMS.flatMap((p) => ENVS.map((e) => `outbox.blocked.${p}.${e}`)))
  const findings: AlertFinding[] = []
  for (const platform of PLATFORMS) {
    for (const env of ENVS) {
      const row = recent.find((r) => r.platform === platform && r.env === env)
      const sendTime = counters[`outbox.blocked.${platform}.${env}`] ?? 0
      const n = Math.max(num(row?.n), sendTime)
      const state = await getState<OutboxLastError>(ctx.db, lastErrorKey(platform, env))
      const last = state?.status === "blocked" ? state : null
      // Rows enqueued without a token say "no token"; anything else blocked was refused by the platform.
      const rejected = num(row?.n) > num(row?.missing) || (sendTime > 0 && Boolean(last) && last?.code !== "no token")
      const where = env === "live" ? "live" : "TEST"
      const title = `${LABEL[platform]} token ${rejected ? "rejected" : "missing"} (${env})`
      const lines = [`${plural(n, "event")} for the ${LABEL[platform]} ${where} destination ${n === 1 ? "was" : "were"} blocked in the last hour.`]
      if (!rejected) lines.push(`No working ${LABEL[platform]} ${where} token is saved. Paste it in Admin > Tracking.`)
      else if (last) lines.push(`Last answer: ${last.cls}, ${last.code}${last.trace_id ? `, trace ${last.trace_id}` : ""}.`)
      lines.push("Blocked orders are sent automatically once a working token is saved (within 6 days).")
      findings.push({ key: `token:${platform}:${env}`, kind: "token", active: ctx.config[platform].enabled && n > 0, title, lines })
    }
  }
  return findings
}

/** payload: at least 10 rows of a platform failed in the last hour. */
async function checkPayload(ctx: CheckContext): Promise<AlertFinding[]> {
  const counters = await recentCounters(ctx.db, PLATFORMS.flatMap((p) => ENVS.map((e) => `outbox.failed.${p}.${e}`)))
  return PLATFORMS.map((platform) => {
    const n = ENVS.reduce((sum, env) => sum + (counters[`outbox.failed.${platform}.${env}`] ?? 0), 0)
    return {
      key: `payload:${platform}`,
      kind: "payload",
      active: ctx.config[platform].enabled && n >= PAYLOAD_FAILED_MIN,
      title: `${LABEL[platform]} is rejecting events`,
      lines: [`${plural(n, "event")} failed for good in the last hour. Tracking > Health shows the last error.`],
    }
  })
}

/** send_failures: at least 50 rows of a platform still waiting to be retried after 30 minutes. */
async function checkSendFailures(ctx: CheckContext): Promise<AlertFinding[]> {
  const backlog = await rows(ctx.db,
    "select platform, count(*)::int as n from tracking_event where status = 'retry' and created_at < now() - interval '30 minutes' group by platform")
  return PLATFORMS.map((platform) => {
    const n = num(backlog.find((r) => r.platform === platform)?.n)
    return {
      key: `send_failures:${platform}`,
      kind: "send_failures",
      active: ctx.config[platform].enabled && n >= RETRY_BACKLOG_MIN,
      title: `${LABEL[platform]} sends keep failing`,
      lines: [`${plural(n, "event")} older than 30 minutes ${n === 1 ? "is" : "are"} still waiting to be sent (network or ${LABEL[platform]} errors).`],
    }
  })
}

/**
 * checkout_without_tracking (B10): a storefront order (checkout quote version
 * set, not a draft, not imported) from the last hour, older than 5 minutes,
 * has no tracking_order_context; or the checkout header was rejected.
 */
async function checkCheckoutWithoutTracking(ctx: CheckContext): Promise<AlertFinding[]> {
  const title = "Orders placed without tracking"
  if (!anyPlatformOn(ctx.config)) return [{ key: "checkout_without_tracking", kind: "checkout_without_tracking", active: false, title, lines: [] }]
  const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "is_draft_order", "metadata"],
    filters: { created_at: { $gte: new Date(ctx.now - HOUR_MS), $lte: new Date(ctx.now - 5 * MINUTE_MS) } },
  })
  const storefront = (data ?? [])
    .filter((order: any) => order?.id && order.is_draft_order !== true && order.metadata?.checkout_quote_version)
    .map((order: any) => String(order.id))
  let missing = 0
  if (storefront.length) {
    const imported = new Set((await rows(ctx.db,
      `select order_id from order_op where order_id in (${marks(storefront)}) and source is not null and deleted_at is null`, storefront))
      .map((r) => r.order_id))
    const tracked = new Set((await rows(ctx.db,
      `select order_id from tracking_order_context where order_id in (${marks(storefront)})`, storefront))
      .map((r) => r.order_id))
    missing = storefront.filter((id: string) => !imported.has(id) && !tracked.has(id)).length
  }
  const rejected = (await recentCounters(ctx.db, ["checkout.header_rejected"]))["checkout.header_rejected"] ?? 0
  const lines: string[] = []
  if (missing) lines.push(`${plural(missing, "order")} from the last hour ${missing === 1 ? "has" : "have"} no tracking data, so ${missing === 1 ? "its" : "their"} Purchase cannot be sent.`)
  if (rejected) lines.push(`The checkout tracking header was rejected ${plural(rejected, "time")} in the last hour: TRACKING_INGEST_SECRET probably differs between the shop and the backend.`)
  return [{ key: "checkout_without_tracking", kind: "checkout_without_tracking", active: missing > 0 || rejected > 0, title, lines }]
}

/**
 * purchase_not_enqueued (B10): a trusted order context from the last 3 h
 * (older than 10 min) has no Purchase row for an enabled platform. The lookup
 * names the enabled platforms, the leading column of tracking_event_key
 * (platform, event_name, event_id), so it is a few index probes instead of a
 * scan of the whole outbox every minute.
 */
async function checkPurchaseNotEnqueued(ctx: CheckContext): Promise<AlertFinding[]> {
  const title = "Purchases not queued for the ad platforms"
  const enabled = PLATFORMS.filter((platform) => ctx.config[platform].enabled)
  if (!enabled.length) return [{ key: "purchase_not_enqueued", kind: "purchase_not_enqueued", active: false, title, lines: [] }]
  const contexts = await rows(ctx.db,
    `select order_id, display_id from tracking_order_context
where trusted and not staff and not optout and env is not null
  and created_at >= now() - interval '3 hours' and created_at < now() - interval '10 minutes'`)
  const ids = contexts.map((c) => purchaseEventId(c.display_id)).filter((id): id is string => Boolean(id))
  let missing = 0
  if (ids.length) {
    const present = new Set((await rows(ctx.db,
      `select platform, event_id from tracking_event
where platform in (${marks(enabled)}) and event_name = 'Purchase' and event_id in (${marks(ids)})`, [...enabled, ...ids]))
      .map((r) => `${r.platform}:${r.event_id}`))
    missing = ids.filter((id) => enabled.some((platform) => !present.has(`${platform}:${id}`))).length
  }
  return [{
    key: "purchase_not_enqueued",
    kind: "purchase_not_enqueued",
    active: missing > 0,
    title,
    lines: [`${plural(missing, "order")} from the last 3 hours ${missing === 1 ? "has" : "have"} tracking data but no Purchase queued for ${enabled.map((p) => LABEL[p]).join(" and ")}. The 5-minute reconcile job should add ${missing === 1 ? "it" : "them"}; check its state on Tracking > Health.`],
  }]
}

/** edge_missing: requests without the Cloudflare edge header while a platform is on. */
async function checkEdgeMissing(ctx: CheckContext): Promise<AlertFinding[]> {
  const title = "Tracking requests are not coming through Cloudflare"
  if (!anyPlatformOn(ctx.config)) return [{ key: "edge_missing", kind: "edge_missing", active: false, title, lines: [] }]
  const counters = await recentCounters(ctx.db, ["sf.untrusted", "checkout.untrusted"])
  const untrusted = counters["sf.untrusted"] ?? 0
  const checkout = counters["checkout.untrusted"] ?? 0
  return [{
    key: "edge_missing",
    kind: "edge_missing",
    active: untrusted >= UNTRUSTED_MIN || checkout >= 1,
    title,
    lines: [
      `In the last hour ${plural(untrusted, "tracking request")} and ${plural(checkout, "checkout")} arrived without a valid x-florayn-edge header, so nothing from them was sent to the ad platforms.`,
      "Check the Cloudflare Transform Rule and that TRACKING_EDGE_SECRET matches it.",
    ],
  }]
}

/**
 * no_purchase (I5): only while live sending is armed and between the active
 * hours in Dhaka; zero Purchase hits from the live hosts in the window while
 * the same window averaged at least 4.6 over the last 14 days (so zero has
 * under a 1% chance). No verdict outside the hours, so an open alert waits
 * for the next Purchase instead of "recovering" at midnight.
 */
async function checkNoPurchase(ctx: CheckContext): Promise<AlertFinding[]> {
  const { alerts, live_armed: armed, live_hosts: hosts } = ctx.config
  const hours = alerts.no_purchase_hours
  const title = `No purchases on the live site for ${plural(hours, "hour")}`
  const base = { key: "no_purchase", kind: "no_purchase" as const, title }
  if (!armed || !hosts.length) return [{ ...base, active: false, lines: [], silent: true }]
  const hour = dhakaHour(ctx.now)
  if (hour < alerts.active_from_hour || hour >= alerts.active_to_hour) return []
  const [recent] = await rows(ctx.db,
    `select count(*)::int as n from tracking_hit
where event_name = 'Purchase' and received_at >= now() - ?::float8 * interval '1 hour' and flags & 8 = 0 and host in (${marks(hosts)})`,
    [hours, ...hosts])
  if (num(recent?.n) > 0) return [{ ...base, active: false, lines: [] }]
  const [history] = await rows(ctx.db,
    `select coalesce(sum(m.count), 0)::float8 as total
from generate_series(1, 14) as d(n)
join tracking_minute m on m.event_name = 'Purchase' and m.host in (${marks(hosts)})
  and m.bucket >= now() - d.n * interval '1 day' - ?::float8 * interval '1 hour'
  and m.bucket < now() - d.n * interval '1 day'`,
    [...hosts, hours])
  const average = num(history?.total) / 14
  if (average < NO_PURCHASE_MIN_AVERAGE) return []
  return [{
    ...base,
    active: true,
    lines: [`The live site recorded no Purchase in the last ${plural(hours, "hour")}. The same hours averaged ${average.toFixed(1)} purchases over the last 14 days.`,
      "Check that checkout works, then the Live page and Tracking > Health."],
  }]
}

/** sweep_stale: a tracking job that has run before has not run for max(10 min, 3 x its staleAfterMs). */
async function checkSweepStale(ctx: CheckContext): Promise<AlertFinding[]> {
  const states = await jobStates(ctx.container)
  const stale: string[] = []
  for (const name of TRACKING_JOB_NAMES) {
    const lastRun = time(states[name]?.last_run_at)
    if (!Number.isFinite(lastRun)) continue
    const limit = Math.max(10 * MINUTE_MS, 3 * JOB_STALE_AFTER_MS[name])
    if (ctx.now - lastRun > limit) stale.push(`${name} (last run ${Math.round((ctx.now - lastRun) / MINUTE_MS)} minutes ago)`)
  }
  return [{
    key: "sweep_stale",
    kind: "sweep_stale",
    active: stale.length > 0,
    title: "Tracking jobs stopped running",
    lines: [`Not running: ${stale.join(", ") || "none"}.`, "Opening Tracking > Health restarts them in the server; if they stay stale, restart the backend."],
  }]
}

/** rollup_lag: the Live dashboard rollup is more than 10 minutes behind. */
async function checkRollupLag(ctx: CheckContext): Promise<AlertFinding[]> {
  const watermark = await getState<{ done_through?: string }>(ctx.db, "rollup:watermark")
  const done = time(watermark?.done_through)
  if (!Number.isFinite(done)) return []
  const lag = ctx.now - done
  return [{
    key: "rollup_lag",
    kind: "rollup_lag",
    active: lag > ROLLUP_LAG_MS,
    title: "Live dashboard numbers are behind",
    lines: [`The dashboard rollup is ${Math.round(lag / MINUTE_MS)} minutes behind.`],
  }]
}

/** live_disarmed: the live hosts sent hits in the last hour while live sending is off (they go to TEST). */
async function checkLiveDisarmed(ctx: CheckContext): Promise<AlertFinding[]> {
  const title = "Live site traffic while live sending is off"
  const hosts = ctx.config.live_hosts
  if (ctx.config.live_armed || !hosts.length) return [{ key: "live_disarmed", kind: "live_disarmed", active: false, title, lines: [] }]
  const [row] = await rows(ctx.db,
    `select count(*)::int as n from tracking_hit where received_at >= now() - interval '1 hour' and host in (${marks(hosts)})`, hosts)
  const n = num(row?.n)
  return [{
    key: "live_disarmed",
    kind: "live_disarmed",
    active: n > 0,
    title,
    lines: [`${hosts.join(", ")} recorded ${plural(n, "event")} in the last hour, but "Allow live sending" is off, so they go to the TEST destinations.`],
  }]
}

/** unknown_variants: at least 50 product hits in the last hour and over 20% with a variant id the index does not know. */
async function checkUnknownVariants(ctx: CheckContext): Promise<AlertFinding[]> {
  const [row] = await rows(ctx.db,
    `select count(*)::int as n, count(*) filter (where flags & 64 <> 0)::int as unknown from tracking_hit
where received_at >= now() - interval '1 hour' and event_name in ('ViewContent', 'AddToCart', 'InitiateCheckout')`)
  const n = num(row?.n)
  const unknown = num(row?.unknown)
  const share = n ? unknown / n : 0
  return [{
    key: "unknown_variants",
    kind: "unknown_variants",
    active: n >= UNKNOWN_VARIANT_MIN_HITS && share > UNKNOWN_VARIANT_SHARE,
    title: "Many product events have unknown variants",
    lines: [`${unknown} of ${n} product events in the last hour (${Math.round(share * 100)}%) named a variant the backend does not know, so they were not sent. The variant index may be stale: see Tracking > Catalog.`],
  }]
}

/**
 * feed_guard / feed_error: the catalog job wrote catalog:alert, and since
 * then no feed was published and no later build finished without being held
 * (catalog:build, written after every build; an unchanged build is fine).
 */
async function checkFeed(ctx: CheckContext): Promise<AlertFinding[]> {
  const alert = await getState<{ kind?: string; at?: string; detail?: unknown }>(ctx.db, "catalog:alert")
  const build = await getState<{ at?: string; status?: string }>(ctx.db, "catalog:build")
  const [published] = await rows(ctx.db, "select max(published_at) as at from catalog_feed where kind = 'published'")
  const at = time(alert?.at)
  const builtAt = build?.status && build.status !== "held" ? time(build.at) : NaN
  const publishedAt = Math.max(time(published?.at) || 0, builtAt || 0)
  const detail = typeof alert?.detail === "string" ? alert.detail.replace(/\s+/g, " ").slice(0, 300) : ""
  const titles: Record<"feed_guard" | "feed_error", string> = {
    feed_guard: "Catalog feed update held back",
    feed_error: "Catalog feed build failed",
  }
  return (["feed_guard", "feed_error"] as const).map((kind) => {
    const active = alert?.kind === kind && Number.isFinite(at) && !(publishedAt > at)
    const lines = kind === "feed_guard"
      ? ["The new catalog feed lost more items than the shrink guard allows, so the previous feed is still published. Check it and use \"Publish anyway\" on Tracking > Catalog if the drop is expected."]
      : ["The catalog feed could not be built; the previous feed is still published."]
    if (detail) lines.push(`Detail: ${detail}`)
    return { key: kind, kind, active, title: titles[kind], lines }
  })
}

/** feed_not_fetched: the catalog is on and published, and Meta has not fetched it for 36 hours. */
async function checkFeedNotFetched(ctx: CheckContext): Promise<AlertFinding[]> {
  const title = "Meta has not fetched the catalog feed"
  const off = { key: "feed_not_fetched", kind: "feed_not_fetched" as const, active: false, title, lines: [] as string[] }
  if (!ctx.config.catalog.enabled) return [off]
  const [feed] = await rows(ctx.db, "select published_at from catalog_feed where platform = 'meta' and kind = 'published'")
  const publishedAt = time(feed?.published_at)
  if (!Number.isFinite(publishedAt)) return [off]
  const [fetched] = await rows(ctx.db, "select max(fetched_at) as at from catalog_feed_fetch where platform = 'meta'")
  const fetchedAt = time(fetched?.at)
  const reference = Number.isFinite(fetchedAt) ? fetchedAt : publishedAt
  const hours = Math.floor((ctx.now - reference) / HOUR_MS)
  return [{
    ...off,
    active: ctx.now - reference > FEED_FETCH_MAX_AGE_MS,
    lines: [Number.isFinite(fetchedAt)
      ? `The last Meta fetch of the feed was ${plural(hours, "hour")} ago.`
      : `Meta has not fetched the feed since it was published ${plural(hours, "hour")} ago.`,
    "Check the feed URL and schedule in Meta Commerce Manager (Tracking > Catalog has the URL)."],
  }]
}

const CHECKS: readonly [string, (ctx: CheckContext) => Promise<AlertFinding[]>][] = [
  ["token", checkToken],
  ["payload", checkPayload],
  ["send_failures", checkSendFailures],
  ["checkout_without_tracking", checkCheckoutWithoutTracking],
  ["purchase_not_enqueued", checkPurchaseNotEnqueued],
  ["edge_missing", checkEdgeMissing],
  ["no_purchase", checkNoPurchase],
  ["sweep_stale", checkSweepStale],
  ["rollup_lag", checkRollupLag],
  ["live_disarmed", checkLiveDisarmed],
  ["unknown_variants", checkUnknownVariants],
  ["feed", checkFeed],
  ["feed_not_fetched", checkFeedNotFetched],
]

// ---------------------------------------------------------------- email

/** The admin page every email links to. */
export function healthUrl(): string {
  const base = (process.env.MEDUSA_BACKEND_URL ?? "").trim().replace(/\/+$/, "")
  return base ? `${base}/app/tracking/health` : "Admin > Tracking > Health"
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function message(title: string, lines: string[], resolved: boolean): { subject: string; html: string; text: string } {
  const url = healthUrl()
  const head = resolved ? `Resolved: ${title}.` : `${title}.`
  const body = resolved ? ["The problem is no longer seen."] : lines
  const text = [head, "", ...body, "", `Details: ${url}`].join("\n")
  const link = /^https?:\/\//.test(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(url)
  const html = [`<p><strong>${escapeHtml(head)}</strong></p>`, ...body.map((line) => `<p>${escapeHtml(line)}</p>`), `<p>Details: ${link}</p>`].join("\n")
  return { subject: `Florayn tracking: ${resolved ? "resolved - " : ""}${title}`, html, text }
}

async function deliver(to: string, title: string, lines: string[], resolved: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    return await sendEmail({ to, fromName: "Florayn tracking", ...message(title, lines, resolved) })
  } catch {
    return { ok: false, error: "the email could not be sent" }
  }
}

function readState(value: unknown): AlertState {
  const v = (value && typeof value === "object" ? value : {}) as Partial<AlertState>
  return {
    open: v.open === true,
    title: typeof v.title === "string" ? v.title : "",
    since: typeof v.since === "string" ? v.since : null,
    last_sent_at: typeof v.last_sent_at === "string" ? v.last_sent_at : null,
    last_try_at: typeof v.last_try_at === "string" ? v.last_try_at : null,
  }
}

/** A send failed recently (after the last success): wait 15 minutes before trying again. */
function failedRecently(state: AlertState, now: number): boolean {
  const tried = time(state.last_try_at)
  if (!Number.isFinite(tried) || now - tried >= RETRY_FAILED_EMAIL_MS) return false
  const sent = time(state.last_sent_at)
  return !Number.isFinite(sent) || tried > sent
}

async function saveIfChanged(db: Db, key: string, before: AlertState, after: AlertState): Promise<void> {
  if (JSON.stringify(before) !== JSON.stringify(after)) await setState(db, key, after)
}

/**
 * Runs every check and emails what opened, repeated or cleared (section 10).
 * Never throws: a failing check is skipped for this run (its alert state is
 * left as it was) and listed in `errors`. The run summary is stored in
 * tracking_state `alerts:last` for the Health page.
 */
export async function checkAlerts(container: any): Promise<AlertRun> {
  const now = Date.now()
  const run: AlertRun = { at: iso(now), sent: [], recovered: [], open: [], pending: [], warning: null, errors: [] }
  let db: Db
  let config: TrackingConfig
  try {
    db = trackingDb(container)
    config = (await loadTrackingSettings(container)).config
  } catch {
    run.errors.push("settings could not be read")
    return run
  }
  if (!config.alerts.enabled) return { ...run, disabled: true }

  const ctx: CheckContext = { container, db, config, now }
  const findings: AlertFinding[] = []
  for (const [name, check] of CHECKS) {
    try {
      findings.push(...await check(ctx))
    } catch (error) {
      run.errors.push(`${name}: ${String((error as { message?: unknown } | null)?.message ?? error).replace(/\s+/g, " ").slice(0, 120)}`)
    }
  }

  const canEmail = emailConfigured()
  if (!canEmail) run.warning = "Email is not configured (EMAILIT_API_KEY and EMAIL_FROM), so tracking alerts cannot be sent."
  const repeatMs = config.alerts.repeat_hours * HOUR_MS
  const to = config.alerts.email

  for (const finding of findings) {
    const key = `alert:${finding.key}`
    try {
      const before = readState(await getState(db, key))
      if (finding.active) {
        run.open.push(finding.key)
        const after: AlertState = { ...before, open: true, title: finding.title, since: before.open ? before.since : iso(now) }
        const due = !before.open || !before.last_sent_at || now - time(before.last_sent_at) >= repeatMs
        if (due) {
          if (!canEmail || failedRecently(before, now)) {
            run.pending.push(finding.key)
          } else {
            const result = await deliver(to, finding.title, finding.lines, false)
            after.last_try_at = iso(now)
            if (result.ok) {
              after.last_sent_at = iso(now)
              run.sent.push(finding.key)
            } else {
              run.pending.push(finding.key)
              run.errors.push(`${finding.key}: ${result.error ?? "email failed"}`)
            }
          }
        }
        await saveIfChanged(db, key, before, after)
      } else if (before.open) {
        const closed: AlertState = { ...before, open: false, since: null }
        // An alert that was never emailed, or a check that no longer applies, closes quietly.
        if (finding.silent || !before.last_sent_at) {
          await setState(db, key, closed)
        } else if (!canEmail || failedRecently(before, now)) {
          run.pending.push(finding.key)
        } else {
          const result = await deliver(to, before.title || finding.title, finding.lines, true)
          if (result.ok) {
            await setState(db, key, { ...closed, last_try_at: iso(now) })
            run.recovered.push(finding.key)
          } else {
            await setState(db, key, { ...before, last_try_at: iso(now) })
            run.pending.push(finding.key)
            run.errors.push(`${finding.key}: ${result.error ?? "email failed"}`)
          }
        }
      }
    } catch (error) {
      run.errors.push(`${finding.key}: ${String((error as { message?: unknown } | null)?.message ?? error).slice(0, 120)}`)
    }
  }

  try {
    await setState(db, "alerts:last", run)
  } catch {
    // The summary is for the Health page only.
  }
  return run
}

/** Every alert state (open or closed) for the Health page. */
export async function alertStates(container: any): Promise<({ key: string } & AlertState)[]> {
  const result: any = await trackingDb(container).raw("select key, value from tracking_state where key like 'alert:%' order by key")
  return (result?.rows ?? []).map((row: any) => ({ key: String(row.key).slice("alert:".length), ...readState(row.value) }))
}

/**
 * Admin "Send test alert": one email to `alerts.email`, even while alerts are
 * switched off, so the owner can check delivery. `{ ok, error? }`.
 */
export async function sendTestAlert(container: any): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured()) return { ok: false, error: "Email is not configured on the server (EMAILIT_API_KEY and EMAIL_FROM)." }
  const { config } = await loadTrackingSettings(container)
  const result = await deliver(config.alerts.email, "test alert", [
    "This is a test of the tracking alerts. Real alerts look like this one and link to the Health page.",
  ], false)
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? "The email could not be sent." }
}
