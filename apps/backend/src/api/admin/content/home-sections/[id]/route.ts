import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getContent } from "../../../../../modules/content/config"
import { normaliseHomeConfig } from "../../../../../modules/content/home-sections"

/** POST /admin/content/home-sections/:id - edit copy, config or visibility. */
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
  if (body.config && typeof body.config === "object") {
    const [existing] = await service.listHomeSections({ id: req.params.id }, { take: 1 })
    if (!existing) return res.status(404).json({ message: "Section not found." })
    patch.config = normaliseHomeConfig(existing.type, body.config)
  }

  await service.updateHomeSections(patch)
  const { sections } = await getContent(service)
  res.json({ sections })
}

/** DELETE /admin/content/home-sections/:id - remove a section for good. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const { sections } = await getContent(service)
  if (sections.length <= 1) {
    // An empty table reseeds the defaults on the next read; hide instead.
    return res.status(400).json({ message: "Keep at least one section - hide it instead." })
  }
  await service.deleteHomeSections(req.params.id)
  const fresh = await getContent(service)
  res.json({ sections: fresh.sections })
}
