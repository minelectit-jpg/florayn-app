import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  countsByStatus,
  isWorkflowStatus,
  listOrdersForStatus,
} from "../../../lib/order-ops"

/**
 * GET /admin/order-ops?status=processing&limit=&offset=&q=
 * One workflow tab of orders (newest first) plus the counts for every tab, so
 * the order manager can render the tab badges and the table in one request.
 * `q` searches every order (number, florayn.com number, phone, name, email).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status = (req.query.status as string) || "all"
  if (status !== "all" && !isWorkflowStatus(status)) {
    return res.status(400).json({ message: "Unknown status." })
  }
  const limit = Number(req.query.limit ?? 50)
  const offset = Number(req.query.offset ?? 0)
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : ""

  const [{ orders, count }, counts] = await Promise.all([
    listOrdersForStatus(req.scope, status as any, {
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      q,
    }),
    countsByStatus(req.scope),
  ])

  return res.json({ status, orders, count, counts })
}
