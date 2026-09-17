import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"

/** DELETE /admin/content/featured-picks/:id - remove one pick. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  await service.deleteFeaturedPicks(req.params.id)
  res.json({
    picks: await service.listFeaturedPicks({}, { order: { position: "ASC" } }),
  })
}
