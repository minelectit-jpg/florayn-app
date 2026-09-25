import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { CASE_TYPES } from "../../../modules/catalog/data/case-types"

const seedGroupsBySlug = new Map(
  CASE_TYPES.map((c) => [c.slug, c.price_groups ?? null])
)

/**
 * GET /store/case-types - the six constructions, with the devices each one is
 * tooled for. price_groups falls back to the seed's per-device groups while
 * the DB column is still null (as /admin/case-types and the search index do),
 * so the header's "from" price matches what the variants are priced at.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalogModuleService: any = req.scope.resolve(CATALOG_MODULE)

  const caseTypes = await catalogModuleService.listCaseTypes(
    { is_active: true },
    { order: { sort_order: "ASC" }, relations: ["devices"] }
  )
  const enriched = caseTypes.map((c: any) => ({
    ...c,
    price_groups: c.price_groups ?? seedGroupsBySlug.get(c.slug) ?? null,
  }))

  res.json({ case_types: enriched, count: enriched.length })
}
