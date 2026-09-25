import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { needsCaseTypes, sanitizeMenuSectionInput } from "../../../../../lib/menu-section-input"
import { CATALOG_MODULE } from "../../../../../modules/catalog"
import { CONTENT_MODULE } from "../../../../../modules/content"
import { getContent } from "../../../../../modules/content/config"

/** The active case-type slugs a devices section may open its models on. */
async function activeCaseTypeSlugs(scope: MedusaRequest["scope"]): Promise<string[]> {
  const catalog: any = scope.resolve(CATALOG_MODULE)
  const rows = await catalog.listCaseTypes({ is_active: true }, { select: ["slug"], take: 500 })
  return (rows ?? []).map((c: any) => c.slug)
}

/**
 * POST /admin/content/menu-sections/:id - label, href, is_visible, position,
 * and the typed fields: kind, image_url, badge, placement and config, checked
 * by lib/menu-section-input.ts (400 with the admin's message when one is
 * wrong). A footer section stays links, shown everywhere.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const patch: Record<string, unknown> = { id: req.params.id }

  const [current] = await service.listMenuSections({ id: req.params.id }, { take: 1 })
  if (!current) return res.status(404).json({ message: "Menu section not found." })

  if (typeof body.label === "string" && body.label.trim()) {
    patch.label = body.label.trim()
  }
  if (typeof body.href === "string") patch.href = body.href.trim() || null
  if (typeof body.is_visible === "boolean") patch.is_visible = body.is_visible
  if (Number.isFinite(Number(body.position))) {
    patch.position = Math.round(Number(body.position))
  }

  try {
    const caseTypes = current.menu !== "footer" && needsCaseTypes(body, current.kind) ? await activeCaseTypeSlugs(req.scope) : []
    Object.assign(patch, sanitizeMenuSectionInput(body, { menu: current.menu, kind: current.kind, caseTypes }))
  } catch (error: any) {
    return res.status(400).json({ message: error?.message ?? String(error) })
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
