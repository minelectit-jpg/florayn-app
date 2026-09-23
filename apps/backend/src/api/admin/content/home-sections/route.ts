import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getContent } from "../../../../modules/content/config"
import {
  blankHomeSection,
  isHomeSectionType,
  normaliseHomeConfig,
} from "../../../../modules/content/home-sections"

/** The home page a section belongs to; rows from before the split are Women. */
function sectionAudience(section: any): "women" | "men" {
  return section?.audience === "men" ? "men" : "women"
}

/** A key no other section uses: "<base>", then "<base>-2", "<base>-3"... */
function uniqueKey(base: string, taken: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section"
  if (!taken.has(slug)) return slug
  let n = 2
  while (taken.has(`${slug}-${n}`)) n++
  return `${slug}-${n}`
}

/**
 * POST /admin/content/home-sections
 *
 *   { order: string[] }                              reorder, ids top to bottom
 *   { action: "create", type, audience?, after_id? } add a blank section of a type
 *   { action: "duplicate", id, audience? }           copy a section, right below it,
 *                                                    or to the end of the other
 *                                                    home page ("Copy to Men")
 *
 * Women and Men each have their own home page; a section belongs to one
 * (audience, Women unless asked). New and copied sections start hidden so they
 * can be filled in before they appear on the site.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>

  if (body.action === "create" || body.action === "duplicate") {
    const { sections } = await getContent(service)
    const taken = new Set<string>(sections.map((s: any) => s.key))
    const source = body.action === "duplicate" ? sections.find((s: any) => s.id === body.id) : null
    if (body.action === "duplicate" && !source) return res.status(404).json({ message: "Section not found." })
    const audience = body.audience === "men" || body.audience === "women" ? body.audience : sectionAudience(source)
    const ordered = sections
      .filter((s: any) => sectionAudience(s) === audience)
      .sort((a: any, b: any) => a.position - b.position)

    let row: Record<string, unknown>
    let afterId: string | null = null
    if (body.action === "create") {
      if (!isHomeSectionType(body.type)) {
        return res.status(400).json({ message: "Unknown section type." })
      }
      const blank = blankHomeSection(body.type)
      row = {
        key: uniqueKey(audience === "men" ? `men-${body.type}` : body.type, taken),
        audience,
        type: body.type,
        title: blank.title,
        config: normaliseHomeConfig(body.type, blank.config),
      }
      afterId = typeof body.after_id === "string" ? body.after_id : null
    } else {
      const moved = sectionAudience(source) !== audience
      row = {
        key: uniqueKey(moved ? `${audience}-${source.key.replace(/^(?:men|women)-/, "")}` : `${source.key}-copy`, taken),
        audience,
        type: source.type,
        title: source.title,
        subtitle: source.subtitle,
        eyebrow: source.eyebrow,
        cta_label: source.cta_label,
        cta_href: source.cta_href,
        config: normaliseHomeConfig(source.type, source.config),
      }
      afterId = moved ? null : source.id
    }

    const index = afterId ? ordered.findIndex((s: any) => s.id === afterId) : -1
    const insertAt = index >= 0 ? index + 1 : ordered.length
    const created = await service.createHomeSections({ ...row, position: insertAt, is_visible: false })
    const createdId = Array.isArray(created) ? created[0].id : created.id
    const order = ordered.map((s: any) => s.id)
    order.splice(insertAt, 0, createdId)
    for (const [position, id] of order.entries()) {
      await service.updateHomeSections({ id, position })
    }

    const fresh = await getContent(service)
    return res.json({ sections: fresh.sections, created_id: createdId })
  }

  const order = body.order
  if (!Array.isArray(order) || !order.length) {
    return res.status(400).json({ message: "order must be a list of ids" })
  }

  for (const [position, id] of order.entries()) {
    await service.updateHomeSections({ id, position })
  }

  const { sections } = await getContent(service)
  res.json({ sections })
}
