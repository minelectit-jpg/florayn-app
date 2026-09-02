import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getContent } from "../../../../modules/content/config"

/** POST /admin/content/menu-sections - add a top-level entry or footer column. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const menu = body.menu === "footer" ? "footer" : "primary"
  const label = String(body.label ?? "").trim()

  if (!label) {
    return res.status(400).json({ message: "label is required" })
  }

  const { menuSections } = await getContent(service)
  await service.createMenuSections({
    menu,
    label,
    href: typeof body.href === "string" && body.href.trim() ? body.href.trim() : null,
    position: menuSections.filter((s: any) => s.menu === menu).length,
    is_visible: true,
  })

  const next = await getContent(service)
  res.json({ menuSections: next.menuSections, items: next.items })
}
