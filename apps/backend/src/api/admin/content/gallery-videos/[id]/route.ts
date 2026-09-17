import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"

/** DELETE /admin/content/gallery-videos/:id - remove one gallery video. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  await service.deleteGalleryVideos(req.params.id)
  const videos = await service.listGalleryVideos(
    {},
    { order: { design_slug: "ASC", case_type: "ASC" } }
  )
  res.json({ videos })
}
