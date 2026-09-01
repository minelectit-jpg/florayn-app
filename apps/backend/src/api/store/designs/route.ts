import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /store/designs - the artwork library, independent of which case types
 * each design happens to be published in.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalogModuleService: any = req.scope.resolve(CATALOG_MODULE)

  const limit = Number(req.query.limit ?? 100)
  const offset = Number(req.query.offset ?? 0)

  const [designs, count] = await catalogModuleService.listAndCountDesigns(
    { is_active: true },
    { take: limit, skip: offset, order: { sort_order: "ASC" } }
  )

  res.json({ designs, count, limit, offset })
}
