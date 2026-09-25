import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { CASE_TYPES } from "../../../modules/catalog/data/case-types"
import { skuCodeFromSlug, slugify } from "../../../lib/create-uploaded-design"

const seedGroupsBySlug = new Map(
  CASE_TYPES.map((c) => [c.slug, c.price_groups ?? null])
)

/**
 * GET /admin/case-types - the case constructions, for the admin screen where an
 * admin edits their names and prices. price_groups falls back to the seed's
 * per-device groups when the DB column is still null, so the screen always shows
 * the current per-device prices (Alcantara) even before the first edit. Each
 * case type carries its devices, so Admin > Navigation offers only the case
 * types that fit a section's brands.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const caseTypes = await catalog.listCaseTypes({}, { order: { sort_order: "ASC" }, relations: ["devices"] })
  const enriched = caseTypes.map((c: any) => ({
    ...c,
    price_groups: c.price_groups ?? seedGroupsBySlug.get(c.slug) ?? null,
  }))
  res.json({ case_types: enriched, count: enriched.length })
}

/**
 * POST /admin/case-types - create a new case construction. Price is set here
 * (the one place case-type prices live); it applies to every variant that later
 * uses this case type. Nothing is priced per-design.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { name?: unknown; price?: unknown; sku_code?: unknown; image_url?: unknown }
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const price = Number(body.price)
  if (!name) return res.status(400).json({ message: "A case type name is required." })
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "A valid price is required." })

  const slug = slugify(name)
  if (!slug) return res.status(400).json({ message: "Could not derive a slug from the name." })
  const sku_code = ((typeof body.sku_code === "string" && body.sku_code.trim()) || skuCodeFromSlug(slug)).toUpperCase()

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const existing = await catalog.listCaseTypes({ slug })
  if (existing.length) return res.status(400).json({ message: `A case type "${slug}" already exists.` })
  const all = await catalog.listCaseTypes({})
  try {
    const [created] = await catalog.createCaseTypes([
      {
        slug,
        name,
        description: null,
        image_url: typeof body.image_url === "string" && body.image_url.trim() ? body.image_url.trim() : null,
        sku_code,
        price: Math.round(price),
        price_groups: null,
        sort_order: all.length,
      },
    ])
    res.json({ ok: true, case_type: created })
  } catch (error: any) {
    req.scope.resolve("logger").error(`[create-case-type] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
