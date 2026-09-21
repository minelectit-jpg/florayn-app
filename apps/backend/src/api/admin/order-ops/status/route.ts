import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { isWorkflowStatus, setWorkflowStatus } from "../../../../lib/order-ops"

/**
 * POST /admin/order-ops/status { order_ids: string[], status }
 * Move one or many orders to a workflow status (the merchant advancing them
 * through the tabs, e.g. processing -> confirmed, or marking refunded).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { order_ids?: unknown; status?: unknown }
  const orderIds = Array.isArray(body.order_ids)
    ? body.order_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : []
  if (!orderIds.length) return res.status(400).json({ message: "No orders selected." })
  if (!isWorkflowStatus(body.status)) {
    return res.status(400).json({ message: "Unknown status." })
  }
  await setWorkflowStatus(req.scope, orderIds, body.status)
  return res.json({ success: true, updated: orderIds.length })
}
