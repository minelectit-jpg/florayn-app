import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ensureOps, opsByOrderId, opsService, type OrderOpRow, type WorkflowStatus } from "./order-ops"
import { enqueueStatusEvents, type StatusTransition } from "./tracking/status-events"

/**
 * The one way an order's workflow_status changes (TRACKING.md 7). Staff moves
 * in the Order Manager, courier booking, courier sync and the Steadfast
 * webhook all build StatusChanges and hand them here, so every move is
 * written the same way (status_changed_at only when the status really
 * changes) and every real move of a storefront order queues its COD ad events
 * (OrderConfirmed, Delivered, Returned) in lib/tracking/status-events.ts.
 *
 * The status write is the work; the ad events are a side effect that can
 * never fail it or hold it up: their errors are caught and logged in one
 * short line, and the caller waits at most ENQUEUE_BUDGET_MS for them.
 * Imported florayn.com orders (op.source set) never queue events. The import
 * itself (lib/florayn-import.ts) writes history directly and stays apart.
 *
 * lib/order-ops.ts must not import this file or anything else new: a test
 * loads it with a stub that answers every import (tests/florayn-import.test.cjs).
 */

export type TransitionSource = "staff" | "courier-send" | "courier-sync" | "steadfast-webhook"

export type StatusChange = {
  op: OrderOpRow
  /** The status to move to; op.workflow_status to write only `extra`. */
  to: WorkflowStatus
  /** Other order_op fields written in the same update (the Steadfast fields). */
  extra?: Record<string, unknown>
  /** When the move happened; defaults to now. */
  at?: Date
  via: TransitionSource
}

/** How long a status write waits for its ad events; past it they finish in the background. */
const ENQUEUE_BUDGET_MS = 2_000
/** Written only from `to`, never through `extra`. */
const STATUS_FIELDS = new Set(["id", "workflow_status", "status_changed_at"])

function extraFields(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!STATUS_FIELDS.has(key)) fields[key] = value
  }
  return fields
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

/** The error's name and code only: never a message, which could hold order data. */
function reasonOf(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown } | null
  const code = typeof e?.code === "string" && /^[A-Za-z0-9_]{1,20}$/.test(e.code) ? e.code : null
  const name = typeof e?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "Error"
  return code ? `${name} ${code}` : name
}

/** Queues the COD events for the moves, within the budget. Never throws. */
async function queueStatusEvents(container: any, transitions: StatusTransition[], via: string): Promise<void> {
  let timer: any = null
  try {
    const what = `${transitions.length === 1 ? "1 order" : `${transitions.length} orders`} (${via})`
    const work = Promise.resolve().then(() => enqueueStatusEvents(container, transitions)).then(
      () => "done",
      (error) => {
        logLine(container, `Order status: the ad events for ${what} were not queued (${reasonOf(error)}).`)
        return "failed"
      }
    )
    const late = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("late"), ENQUEUE_BUDGET_MS)
      timer?.unref?.()
    })
    if (await Promise.race([work, late]) === "late") {
      logLine(container, `Order status: the ad events for ${what} are still being queued after ${ENQUEUE_BUDGET_MS} ms.`)
    }
  } catch {
    // Never let tracking touch the status change.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Writes the changes in ONE updateOrderOps call: `extra` always, and
 * workflow_status with status_changed_at only for a change whose `to`
 * differs from the op's current status. A change with nothing to write is
 * left out. Then queues the ad events for the rows whose status changed and
 * that were not imported. Returns how many rows were written and how many of
 * them changed status. A failed status write throws, as before; the ad events
 * never do.
 */
export async function applyStatusChanges(container: any, changes: StatusChange[]): Promise<{ updated: number; changed: number }> {
  const updates: Record<string, unknown>[] = []
  const transitions: StatusTransition[] = []
  const sources = new Set<TransitionSource>()
  let changed = 0
  for (const change of changes) {
    const { op, to } = change
    if (!op?.id) continue
    const at = change.at ?? new Date()
    const moves = to !== op.workflow_status
    const update = { id: op.id, ...extraFields(change.extra), ...(moves ? { workflow_status: to, status_changed_at: at } : {}) }
    if (Object.keys(update).length === 1) continue
    updates.push(update)
    if (!moves) continue
    changed += 1
    if (op.source) continue
    transitions.push({ orderId: op.order_id, from: op.workflow_status, to, at })
    sources.add(change.via)
  }
  if (!updates.length) return { updated: 0, changed: 0 }
  await opsService(container).updateOrderOps(updates)
  if (transitions.length) await queueStatusEvents(container, transitions, [...sources].join(", "))
  return { updated: updates.length, changed }
}

/**
 * Moves orders to a status by hand (the Order Manager tabs), creating op rows
 * as needed. Replaces setWorkflowStatus from lib/order-ops.ts.
 */
export async function moveOrdersToStatus(container: any, orderIds: string[], status: WorkflowStatus): Promise<void> {
  const ids = [...new Set(orderIds)]
  await ensureOps(container, ids)
  const existing = await opsByOrderId(container, ids)
  const changes = ids
    .map((id) => existing.get(id))
    .filter((op): op is OrderOpRow => Boolean(op))
    .map((op): StatusChange => ({ op, to: status, via: "staff" }))
  await applyStatusChanges(container, changes)
}
