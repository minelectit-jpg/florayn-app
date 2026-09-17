import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getGalleryVideos } from "../../../../modules/content/config"

/**
 * GET /store/content/gallery-videos?design=<slug> - the gallery videos for one
 * design, as { case_type -> { video_url, poster_url } }. The storefront picks
 * the entry for the live case type.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const design = String((req.query as any)?.design ?? "").trim()
  if (!design) {
    return res.json({ videos: {} })
  }

  const rows = await getGalleryVideos(service, design)
  const videos: Record<string, { video_url: string; poster_url: string | null }> =
    {}
  for (const r of rows) {
    videos[r.case_type] = {
      video_url: r.video_url,
      poster_url: r.poster_url ?? null,
    }
  }
  res.json({ videos })
}
