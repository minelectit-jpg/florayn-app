import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { backfillOps } from "../../../../lib/order-ops"

/**
 * POST /admin/order-ops/backfill
 * Give every existing order a workflow row (default `processing`) so historical
 * orders show up in the tabs. Idempotent - only creates the missing rows.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const created = await backfillOps(req.scope)
  return res.json({ success: true, created })
}
