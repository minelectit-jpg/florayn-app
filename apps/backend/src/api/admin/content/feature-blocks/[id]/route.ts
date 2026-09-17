import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getFeatureBlocks } from "../../../../../modules/content/config"

/** POST /admin/content/feature-blocks/:id - edit copy, media or visibility. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: req.params.id }

  for (const key of ["title", "description", "image_url", "video_url"]) {
    if (typeof body[key] === "string") {
      patch[key] = (body[key] as string).trim() || null
    }
  }
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible

  await service.updateFeatureBlocks(patch)
  const blocks = await getFeatureBlocks(service)
  res.json({ blocks })
}

/** DELETE /admin/content/feature-blocks/:id - remove a block. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  await service.deleteFeatureBlocks(req.params.id)
  const blocks = await getFeatureBlocks(service)
  res.json({ blocks })
}
