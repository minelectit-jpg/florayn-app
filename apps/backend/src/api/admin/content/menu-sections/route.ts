import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { copyMenu, getContent, MEN_MENU } from "../../../../modules/content/config"

/**
 * POST /admin/content/menu-sections - add a top-level entry or footer column.
 * menu: "primary" (Women header), "primary-men" (Men header) or "footer".
 *
 * { action: "copy-to-men" } starts an empty Men header from the Women one.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  if (body.action === "copy-to-men") {
    await getContent(service)
    const copied = await copyMenu(service, "primary", MEN_MENU)
    if (!copied) return res.status(400).json({ message: "The Men menu already has entries." })
    const next = await getContent(service)
    return res.json({ menuSections: next.menuSections, items: next.items })
  }
  const menu = body.menu === "footer" ? "footer" : body.menu === MEN_MENU ? MEN_MENU : "primary"
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
