import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import { getContent } from "../../../modules/content/config"

/** GET /admin/content - every row, hidden ones included. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const { sections, menuSections, items } = await getContent(service)
  res.json({ sections, menuSections, items })
}
