import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { createDesignProducts } from "../../../lib/create-design-products"
import { DESIGNS } from "../../../modules/catalog/data/designs"

/**
 * GET /admin/designs - every design in the catalogue data, with whether it is
 * already live in the store, for the "New Design" screen (add the ones that are
 * not live yet). POST creates one design's product(s) with shared blank stock
 * and wires its images.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule = req.scope.resolve(Modules.PRODUCT)
  const products = await productModule.listProducts(
    {},
    { select: ["metadata"], take: 10000 }
  )
  const live = new Set<string>()
  for (const p of products) {
    const slug = (p.metadata as any)?.design_slug
    if (slug) live.add(slug)
  }

  const designs = DESIGNS.map((d) => ({
    slug: d.slug,
    name: d.name,
    theme: d.theme ?? null,
    caseTypes: d.case_types,
    live: live.has(d.slug),
  }))

  res.json({
    designs,
    count: designs.length,
    liveCount: designs.filter((d) => d.live).length,
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { slug?: string; blankStock?: number }
  if (!body.slug) {
    res.status(400).json({ message: "slug is required" })
    return
  }
  const logger = req.scope.resolve("logger")
  try {
    const result = await createDesignProducts({
      container: req.scope,
      designSlug: body.slug,
      blankStock: Number.isFinite(body.blankStock) ? body.blankStock : 10,
    })
    res.json({ ok: true, result })
  } catch (error: any) {
    logger.error(`[create-design] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
