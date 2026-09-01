import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /store/case-types - the six constructions, with the devices each one is
 * tooled for.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalogModuleService: any = req.scope.resolve(CATALOG_MODULE)

  const caseTypes = await catalogModuleService.listCaseTypes(
    { is_active: true },
    { order: { sort_order: "ASC" }, relations: ["devices"] }
  )

  res.json({ case_types: caseTypes, count: caseTypes.length })
}
