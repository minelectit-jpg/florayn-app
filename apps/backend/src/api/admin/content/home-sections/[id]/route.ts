import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getContent } from "../../../../../modules/content/config"

/** POST /admin/content/home-sections/:id - edit copy or visibility. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: req.params.id }

  for (const key of ["title", "subtitle", "eyebrow", "cta_label", "cta_href"]) {
    if (typeof body[key] === "string") {
      patch[key] = (body[key] as string).trim() || null
    }
  }
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible
  if (body.config && typeof body.config === "object") patch.config = body.config

  await service.updateHomeSections(patch)
  const { sections } = await getContent(service)
  res.json({ sections })
}
