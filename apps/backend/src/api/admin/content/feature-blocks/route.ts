import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getFeatureBlocks } from "../../../../modules/content/config"

/** GET /admin/content/feature-blocks - every block, hidden ones included. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const blocks = await getFeatureBlocks(service)
  res.json({ blocks })
}

/**
 * POST /admin/content/feature-blocks - add a block. It lands last; the body
 * may carry initial copy/media, or none for a blank block to fill in.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  const existing = await service.listFeatureBlocks({})
  const position = existing.length
    ? Math.max(...existing.map((b: any) => b.position ?? 0)) + 1
    : 0

  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null

  await service.createFeatureBlocks({
    title: str(body.title),
    description: str(body.description),
    image_url: str(body.image_url),
    video_url: str(body.video_url),
    position,
    is_visible: true,
  })

  const blocks = await getFeatureBlocks(service)
  res.json({ blocks })
}
