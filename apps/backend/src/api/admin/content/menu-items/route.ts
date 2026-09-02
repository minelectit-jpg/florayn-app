import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getContent } from "../../../../modules/content/config"

/** POST /admin/content/menu-items - add a link to a section. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const section_id = String(body.section_id ?? "").trim()
  const label = String(body.label ?? "").trim()

  if (!section_id || !label) {
    return res
      .status(400)
      .json({ message: "section_id and label are required" })
  }

  const existing = await service.listMenuItems({ section_id })
  await service.createMenuItems({
    section_id,
    group: typeof body.group === "string" && body.group.trim() ? body.group.trim() : null,
    label,
    href: String(body.href ?? "#").trim() || "#",
    badge: typeof body.badge === "string" && body.badge.trim() ? body.badge.trim() : null,
    position: existing.length,
    is_visible: true,
  })

  const next = await getContent(service)
  res.json({ menuSections: next.menuSections, items: next.items })
}
