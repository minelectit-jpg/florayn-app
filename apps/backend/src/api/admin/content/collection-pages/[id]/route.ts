import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getCollectionPages } from "../../../../../modules/content/config"

/** POST /admin/content/collection-pages/:id */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: req.params.id }

  for (const key of [
    "hero_image_url",
    "hero_eyebrow",
    "hero_heading",
    "cta_label",
    "cta_href",
    "intro_heading",
    "intro_copy",
  ]) {
    if (typeof body[key] === "string") {
      patch[key] = (body[key] as string).trim() || null
    }
  }
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible

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
  res.json({ pages: await getCollectionPages(service) })
}
