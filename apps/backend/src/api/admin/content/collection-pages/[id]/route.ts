import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getCollectionPages, shapeCollectionPage } from "../../../../../modules/content/config"
import {
  normaliseBlocks,
  normaliseTemplate,
  normaliseTheme,
  safeUrl,
} from "../../../../../modules/content/collection-templates"

const TEXT_FIELDS = [
  "title",
  "hero_eyebrow",
  "hero_heading",
  "hero_copy",
  "cta_label",
  "intro_heading",
  "intro_copy",
]
const URL_FIELDS = ["hero_image_url", "hero_mobile_image_url", "card_image_url", "cta_href"]

/**
 * POST /admin/content/collection-pages/:id - edit content, look or visibility.
 * show_in_menu puts the page in the phone menu's Collections row.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: req.params.id }

  for (const key of TEXT_FIELDS) {
    if (typeof body[key] === "string") {
      patch[key] = (body[key] as string).trim() || null
    }
  }
  for (const key of URL_FIELDS) {
    if (typeof body[key] === "string") {
      const raw = (body[key] as string).trim()
      const url = safeUrl(raw)
      if (raw && !url) {
        return res.status(400).json({ message: `${key} must be an https:// URL or a /path.` })
      }
      patch[key] = url
    }
  }
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible
  if (typeof body.show_in_menu === "boolean") patch.show_in_menu = body.show_in_menu
  if (body.template !== undefined) patch.template = normaliseTemplate(body.template)
  if (body.theme !== undefined) patch.theme = normaliseTheme(body.theme)
  if (body.blocks !== undefined) patch.blocks = normaliseBlocks(body.blocks)

  // The design list is an ordered set of slugs; an empty list means "all".
  if (Array.isArray(body.design_slugs)) {
    patch.design_slugs = [
      ...new Set(
        (body.design_slugs as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim())
      ),
    ]
  }

  await service.updateCollectionPages(patch)
  res.json({ pages: (await getCollectionPages(service)).map(shapeCollectionPage) })
}

/** DELETE /admin/content/collection-pages/:id - the URL falls back to a plain grid. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const pages = await getCollectionPages(service)
  if (pages.length <= 1) {
    // An empty table reseeds the twelve defaults on the next read.
    return res.status(400).json({ message: "Keep at least one page - hide it instead." })
  }
  await service.deleteCollectionPages(req.params.id)
  res.json({ pages: (await getCollectionPages(service)).map(shapeCollectionPage) })
}
