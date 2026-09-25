import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { needsCaseTypes, sanitizeMenuSectionInput } from "../../../../lib/menu-section-input"
import { CATALOG_MODULE } from "../../../../modules/catalog"
import { CONTENT_MODULE } from "../../../../modules/content"
import { copyMenu, getContent, MEN_MENU } from "../../../../modules/content/config"

/** The active case-type slugs a devices section may open its models on. */
async function activeCaseTypeSlugs(scope: MedusaRequest["scope"]): Promise<string[]> {
  const catalog: any = scope.resolve(CATALOG_MODULE)
  const rows = await catalog.listCaseTypes({ is_active: true }, { select: ["slug"], take: 500 })
  return (rows ?? []).map((c: any) => c.slug)
}

/**
 * POST /admin/content/menu-sections - add a top-level entry or footer column.
 * menu: "primary" (Women header), "primary-men" (Men header) or "footer".
 * kind (links | devices | case_types | collections) defaults to links and
 * starts that kind's settings; placement, image_url, badge and config are
 * accepted too (lib/menu-section-input.ts). The footer is always links.
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

  let typed
  try {
    const caseTypes = menu !== "footer" && needsCaseTypes(body) ? await activeCaseTypeSlugs(req.scope) : []
    typed = sanitizeMenuSectionInput(body, { menu, kind: null, caseTypes })
  } catch (error: any) {
    return res.status(400).json({ message: error?.message ?? String(error) })
  }

  const { menuSections } = await getContent(service)
  await service.createMenuSections({
    menu,
    label,
    href: typeof body.href === "string" && body.href.trim() ? body.href.trim() : null,
    position: menuSections.filter((s: any) => s.menu === menu).length,
    is_visible: true,
    ...typed,
  })

  const next = await getContent(service)
  res.json({ menuSections: next.menuSections, items: next.items })
}
