import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  countsByStatus,
  isWorkflowStatus,
  listOrdersForStatus,
} from "../../../lib/order-ops"

/**
 * GET /admin/order-ops?status=processing&limit=&offset=
 * One workflow tab of orders (newest first) plus the counts for every tab, so
 * the order manager can render the tab badges and the table in one request.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status = (req.query.status as string) || "processing"
  if (!isWorkflowStatus(status)) {
    return res.status(400).json({ message: "Unknown status." })
  }
  const limit = Number(req.query.limit ?? 50)
  const offset = Number(req.query.offset ?? 0)

  const [{ orders, count }, counts] = await Promise.all([
    listOrdersForStatus(req.scope, status, {
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    }),
    countsByStatus(req.scope),
  ])

  return res.json({ status, orders, count, counts })
}
