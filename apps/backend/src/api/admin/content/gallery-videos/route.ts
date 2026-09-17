import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"

/** GET /admin/content/gallery-videos - every gallery video, newest first. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const videos = await service.listGalleryVideos(
    {},
    { order: { design_slug: "ASC", case_type: "ASC" } }
  )
  res.json({ videos: videos ?? [] })
}

/**
 * POST /admin/content/gallery-videos - add or replace the video for a
 * (design, case type). One video per pair, so an existing one is updated.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const design_slug = str(body.design_slug)
  const case_type = str(body.case_type)
  const video_url = str(body.video_url)
  const poster_url = str(body.poster_url) || null
  const positionNum = Number(body.position)
  const position =
    Number.isFinite(positionNum) && positionNum >= 1
      ? Math.floor(positionNum)
      : 1

  if (!design_slug || !case_type || !video_url) {
    return res
      .status(400)
      .json({ message: "design_slug, case_type and video_url are required." })
  }

  const [existing] = await service.listGalleryVideos({ design_slug, case_type })
  if (existing) {
    await service.updateGalleryVideos({
      id: existing.id,
      video_url,
      poster_url,
      position,
    })
  } else {
    await service.createGalleryVideos({
      design_slug,
      case_type,
      video_url,
      poster_url,
      position,
    })
  }

  const videos = await service.listGalleryVideos(
    {},
    { order: { design_slug: "ASC", case_type: "ASC" } }
  )
  res.json({ videos })
}
