import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getContent } from "../../../../modules/content/config"

/**
 * POST /admin/content/home-sections - reorder in one call.
 * Body: { order: string[] } - section ids, top to bottom.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const order = (req.body as any)?.order

  if (!Array.isArray(order) || !order.length) {
    return res.status(400).json({ message: "order must be a list of ids" })
  }

  for (const [position, id] of order.entries()) {
    await service.updateHomeSections({ id, position })
  }

  const { sections } = await getContent(service)
  res.json({ sections })
}
