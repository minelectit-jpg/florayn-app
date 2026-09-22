import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { listLiveDesigns } from "../../../../lib/design-admin"

/**
 * GET /admin/designs/live - every design currently live in the store (grouped
 * from its products), for the Design Manager list. Unlike GET /admin/designs
 * (which lists the static catalogue), this reflects what actually exists,
 * including uploaded designs.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const designs = await listLiveDesigns(req.scope, true)
  res.json({ designs, count: designs.length })
}
