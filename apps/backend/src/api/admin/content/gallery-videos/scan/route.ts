import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../../../modules/catalog"
import { CONTENT_MODULE } from "../../../../../modules/content"
import { listAllUnder, r2PublicUrl } from "../../../../../lib/r2"

const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i

/**
 * POST /admin/content/gallery-videos/scan - read the R2 bucket for videos that
 * follow the folder convention `<design>/<case-type>/<file>.mp4` (no device
 * level, since the clip is shared across devices) and upsert a gallery video
 * for each. The case-type folder is a slug; it is matched to a case type's name
 * so the storefront can key on it.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const caseTypes = await catalog.listCaseTypes({})
  const nameBySlug = new Map<string, string>(
    caseTypes.map((c: any) => [c.slug, c.name])
  )

  const keys = await listAllUnder("")
  let created = 0
  let updated = 0
  let skipped = 0

  for (const key of keys) {
    if (!VIDEO_RE.test(key)) continue
    const parts = key.split("/").filter(Boolean)
    // Exactly design / case-type / file.ext — a device level would make it 4.
    if (parts.length !== 3) {
      skipped++
      continue
    }
    const [design_slug, caseSlug] = parts
    const case_type = nameBySlug.get(caseSlug)
    if (!case_type) {
      skipped++
      continue
    }

    const video_url = r2PublicUrl(key)
    const [existing] = await service.listGalleryVideos({
      design_slug,
      case_type,
    })
    if (existing) {
      if (existing.video_url !== video_url) {
        await service.updateGalleryVideos({ id: existing.id, video_url })
        updated++
      }
    } else {
      await service.createGalleryVideos({ design_slug, case_type, video_url })
      created++
    }
  }

  const videos = await service.listGalleryVideos(
    {},
    { order: { design_slug: "ASC", case_type: "ASC" } }
  )
  res.json({ created, updated, skipped, videos })
}
