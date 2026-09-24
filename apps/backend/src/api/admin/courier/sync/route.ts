import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setTimeout as delay } from "node:timers/promises"

import { opsByOrderId, opsService, type OrderOpRow } from "../../../../lib/order-ops"
import { mapSteadfastStatus, statusByConsignment } from "../../../../lib/steadfast"

const MAX_PER_SYNC = 60

/**
 * POST /admin/courier/sync { order_ids?: string[] }
 * Refresh Steadfast delivery status for the given orders, or (with no ids) for
 * all `shipped` orders that have a consignment. Advances the workflow status
 * when Steadfast reports delivered / returned. Bounded and paced to respect the
 * courier's rate limit.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { order_ids?: unknown }
  const svc = opsService(req.scope)

  let targets: OrderOpRow[]
  if (Array.isArray(body.order_ids) && body.order_ids.length) {
    const ids = body.order_ids.filter((x): x is string => typeof x === "string")
    const map = await opsByOrderId(req.scope, ids)
    targets = ids.map((id) => map.get(id)).filter((o): o is OrderOpRow => Boolean(o))
  } else {
    targets = await svc.listOrderOps(
      { workflow_status: "shipped" },
      { order: { steadfast_synced_at: "ASC" }, take: MAX_PER_SYNC }
    )
  }
  targets = targets.filter((op) => op.steadfast_consignment_id).slice(0, MAX_PER_SYNC)

  let checked = 0
  let changed = 0
  const updates: any[] = []
  for (const op of targets) {
    const r = await statusByConsignment(req.scope, op.steadfast_consignment_id as string)
    checked++
    if (r.ok && r.deliveryStatus) {
      const workflow = mapSteadfastStatus(r.deliveryStatus)
      const update: any = {
        id: op.id,
        steadfast_status: r.deliveryStatus,
        steadfast_synced_at: new Date(),
      }
      // Only advance forward off `shipped`; never override a manual refund.
      if (workflow !== op.workflow_status && op.workflow_status === "shipped") {
        update.workflow_status = workflow
        update.status_changed_at = new Date()
        changed++
      }
      updates.push(update)
    }
    await delay(120)
  }
  if (updates.length) await svc.updateOrderOps(updates)

  return res.json({ success: true, checked, changed })
}
