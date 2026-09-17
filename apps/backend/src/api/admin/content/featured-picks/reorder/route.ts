import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"

/**
 * POST /admin/content/featured-picks/reorder - reorder in one call.
 * Body: { order: string[] } - pick ids, top to bottom.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const order = (req.body as any)?.order

  if (!Array.isArray(order) || !order.length) {
    return res.status(400).json({ message: "order must be a list of ids" })
  }

  for (const [position, id] of order.entries()) {
    await service.updateFeaturedPicks({ id, position })
  }

  res.json({
    picks: await service.listFeaturedPicks({}, { order: { position: "ASC" } }),
  })
}
