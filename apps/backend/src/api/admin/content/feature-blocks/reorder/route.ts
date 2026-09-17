import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getFeatureBlocks } from "../../../../../modules/content/config"

/**
 * POST /admin/content/feature-blocks/reorder - reorder in one call.
 * Body: { order: string[] } - block ids, top to bottom.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const order = (req.body as any)?.order

  if (!Array.isArray(order) || !order.length) {
    return res.status(400).json({ message: "order must be a list of ids" })
  }

  for (const [position, id] of order.entries()) {
    await service.updateFeatureBlocks({ id, position })
  }

  const blocks = await getFeatureBlocks(service)
  res.json({ blocks })
}
