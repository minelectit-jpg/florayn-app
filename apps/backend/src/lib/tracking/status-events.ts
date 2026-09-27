import type { WorkflowStatus } from "../order-ops"
import { trackingDb, withTransaction, type OrderContextRow, type OutboxInsert } from "./db"
import {
  buildOrderEventRows,
  importedOrderIds,
  insertOrderEvents,
  loadOrderContexts,
  loadOrdersForEvents,
} from "./order-events"
import { scheduleFlush } from "./outbox"
import { loadTrackingSettings } from "./settings"

/**
 * The COD status events (TRACKING.md 7, I2): when an order moves through the
 * workflow tabs, Meta hears that the Purchase it already has was confirmed,
 * delivered or returned. lib/order-status.ts calls enqueueStatusEvents after
 * every workflow_status change it writes; this file only decides which events
 * a move produces and queues their outbox rows. The outbox sender sends them.
 *
 * Only orders placed through the storefront checkout have a stored context,
 * so staff-created, WordPress-imported and pre-tracking orders never produce
 * an event. The rows themselves come from lib/tracking/order-events.ts
 * (buildOrderEventRows), the same builder as the Purchase: Meta only,
 * `system_generated`, event_time = the transition time, the destination of
 * the context's STORED environment, and `skipped` while Meta or that event's
 * toggle is off. Each event is queued at most once per order by the outbox
 * key (platform, event_name, oc|dl|rt-fl-N) while its row is kept.
 *
 * Fast database work only, no network. Raw SQL through the PG_CONNECTION knex
 * is the documented exception of lib/tracking/db.ts.
 */

export type StatusEventKind = "OrderConfirmed" | "Delivered" | "Returned"
export type StatusTransition = { orderId: string; from: WorkflowStatus | string | null; to: WorkflowStatus | string; at: Date }

/** Moves into any of these mean the customer confirmed the COD order (I2). */
const CONFIRMED: ReadonlySet<string> = new Set(["confirmed", "shipped", "delivered"])
/** An order only gets here after it was confirmed (the workflow is confirmed -> shipped -> delivered | returned). */
const PAST_CONFIRMATION: ReadonlySet<string> = new Set(["confirmed", "shipped", "delivered", "returned"])

/**
 * The events one move produces. Pure. Nothing when the status did not change.
 * OrderConfirmed for a move into confirmed, shipped or delivered from a
 * status that is not already past confirmation: a courier booking straight
 * from processing counts, and so does processing -> cancelled -> confirmed
 * (the outbox key keeps that to one per order). Moving on along the workflow
 * (confirmed -> shipped -> delivered) is not a new confirmation; this matters
 * because sent outbox rows are pruned after 8 days, and a delivery that comes
 * later must not send the confirmation twice. A move into delivered also
 * gives Delivered, into returned Returned; refunded, cancelled and processing
 * give nothing.
 */
export function statusEventsFor(from: unknown, to: unknown): StatusEventKind[] {
  if (typeof to !== "string" || from === to) return []
  const kinds: StatusEventKind[] = []
  if (CONFIRMED.has(to) && !(typeof from === "string" && PAST_CONFIRMATION.has(from))) kinds.push("OrderConfirmed")
  if (to === "delivered") kinds.push("Delivered")
  if (to === "returned") kinds.push("Returned")
  return kinds
}

/**
 * A context that can produce a row at all. buildOrderEventRows decides again;
 * this only saves the order lookup for the many orders that will not.
 */
function sendable(ctx: OrderContextRow | undefined): ctx is OrderContextRow {
  return Boolean(ctx && ctx.trusted === true && ctx.staff !== true && ctx.optout !== true && ctx.env !== null)
}

/**
 * Queues the outbox rows for a set of status moves and returns how many were
 * inserted. Skips orders without a stored context, untrusted, staff and
 * opted-out contexts, drafts and imported orders. All rows go in one
 * transaction; an event that already has its row keeps it. Throws on a
 * database error (the caller catches).
 */
export async function enqueueStatusEvents(container: any, transitions: StatusTransition[]): Promise<number> {
  const moves = (Array.isArray(transitions) ? transitions : [])
    .filter((t) => t && typeof t.orderId === "string" && t.orderId !== "" && statusEventsFor(t.from, t.to).length > 0)
  if (!moves.length) return 0
  const ids = [...new Set(moves.map((t) => t.orderId))]
  const contexts = await loadOrderContexts(trackingDb(container), ids)
  const candidates = ids.filter((id) => sendable(contexts.get(id)))
  if (!candidates.length) return 0
  const [orders, imported, settings] = await Promise.all([
    loadOrdersForEvents(container, candidates),
    importedOrderIds(container, candidates),
    loadTrackingSettings(container),
  ])
  const rows = new Map<string, OutboxInsert>()
  for (const move of moves) {
    const ctx = contexts.get(move.orderId)
    const order = orders.get(move.orderId)
    if (!sendable(ctx) || !order || order.is_draft_order || imported.has(order.id)) continue
    for (const kind of statusEventsFor(move.from, move.to)) {
      for (const row of buildOrderEventRows({ kind, order, ctx, settings, at: move.at, source: "status" })) {
        // The first move wins inside one call, as the outbox key does across calls.
        const key = `${row.platform}|${row.event_name}|${row.event_id}`
        if (!rows.has(key)) rows.set(key, row)
      }
    }
  }
  if (!rows.size) return 0
  const inserted = await withTransaction(container, async (trx) => {
    await trx.raw("set local statement_timeout = '5s'")
    return insertOrderEvents(trx, [...rows.values()])
  })
  if (inserted) scheduleFlush(container)
  return inserted
}
