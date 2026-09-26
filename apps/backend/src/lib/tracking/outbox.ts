import crypto from "node:crypto"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"

import { MAX_BATCH_EVENTS, redact, type EventInput, type ResultClass, type SendResult } from "./adapters/common"
import { buildMetaEvent, sendMetaBatch, type MetaEvent } from "./adapters/meta"
import { buildTikTokEvent, sendTikTokBatch, type TikTokEvent } from "./adapters/tiktok"
import { bumpCounters, getState, insertOutbox, setState, trackingDb, type OutboxInsert } from "./db"
import { sha256Hex } from "./hash"
import { lastErrorKey, type OutboxLastError } from "./health"
import {
  destinationFor,
  loadTrackingSettings,
  loadTrackingToken,
  tokenFingerprint,
  type Env,
  type TrackingConfig,
} from "./settings"

/**
 * The outbox sender (TRACKING.md 6.3). Every server copy of an event is a
 * tracking_event row; this file claims due rows, sends them to Meta CAPI and
 * the TikTok Events API in batches, and records what happened to each row.
 * Durable state lives only in Postgres (invariant 2): a lost Redis key or a
 * crashed process leaves rows `pending`/`sending`, and the next sweep picks
 * them up again. Every event is sent at most once per (platform, event_name,
 * event_id), and the platforms deduplicate the browser copy by the same id.
 *
 * Raw SQL through the PG_CONNECTION knex is the documented exception of
 * lib/tracking/db.ts: claiming needs FOR UPDATE SKIP LOCKED. Every statement
 * uses bindings. `last_error` never holds a token, a payload or customer
 * data: the adapters redact vendor answers and this file redacts them again.
 */

type Db = Knex | Knex.Transaction
type OutboxPlatform = "meta" | "tiktok"
type FinalStatus = "sent" | "retry" | "blocked" | "failed" | "expired" | "dry_run" | "skipped"

export type ClaimedRow = {
  id: string
  platform: OutboxPlatform
  env: Env
  destination: string
  event_name: string
  event_id: string
  event_time: Date
  payload: unknown
  attempts: number
}

/**
 * What one row becomes after a send. `refund` gives back the attempt a
 * postponed row never used; `cls`, `code` and `traceId` describe the vendor
 * answer for Health and the alerts.
 */
export type Outcome = {
  id: string
  status: FinalStatus
  delayMs: number | null
  error: string | null
  refund?: boolean
  cls?: string
  code?: string
  traceId?: string | null
}

export type FlushOptions = {
  maxBatches?: number
  /** Epoch ms after which no new batch is claimed. */
  deadline?: number
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch
}

export type FlushStats = { batches: number; claimed: number } & Record<FinalStatus, number>

/** Retry delays by attempt: 1 m, 2 m, 5 m, 15 m, 1 h, 3 h, 6 h, 12 h; a transient failure after that is final. */
export const BACKOFF_MS = [60e3, 120e3, 300e3, 900e3, 3600e3, 10800e3, 21600e3, 43200e3] as const
export const CLAIM_LIMIT = 500
export const PRUNE_BATCH = 10_000

const DEBOUNCE_MS = 2_000
const MAX_WAIT_MS = 5_000
const SCHEDULED_FLUSH_MS = 30_000
// A claim holds its rows for 2 minutes (locked_until); finish well inside that.
const CLAIM_WORK_MS = 90_000
// Splits and resends of one group per claim; a systemic payload error must not become 1,000 requests.
const MAX_REQUESTS_PER_GROUP = 40
const PLATFORMS: readonly OutboxPlatform[] = ["meta", "tiktok"]
const ENVS: readonly Env[] = ["test", "live"]
const LABEL: Record<OutboxPlatform, string> = { meta: "Meta", tiktok: "TikTok" }
// BDT major units (taka), like the variant index.
const TEST_VARIANT = { id: "variant_01TESTEVENT000000000000", price: 1000.0 }

export const CLAIM_SQL = `update tracking_event set status = 'sending', locked_until = now() + interval '2 min', attempts = attempts + 1
where id in (
  select id from tracking_event
  where status in ('pending', 'retry') and next_attempt_at <= now() and event_time >= now() - interval '6.5 days'
  order by id limit ${CLAIM_LIMIT}
  for update skip locked)
returning id, platform, env, destination, event_name, event_id, event_time, payload, attempts`

export const RECLAIM_SQL = "update tracking_event set status = 'retry', next_attempt_at = now() where status = 'sending' and locked_until < now()"

export const EXPIRE_SQL = `update tracking_event set status = 'expired', payload = null, locked_until = null,
  last_error = coalesce(last_error, 'expired: not sent within 6.5 days')
where id in (
  select id from tracking_event
  where status in ('pending', 'retry') and event_time < now() - interval '6.5 days'
  limit ${PRUNE_BATCH})`

export const REQUEUE_SQL = `update tracking_event set status = 'retry', attempts = 0, next_attempt_at = now(), locked_until = null
where status = 'blocked' and platform = ? and env = ? and payload is not null and event_time >= now() - interval '6 days'`

/** Retention (6.3). day_dim and catalog images are kept. */
export const RETENTION: readonly { table: string; where: string }[] = [
  { table: "tracking_event", where: "status in ('sent', 'dry_run') and created_at < now() - interval '8 days'" },
  { table: "tracking_event", where: "status in ('failed', 'expired', 'blocked', 'skipped') and created_at < now() - interval '14 days'" },
  { table: "tracking_hit", where: "received_at < now() - interval '7 days'" },
  { table: "tracking_cart_context", where: "updated_at < now() - interval '14 days'" },
  { table: "tracking_order_context", where: "created_at < now() - interval '90 days'" },
  { table: "tracking_minute", where: "bucket < now() - interval '35 days'" },
  { table: "tracking_session", where: "day < (now() - interval '90 days')::date" },
  { table: "tracking_counter", where: "hour < now() - interval '35 days'" },
  { table: "catalog_feed_fetch", where: "fetched_at < now() - interval '30 days'" },
]

function affected(result: any): number {
  return Number(result?.rowCount ?? result?.rows?.length ?? 0)
}

function isDb(value: any): value is Db {
  return typeof value?.raw === "function"
}

/**
 * Adds outbox rows, `INSERT ... ON CONFLICT (platform, event_name, event_id)
 * DO NOTHING` (lib/tracking/db.ts). Pass the caller's transaction so the rows
 * commit with the hit or order context they belong to; a container uses the
 * shared connection. Returns how many rows were new.
 */
export async function enqueue(target: Db | any, rows: OutboxInsert[]): Promise<number> {
  return insertOutbox(isDb(target) ? target : trackingDb(target), rows)
}

// ---------------------------------------------------------------- scheduled flush

let timer: ReturnType<typeof setTimeout> | null = null
let firstCallAt: number | null = null
let latestContainer: any = null
let flushing = false
let again: any = null

function fire(): void {
  timer = null
  firstCallAt = null
  const container = latestContainer
  latestContainer = null
  if (!container) return
  if (flushing) {
    again = container
    return
  }
  flushing = true
  flush(container, { deadline: Date.now() + SCHEDULED_FLUSH_MS })
    .catch(() => undefined)
    .finally(() => {
      flushing = false
      const next = again
      again = null
      if (next) scheduleFlush(next)
    })
}

/**
 * Sends soon, without making the caller wait: calls within 2 s are coalesced
 * into one flush, and a steady stream still flushes at least every 5 s. Never
 * awaited and never throws. Call it after the enqueue transaction commits,
 * never from a subscriber (the event bus runs with attempts: 1; the job and
 * reconcile are the durable path).
 */
export function scheduleFlush(container: any): void {
  try {
    const now = Date.now()
    latestContainer = container
    if (firstCallAt === null) firstCallAt = now
    if (timer) clearTimeout(timer)
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstCallAt + MAX_WAIT_MS - now))
    const handle: any = setTimeout(fire, wait)
    handle?.unref?.()
    timer = handle
  } catch {
    // Sending later is the job's work anyway; a scheduling failure changes nothing.
  }
}

// ---------------------------------------------------------------- flush

function rowId(value: unknown): string {
  return String(value)
}

function compareIds(a: ClaimedRow, b: ClaimedRow): number {
  return a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function asPayload(value: unknown): Record<string, unknown> | null {
  let parsed = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

async function claim(db: Db): Promise<ClaimedRow[]> {
  const result: any = await db.raw(CLAIM_SQL)
  const rows: ClaimedRow[] = (result?.rows ?? []).map((row: any) => ({
    id: rowId(row.id),
    platform: row.platform,
    env: row.env,
    destination: String(row.destination ?? ""),
    event_name: row.event_name,
    event_id: row.event_id,
    event_time: row.event_time instanceof Date ? row.event_time : new Date(row.event_time),
    payload: row.payload,
    attempts: Math.max(1, Number(row.attempts) || 1),
  }))
  return rows.sort(compareIds)
}

type SendContext = {
  container: any
  config: TrackingConfig
  fetch: typeof fetch
  dryRun: boolean
  /** Epoch ms by which this claim's sends must be done. */
  claimDeadline: number
}

type Target = { platform: OutboxPlatform; env: Env; destination: string; token: string }

function final(row: ClaimedRow, status: FinalStatus, error: string | null): Outcome {
  return { id: row.id, status, delayMs: null, error: error === null ? null : error.slice(0, 500) }
}

/** A transient failure: retry after the backoff for this attempt, or fail after the last one. */
function transient(row: ClaimedRow, error: string): Outcome {
  const delay = BACKOFF_MS[row.attempts - 1]
  if (delay === undefined) return final(row, "failed", `failed after ${row.attempts} attempts: ${error}`)
  return { id: row.id, status: "retry", delayMs: delay, error: error.slice(0, 500) }
}

/** Not sent because another row was bad: back in the queue at once, and the attempt does not count. */
function postponed(row: ClaimedRow): Outcome {
  return { id: row.id, status: "retry", delayMs: 0, error: "not sent yet: waiting for the next batch", refund: true }
}

function errorText(result: SendResult, token: string): string {
  const trace = result.traceId ? ` (trace ${result.traceId})` : ""
  return redact(`${result.cls}: ${result.message}${trace}`, token).slice(0, 500)
}

/** The vendor answer's class, its short head ("HTTP 400 code 190/460 OAuthException", "network") and trace id. */
function vendor(result: SendResult, token: string): Pick<Outcome, "cls" | "code" | "traceId"> {
  return {
    cls: result.cls,
    code: redact(String(result.message ?? "").split(": ")[0], token).slice(0, 120),
    traceId: result.traceId ?? null,
  }
}

async function sendBatch(ctx: SendContext, target: Target, rows: ClaimedRow[]): Promise<SendResult[]> {
  const events = rows.map((row) => asPayload(row.payload))
  const cfg = {
    destination: target.destination,
    token: target.token,
    env: target.env,
    apiVersion: ctx.config.meta.api_version,
    testEventCode: ctx.config.meta.test_event_code || null,
  }
  let results: SendResult[]
  try {
    results = target.platform === "meta"
      ? await sendMetaBatch(ctx.fetch, cfg, events as unknown as MetaEvent[])
      : await sendTikTokBatch(ctx.fetch, cfg, events as unknown as TikTokEvent[])
  } catch (error) {
    const message = redact((error as { message?: unknown } | null)?.message ?? "send failed", target.token)
    return rows.map((_, index) => ({ index, cls: "transient" as ResultClass, message }))
  }
  const byIndex = new Map(results.map((result) => [result.index, result]))
  return rows.map((_, index) => byIndex.get(index) ?? { index, cls: "transient", message: "no answer for this row" })
}

/**
 * Sends rows to one destination and decides each row's fate.
 * - A request rejected as a whole for its content (every row `payload`) is
 *   split in halves and each half is sent again at once; a single row that is
 *   still rejected is `failed`.
 * - When the vendor singles rows out, the rest were not accepted either and are
 *   innocent: TikTok 40002 names the bad row (the others come back
 *   `transient`), and a Meta batch with a row past 7 days expires that row
 *   (the others come back `payload`). Innocent rows are sent again at once,
 *   never backed off or failed.
 * - `suspect` rows are a half of a rejected request; when this claim runs out
 *   of time or requests they back off like a transient failure, while innocent
 *   rows go back to the queue without using an attempt.
 */
async function sendRows(ctx: SendContext, target: Target, rows: ClaimedRow[], budget: { requests: number }, suspect: boolean): Promise<Outcome[]> {
  if (!rows.length) return []
  if (rows.length > MAX_BATCH_EVENTS) {
    const outcomes: Outcome[] = []
    for (let i = 0; i < rows.length; i += MAX_BATCH_EVENTS) {
      outcomes.push(...await sendRows(ctx, target, rows.slice(i, i + MAX_BATCH_EVENTS), budget, suspect))
    }
    return outcomes
  }
  if (budget.requests >= MAX_REQUESTS_PER_GROUP || Date.now() >= ctx.claimDeadline) {
    return rows.map((row) => suspect ? transient(row, "payload: not narrowed down in this run") : postponed(row))
  }
  budget.requests += 1
  const results = await sendBatch(ctx, target, rows)
  const classes = new Set(results.map((result) => result.cls))

  if (classes.size === 1 && classes.has("payload")) {
    if (rows.length === 1) return [{ ...final(rows[0], "failed", errorText(results[0], target.token)), ...vendor(results[0], target.token) }]
    const middle = Math.ceil(rows.length / 2)
    const first = await sendRows(ctx, target, rows.slice(0, middle), budget, true)
    const second = await sendRows(ctx, target, rows.slice(middle), budget, true)
    return [...first, ...second]
  }

  const singledOut = classes.size > 1 && classes.has("payload")
  const outcomes: Outcome[] = []
  const innocent: ClaimedRow[] = []
  rows.forEach((row, index) => {
    const result = results[index]
    const error = errorText(result, target.token)
    const answer = vendor(result, target.token)
    switch (result.cls) {
      case "ok":
        outcomes.push(final(row, "sent", null))
        break
      case "expired":
        outcomes.push({ ...final(row, "expired", error), ...answer })
        break
      case "blocked":
        outcomes.push({ ...final(row, "blocked", error), ...answer })
        break
      case "payload":
        // With expired rows in the answer (Meta), `payload` means "not sent because of them".
        if (classes.has("expired")) innocent.push(row)
        else outcomes.push({ ...final(row, "failed", error), ...answer })
        break
      default:
        if (singledOut) innocent.push(row)
        else outcomes.push({ ...transient(row, error), ...answer })
    }
  })
  if (innocent.length) outcomes.push(...await sendRows(ctx, target, innocent, budget, false))
  return outcomes
}

async function deliverGroup(ctx: SendContext, rows: ClaimedRow[]): Promise<Outcome[]> {
  const { platform, env, destination } = rows[0]
  const outcomes: Outcome[] = []
  const sendable: ClaimedRow[] = []
  for (const row of rows) {
    if (asPayload(row.payload)) sendable.push(row)
    else outcomes.push(final(row, "failed", "failed: the row has no event payload"))
  }
  if (!sendable.length) return outcomes
  // The owner's levers win over the queue: an event enqueued before a
  // platform (or live sending) was switched off is kept as skipped, and only
  // "Send skipped" sends it later (I3).
  if (!ctx.config[platform].enabled) {
    return [...outcomes, ...sendable.map((row) => final(row, "skipped", `skipped: ${LABEL[platform]} was switched off before sending`))]
  }
  if (env === "live" && !ctx.config.live_armed) {
    return [...outcomes, ...sendable.map((row) => final(row, "skipped", "skipped: live sending was switched off before sending"))]
  }
  const token = await loadTrackingToken(ctx.container, platform, env)
  if (!token) return [...outcomes, ...sendable.map((row) => ({ ...final(row, "blocked", "no token"), cls: "blocked", code: "no token" }))]
  if (ctx.dryRun) return [...outcomes, ...sendable.map((row) => final(row, "dry_run", null))]
  return [...outcomes, ...await sendRows(ctx, { platform, env, destination, token }, sendable, { requests: 0 }, false)]
}

/** One statement for a whole claim: status, backoff, sent time, payload and error per row. */
async function writeOutcomes(db: Db, outcomes: Outcome[]): Promise<void> {
  for (let i = 0; i < outcomes.length; i += CLAIM_LIMIT) {
    const chunk = outcomes.slice(i, i + CLAIM_LIMIT)
    const bindings: unknown[] = []
    for (const outcome of chunk) {
      bindings.push(outcome.id, outcome.status, outcome.delayMs, outcome.error, Boolean(outcome.refund))
    }
    const values = chunk.map(() => "(?::bigint, ?::text, ?::bigint, ?::text, ?::boolean)").join(", ")
    await db.raw(
      `update tracking_event as t set
  status = v.status,
  next_attempt_at = case when v.delay_ms is null then t.next_attempt_at else now() + v.delay_ms::float8 * interval '1 millisecond' end,
  sent_at = case when v.status in ('sent', 'dry_run') then now() else t.sent_at end,
  payload = case when v.status in ('sent', 'expired') then null else t.payload end,
  attempts = case when v.refund then greatest(t.attempts - 1, 0) else t.attempts end,
  last_error = v.last_error,
  locked_until = null
from (values ${values}) as v(id, status, delay_ms, last_error, refund)
where t.id = v.id and t.status = 'sending'`,
      bindings as any[]
    )
  }
}

/** Hourly counters (`outbox.<status>.<platform>.<env>`) and the last error per platform/env, for Health and alerts. */
async function recordGroup(db: Db, rows: ClaimedRow[], outcomes: Outcome[]): Promise<void> {
  const { platform, env, destination } = rows[0]
  const deltas: Record<string, number> = {}
  let lastError: Outcome | null = null
  for (const outcome of outcomes) {
    if (outcome.refund) continue
    const key = `outbox.${outcome.status}.${platform}.${env}`
    deltas[key] = (deltas[key] ?? 0) + 1
    if (outcome.error && ["retry", "blocked", "failed", "expired"].includes(outcome.status)) lastError = outcome
  }
  try {
    await bumpCounters(db, deltas)
    if (lastError?.error) {
      const state: OutboxLastError = {
        at: new Date(Date.now()).toISOString(),
        status: lastError.status,
        cls: lastError.cls ?? lastError.status,
        code: lastError.code ?? lastError.error.split(": ")[0].slice(0, 120),
        trace_id: lastError.traceId ?? null,
        message: lastError.error,
        destination,
      }
      await setState(db, lastErrorKey(platform, env), state)
    }
  } catch {
    // Bookkeeping only: the rows themselves are already marked.
  }
}

function emptyStats(): FlushStats {
  return { batches: 0, claimed: 0, sent: 0, retry: 0, blocked: 0, failed: 0, expired: 0, dry_run: 0, skipped: 0 }
}

/**
 * Claims up to 500 due rows at a time (`FOR UPDATE SKIP LOCKED`, so several
 * processes never send the same row), groups them by (platform, env,
 * destination), sends each group and marks every row. Stops after
 * `maxBatches` claims, when the queue is empty, or at `deadline`.
 * `TRACKING_DRY_RUN=1` marks rows `dry_run` without a network call.
 */
export async function flush(container: any, options: FlushOptions = {}): Promise<FlushStats> {
  const stats = emptyStats()
  const db = trackingDb(container)
  const maxBatches = options.maxBatches ?? 10
  const fetchImpl = options.fetch ?? globalThis.fetch
  const settings = await loadTrackingSettings(container)
  for (let batch = 0; batch < maxBatches; batch++) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break
    const rows = await claim(db)
    if (!rows.length) break
    stats.batches += 1
    stats.claimed += rows.length
    const ctx: SendContext = {
      container,
      config: settings.config,
      fetch: fetchImpl,
      dryRun: process.env.TRACKING_DRY_RUN === "1",
      claimDeadline: Date.now() + CLAIM_WORK_MS,
    }
    const groups = new Map<string, ClaimedRow[]>()
    for (const row of rows) {
      const key = `${row.platform}\u0000${row.env}\u0000${row.destination}`
      const group = groups.get(key)
      if (group) group.push(row)
      else groups.set(key, [row])
    }
    const all: Outcome[] = []
    const perGroup: [ClaimedRow[], Outcome[]][] = []
    for (const group of groups.values()) {
      let outcomes: Outcome[]
      try {
        outcomes = await deliverGroup(ctx, group)
      } catch (error) {
        // An unexpected error (settings or token read): nothing was sent, retry the group later.
        const message = `transient: ${String((error as { message?: unknown } | null)?.message ?? error).slice(0, 200)}`
        outcomes = group.map((row) => transient(row, message))
      }
      all.push(...outcomes)
      perGroup.push([group, outcomes])
    }
    await writeOutcomes(db, all)
    for (const [group, outcomes] of perGroup) await recordGroup(db, group, outcomes)
    for (const outcome of all) stats[outcome.status] += 1
    if (rows.length < CLAIM_LIMIT) break
  }
  return stats
}

// ---------------------------------------------------------------- sweep

async function expireOld(db: Db, deadline: number): Promise<number> {
  let total = 0
  for (;;) {
    const n = affected(await db.raw(EXPIRE_SQL))
    total += n
    if (n < PRUNE_BATCH || Date.now() >= deadline) return total
  }
}

/**
 * A new token (or the first one) sends every event it blocked in the last 6
 * days: those rows go back to `retry` with a fresh set of attempts. The
 * fingerprint (first 8 hex of sha256) is stored, never the token.
 */
async function requeueOnTokenChange(container: any, db: Db): Promise<number> {
  let requeued = 0
  for (const platform of PLATFORMS) {
    for (const env of ENVS) {
      const token = await loadTrackingToken(container, platform, env)
      const fingerprint = token ? tokenFingerprint(token) : ""
      const key = `token_fp:${platform}:${env}`
      const stored = await getState<unknown>(db, key)
      if ((typeof stored === "string" ? stored : null) === fingerprint) continue
      if (fingerprint) requeued += affected(await db.raw(REQUEUE_SQL, [platform, env]))
      await setState(db, key, fingerprint)
    }
  }
  return requeued
}

export type SweepStats = FlushStats & { reclaimed: number; expired_old: number; requeued: number }

/**
 * The every-minute sweep, in order: stale `sending` rows (a process died
 * mid-send) back to `retry`; rows past 6.5 days to `expired` (Meta refuses
 * events older than 7 days, and they never enter a request); blocked rows
 * back to `retry` when a token changed; then up to 20 batches inside the time
 * budget.
 */
export async function runOutboxSweep(container: any, options: { timeBudgetMs?: number; fetch?: typeof fetch } = {}): Promise<SweepStats> {
  const started = Date.now()
  const deadline = started + (options.timeBudgetMs ?? 40_000)
  const db = trackingDb(container)
  const reclaimed = affected(await db.raw(RECLAIM_SQL))
  const expired = await expireOld(db, deadline)
  const requeued = await requeueOnTokenChange(container, db)
  const stats = await flush(container, { maxBatches: 20, deadline, fetch: options.fetch })
  return { ...stats, reclaimed, expired_old: expired, requeued }
}

/**
 * Deletes what is past retention (6.3), 10,000 rows per statement so no
 * delete holds locks for long; each table stops at its first short batch, and
 * the whole run stops at the time budget (the next hourly run continues).
 * Records `prune:last` before and after, so a failing prune is not retried
 * every minute.
 */
export async function pruneRetention(container: any, options: { timeBudgetMs?: number } = {}): Promise<Record<string, number>> {
  const db = trackingDb(container)
  const started = Date.now()
  const deadline = started + (options.timeBudgetMs ?? 20_000)
  const startedAt = new Date(started).toISOString()
  await setState(db, "prune:last", { at: startedAt, done: false })
  const deleted: Record<string, number> = {}
  let finished = true
  for (const { table, where } of RETENTION) {
    for (;;) {
      if (Date.now() >= deadline) {
        finished = false
        break
      }
      const n = affected(await db.raw(`delete from ${table} where ctid = any(array(select ctid from ${table} where ${where} limit ${PRUNE_BATCH}))`))
      deleted[table] = (deleted[table] ?? 0) + n
      if (n < PRUNE_BATCH) break
    }
    if (!finished) break
  }
  await setState(db, "prune:last", { at: startedAt, done: finished, deleted })
  return deleted
}

// ---------------------------------------------------------------- admin retry

export const RETRY_STATUSES = ["blocked", "failed", "skipped"] as const
export type RetryStatus = (typeof RETRY_STATUSES)[number]
export type RetryRequest = { platform: OutboxPlatform | null; env: Env | null; statuses: RetryStatus[] }

/** `{ platform?, env?, statuses }` from the admin Retry buttons, or the reason it is not valid. */
export function parseRetryBody(body: unknown): { ok: true; request: RetryRequest } | { ok: false; error: string } {
  const input = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const platform = input.platform ?? null
  const env = input.env ?? null
  if (platform !== null && platform !== "meta" && platform !== "tiktok") return { ok: false, error: "platform must be meta or tiktok." }
  if (env !== null && env !== "test" && env !== "live") return { ok: false, error: "env must be test or live." }
  const statuses = Array.isArray(input.statuses) ? input.statuses : null
  if (!statuses?.length || !statuses.every((status) => (RETRY_STATUSES as readonly unknown[]).includes(status))) {
    return { ok: false, error: `statuses must list some of: ${RETRY_STATUSES.join(", ")}.` }
  }
  return { ok: true, request: { platform, env, statuses: [...new Set(statuses as RetryStatus[])] } }
}

/**
 * Puts blocked, failed or skipped rows from the last 6 days back in the queue
 * with a fresh set of attempts (4.6). Rows without a payload (a skipped row
 * that never had a destination) cannot be sent and stay as they are. Sending
 * skipped rows is how the owner backfills after switching a platform back on
 * (I3); it is never done automatically. Returns how many rows were queued.
 */
export async function retryRows(container: any, request: RetryRequest): Promise<number> {
  const bindings: unknown[] = [...request.statuses]
  let sql = `update tracking_event set status = 'retry', next_attempt_at = now(), attempts = 0, locked_until = null
where status in (${request.statuses.map(() => "?").join(", ")}) and payload is not null and event_time >= now() - interval '6 days'`
  if (request.platform) {
    sql += " and platform = ?"
    bindings.push(request.platform)
  }
  if (request.env) {
    sql += " and env = ?"
    bindings.push(request.env)
  }
  return affected(await trackingDb(container).raw(sql, bindings as any[]))
}

// ---------------------------------------------------------------- test event

export type TestEventResult =
  | { ok: true; cls: ResultClass; message: string; traceId: string | null; test_event_code: boolean }
  | { ok: false; message: string }

async function sampleVariant(container: any): Promise<{ id: string; price: number }> {
  try {
    const result: any = await trackingDb(container).raw(
      "select variant_id, price from tracking_variant where sellable and price is not null order by variant_id limit 1"
    )
    const row = result?.rows?.[0]
    const price = Number(row?.price)
    if (typeof row?.variant_id === "string" && Number.isFinite(price) && price >= 0) return { id: row.variant_id, price }
  } catch {
    // No variant index yet: the fixed sample id is enough for a test event.
  }
  return TEST_VARIANT
}

/**
 * One event to the TEST destination only, sent now (4.6): Meta gets a
 * PageView (with the test event code when one is set), TikTok a ViewContent
 * (Events API v1.3 has no web PageView, I21). Nothing is written to the
 * outbox. Not ok when the platform has no TEST destination or no TEST token.
 */
export async function sendTestEvent(
  container: any,
  platform: OutboxPlatform,
  options: { fetch?: typeof fetch; userAgent?: string | null } = {}
): Promise<TestEventResult> {
  const { config } = await loadTrackingSettings(container)
  const host = config.test_hosts[0]
  const destination = host ? destinationFor(config, host, platform) : null
  const label = LABEL[platform]
  if (!host || !destination || destination.env !== "test") {
    return { ok: false, message: `${label} has no TEST destination. Turn ${label} on and set its TEST ${platform === "meta" ? "dataset id" : "pixel code"} in Admin > Tracking first.` }
  }
  const token = await loadTrackingToken(container, platform, "test")
  if (!token) return { ok: false, message: `Paste the ${label} TEST token in Admin > Tracking first.` }

  const ua = typeof options.userAgent === "string" && options.userAgent.trim() && !/[\r\n]/.test(options.userAgent)
    ? options.userAgent.trim().slice(0, 400)
    : "Mozilla/5.0 (compatible; FloraynTestEvent/1.0)"
  const base: Omit<EventInput, "name" | "custom"> = {
    eventId: crypto.randomUUID(),
    time: new Date(Date.now()),
    url: `https://${host}/`,
    actionSource: "website",
    user: { ua, externalId: sha256Hex("florayn-test-event") },
  }
  const cfg = {
    destination: destination.id,
    token,
    env: "test" as const,
    apiVersion: config.meta.api_version,
    testEventCode: config.meta.test_event_code || null,
  }
  const fetchImpl = options.fetch ?? globalThis.fetch
  let results: SendResult[]
  if (platform === "meta") {
    const event = buildMetaEvent({ ...base, name: "PageView", custom: {} })
    if (!event) return { ok: false, message: "Could not build the Meta test event." }
    results = await sendMetaBatch(fetchImpl, cfg, [event])
  } else {
    const variant = await sampleVariant(container)
    const event = buildTikTokEvent({
      ...base,
      name: "ViewContent",
      custom: { items: [{ id: variant.id, quantity: 1, price: variant.price }], value: variant.price },
    })
    if (!event) return { ok: false, message: "Could not build the TikTok test event." }
    results = await sendTikTokBatch(fetchImpl, cfg, [event])
  }
  const result = results[0]
  return {
    ok: true,
    cls: result?.cls ?? "transient",
    message: redact(result?.message ?? "no answer", token),
    traceId: result?.traceId ?? null,
    test_event_code: platform === "meta" && Boolean(cfg.testEventCode),
  }
}
