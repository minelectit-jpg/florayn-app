import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import { readContactSettings } from "../../../modules/content/contact-settings"
import type ContentModuleService from "../../../modules/content/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: ContentModuleService = req.scope.resolve(CONTENT_MODULE)
  res.json({ settings: await readContactSettings(service) })
}

