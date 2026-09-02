import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getContent } from "../../../../../modules/content/config"

/** POST /admin/content/menu-sections/:id */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const patch: Record<string, unknown> = { id: req.params.id }

  if (typeof body.label === "string" && body.label.trim()) {
    patch.label = body.label.trim()
  }
  if (typeof body.href === "string") patch.href = body.href.trim() || null
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible
  if (Number.isFinite(Number(body.position))) {
    patch.position = Math.round(Number(body.position))
  }

  await service.updateMenuSections(patch)
  const next = await getContent(service)
  res.json({ menuSections: next.menuSections, items: next.items })
}

/** DELETE removes the column and every link inside it. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const owned = await service.listMenuItems({ section_id: req.params.id })

  if (owned.length) {
    await service.deleteMenuItems(owned.map((i: any) => i.id))
  }
  await service.deleteMenuSections(req.params.id)

  const next = await getContent(service)
  res.json({ menuSections: next.menuSections, items: next.items })
}
