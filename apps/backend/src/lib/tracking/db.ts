import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { CheckoutTrackingContext } from "./contract"
import type { Env } from "./settings"

/**
 * Raw SQL for the tracking tables (TRACKING.md 2.2-2.5), through the
 * PG_CONNECTION knex. This is a documented exception to AGENTS.md "no raw
 * SQL": the outbox and the dashboard need INSERT ... ON CONFLICT DO NOTHING
 * (idempotent enqueue), counter upserts and FOR UPDATE SKIP LOCKED, which
 * module services cannot express. Precedent: the order search in
 * lib/order-ops.ts. Every statement uses bindings; nothing is interpolated
 * from input. Only tracking_settings goes through the module service.
 */

export type OutboxStatus = "pending" | "sending" | "sent" | "retry" | "blocked" | "failed" | "expired" | "dry_run" | "skipped"

export type OutboxInsert = {
  platform: "meta" | "tiktok"
  env: Env
  destination: string
  event_name: string
  event_id: string
  event_time: Date
  source: "browser" | "checkout" | "reconcile" | "status" | "test"
  order_id?: string | null
  payload: unknown | null
  status?: "pending" | "blocked" | "skipped"
  last_error?: string | null
}

export type HitInsert = {
  event_name: string
  event_id: string
  origin: "b" | "s"
  visitor_id?: string | null
  session_id?: string | null
  source?: string | null
  campaign?: string | null
  device_class?: string | null
  audience?: string | null
  host: string
  path?: string | null
  handle?: string | null
  variant_id?: string | null
  device?: string | null
  case_type?: string | null
  value?: number | null
  items?: number | null
  country?: string | null
  flags?: number
}

export type OrderContextRow = {
  order_id: string
  display_id: number
  cart_id: string | null
  host: string
  env: Env | null
  context: CheckoutTrackingContext
  trusted: boolean
  staff: boolean
  optout: boolean
  purchase_time: Date
}

/** tracking_hit.flags bits (2.4). */
export const HIT_FLAGS = {
  PRIMARY: 1,
  VARIANT_SWITCH: 2,
  INTERNAL: 8,
  NEW_VISITOR: 16,
  FIRST_PAGEVIEW: 32,
  UNKNOWN_VARIANT: 64,
} as const

type Db = Knex | Knex.Transaction

const OUTBOX_COLUMNS = ["platform", "env", "destination", "event_name", "event_id", "event_time", "source",
  "order_id", "payload", "status", "last_error"] as const
const HIT_COLUMNS = ["event_name", "event_id", "origin", "visitor_id", "session_id", "source", "campaign",
  "device_class", "audience", "host", "path", "handle", "variant_id", "device", "case_type", "value", "items",
  "country", "flags"] as const

export function trackingDb(container: any): Knex {
  return container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as Knex
}

export async function withTransaction<T>(container: any, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return trackingDb(container).transaction(fn)
}

function affected(result: any): number {
  return Number(result?.rowCount ?? result?.rows?.length ?? 0)
}

/** `(?, ?, ...)` groups for a multi-row insert; `jsonb` marks a JSON column. */
function valueGroups(rows: number, columns: readonly string[], jsonb: readonly string[] = []): string {
  const group = `(${columns.map((column) => jsonb.includes(column) ? "?::jsonb" : "?").join(", ")})`
  return Array.from({ length: rows }, () => group).join(", ")
}

/**
 * Enqueues outbox rows. A row whose (platform, event_name, event_id) already
 * exists is skipped, which is what makes every event send at most once.
 * Returns how many rows were inserted.
 */
export async function insertOutbox(db: Db, rows: OutboxInsert[]): Promise<number> {
  if (!rows.length) return 0
  const bindings: unknown[] = []
  for (const row of rows) {
    bindings.push(row.platform, row.env, row.destination, row.event_name, row.event_id, row.event_time, row.source,
      row.order_id ?? null, row.payload == null ? null : JSON.stringify(row.payload), row.status ?? "pending",
      row.last_error == null ? null : String(row.last_error).slice(0, 500))
  }
  const result = await db.raw(
    `insert into tracking_event (${OUTBOX_COLUMNS.join(", ")}) values ${valueGroups(rows.length, OUTBOX_COLUMNS, ["payload"])} on conflict (platform, event_name, event_id) do nothing`,
    bindings as any[]
  )
  return affected(result)
}

/**
 * Records dashboard hits; a repeated (event_name, event_id) is skipped, so a
 * resent batch counts once. Varchar columns are cut to their size instead of
 * failing the whole transaction. Returns how many rows were inserted.
 */
export async function insertHits(db: Db, rows: HitInsert[]): Promise<number> {
  if (!rows.length) return 0
  const bindings: unknown[] = []
  for (const row of rows) {
    const country = typeof row.country === "string" && /^[A-Z]{2}$/.test(row.country) ? row.country : null
    bindings.push(row.event_name, row.event_id, row.origin, row.visitor_id ?? null, row.session_id ?? null,
      row.source ?? null, row.campaign == null ? null : String(row.campaign).slice(0, 80), row.device_class ?? null,
      row.audience ?? null, row.host, row.path == null ? null : String(row.path).slice(0, 300), row.handle ?? null,
      row.variant_id ?? null, row.device ?? null, row.case_type ?? null, row.value ?? null, row.items ?? null,
      country, row.flags ?? 0)
  }
  const result = await db.raw(
    `insert into tracking_hit (${HIT_COLUMNS.join(", ")}) values ${valueGroups(rows.length, HIT_COLUMNS)} on conflict (event_name, event_id) do nothing`,
    bindings as any[]
  )
  return affected(result)
}

export async function getState<T>(db: Db, key: string): Promise<T | null> {
  const result: any = await db.raw("select value from tracking_state where key = ?", [key])
  const value = result?.rows?.[0]?.value
  return value === undefined || value === null ? null : value as T
}

export async function setState(db: Db, key: string, value: unknown): Promise<void> {
  await db.raw(
    "insert into tracking_state (key, value, updated_at) values (?, ?::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value ?? null)]
  )
}

/**
 * Adds to the hourly counters (2.4): one upsert for all keys, bucketed by the
 * hour of `at`. Zero, fractional and non-numeric deltas are ignored.
 */
export async function bumpCounters(db: Db, deltas: Record<string, number>, at: Date = new Date()): Promise<void> {
  const entries = Object.entries(deltas)
    .filter(([key, n]) => key && key.length <= 80 && Number.isSafeInteger(n) && n !== 0)
  if (!entries.length) return
  const bindings: unknown[] = []
  for (const [key, n] of entries) bindings.push(at, key, n)
  const groups = entries.map(() => "(date_trunc('hour', ?::timestamptz), ?, ?)").join(", ")
  await db.raw(
    `insert into tracking_counter (hour, key, n) values ${groups} on conflict (hour, key) do update set n = tracking_counter.n + excluded.n`,
    bindings as any[]
  )
}
