import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /admin/case-types - the case constructions, for the admin screen where an
 * admin edits their names and prices.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const caseTypes = await catalog.listCaseTypes({}, { order: { sort_order: "ASC" } })
  res.json({ case_types: caseTypes, count: caseTypes.length })
}
