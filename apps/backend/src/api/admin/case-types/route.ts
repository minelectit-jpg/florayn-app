import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { CASE_TYPES } from "../../../modules/catalog/data/case-types"

const seedGroupsBySlug = new Map(
  CASE_TYPES.map((c) => [c.slug, c.price_groups ?? null])
)

/**
 * GET /admin/case-types - the case constructions, for the admin screen where an
 * admin edits their names and prices. price_groups falls back to the seed's
 * per-device groups when the DB column is still null, so the screen always shows
 * the current per-device prices (Alcantara) even before the first edit.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const caseTypes = await catalog.listCaseTypes({}, { order: { sort_order: "ASC" } })
  const enriched = caseTypes.map((c: any) => ({
    ...c,
    price_groups: c.price_groups ?? seedGroupsBySlug.get(c.slug) ?? null,
  }))
  res.json({ case_types: enriched, count: enriched.length })
}
