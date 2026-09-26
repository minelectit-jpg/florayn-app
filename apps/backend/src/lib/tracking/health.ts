import { getState, trackingDb } from "./db"
import type { Env } from "./settings"

/**
 * One read-only view of the outbox for Tracking > Health and the Live page
 * (TRACKING.md 6.3: one implementation, both screens). Counts per platform,
 * environment and destination, the last successful send, and the last error
 * the sender recorded in tracking_state (`outbox:last_error:<platform>:<env>`,
 * written by lib/tracking/outbox.ts). Raw SQL through the PG_CONNECTION knex
 * is the documented exception of lib/tracking/db.ts; nothing is interpolated.
 */

type OutboxPlatform = "meta" | "tiktok"

export type OutboxStatusCounts = {
  pending: number
  sending: number
  retry: number
  blocked: number
  failed: number
  expired: number
  skipped: number
  dry_run: number
  sent_24h: number
}

export type OutboxHealthRow = {
  platform: OutboxPlatform
  env: Env
  destination: string
  counts: OutboxStatusCounts
  last_sent_at: string | null
  /** Class, vendor code and message, trace id; never a token, payload or customer data. */
  last_error: string | null
  last_error_at: string | null
}

/** What the sender stores after a batch that did not fully succeed. */
export type OutboxLastError = {
  at: string
  status: string
  cls: string
  /** The short head of the vendor answer ("HTTP 400 code 190/460 OAuthException", "network", "no token"). */
  code: string
  trace_id: string | null
  message: string
  destination: string
}

const STATUS_KEYS = ["pending", "sending", "retry", "blocked", "failed", "expired", "skipped", "dry_run"] as const
const PLATFORMS: readonly OutboxPlatform[] = ["meta", "tiktok"]
const ENVS: readonly Env[] = ["test", "live"]
const CACHE_MS = 10_000

/**
 * One pass over tracking_event. It scans the table (about 1M rows at 300
 * orders a day, payloads are NULL once sent), so callers share the result for
 * 10 s instead of repeating it on every poll.
 */
export const OUTBOX_HEALTH_SQL = `select platform, env, destination,
  ${STATUS_KEYS.map((status) => `count(*) filter (where status = '${status}')::int as ${status}`).join(",\n  ")},
  count(*) filter (where status = 'sent' and sent_at >= now() - interval '24 hours')::int as sent_24h,
  max(sent_at) as last_sent_at
from tracking_event
group by platform, env, destination
order by platform, env, destination`

export const COUNTERS_24H_SQL = `select key, sum(n)::bigint as n from tracking_counter
where hour >= date_trunc('hour', now()) - interval '23 hours'
group by key order by key`

/** The tracking_state key the sender writes its last error to. */
export function lastErrorKey(platform: OutboxPlatform, env: Env): string {
  return `outbox:last_error:${platform}:${env}`
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function readHealth(container: any): Promise<OutboxHealthRow[]> {
  const db = trackingDb(container)
  const result: any = await db.raw(OUTBOX_HEALTH_SQL)
  const errors = new Map<string, OutboxLastError>()
  for (const platform of PLATFORMS) {
    for (const env of ENVS) {
      const state = await getState<OutboxLastError>(db, lastErrorKey(platform, env))
      if (state && typeof state === "object") errors.set(`${platform}:${env}`, state)
    }
  }
  return (result?.rows ?? []).map((row: any): OutboxHealthRow => {
    const counts = {} as OutboxStatusCounts
    for (const status of STATUS_KEYS) counts[status] = count(row[status])
    counts.sent_24h = count(row.sent_24h)
    const error = errors.get(`${row.platform}:${row.env}`)
    const matches = error && (!error.destination || error.destination === row.destination)
    return {
      platform: row.platform,
      env: row.env,
      destination: String(row.destination ?? ""),
      counts,
      last_sent_at: iso(row.last_sent_at),
      last_error: matches && typeof error.message === "string" ? error.message.slice(0, 500) : null,
      last_error_at: matches ? iso(error.at) : null,
    }
  })
}

let cache: { at: number; rows: Promise<OutboxHealthRow[]> } | null = null

/**
 * Per platform/env/destination: rows in each status, sent in the last 24 h,
 * the last send and the last error. Shared for `maxAgeMs` (10 s) per process;
 * pass 0 for a fresh read (after the Retry button).
 */
export async function outboxHealth(container: any, options: { maxAgeMs?: number } = {}): Promise<OutboxHealthRow[]> {
  const maxAge = options.maxAgeMs ?? CACHE_MS
  const now = Date.now()
  if (maxAge > 0 && cache && now - cache.at < maxAge) return cache.rows
  const entry = { at: now, rows: readHealth(container) }
  cache = entry
  // A failed read is not shared; the caller still sees the error.
  entry.rows.catch(() => { if (cache === entry) cache = null })
  return entry.rows
}

/** tracking_counter summed by key over the last 24 hourly buckets (the current one included). */
export async function counters24h(container: any): Promise<Record<string, number>> {
  const result: any = await trackingDb(container).raw(COUNTERS_24H_SQL)
  const counters: Record<string, number> = {}
  for (const row of result?.rows ?? []) {
    if (typeof row.key === "string") counters[row.key] = count(row.n)
  }
  return counters
}
