import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import {
  parseCheckoutSettingsPatch,
  readCheckoutSettings,
} from "../../../modules/content/checkout-settings"
import type ContentModuleService from "../../../modules/content/service"
import { updateCheckoutSettingsWorkflow } from "../../../workflows/update-checkout-settings"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: ContentModuleService = req.scope.resolve(CONTENT_MODULE)
  res.json({ settings: await readCheckoutSettings(service) })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = parseCheckoutSettingsPatch(req.body)
  if (!parsed.ok) {
    return res.status(400).json({
      message: "Please check the checkout settings.",
      errors: parsed.errors,
    })
  }
  const { result } = await updateCheckoutSettingsWorkflow(req.scope).run({
    input: parsed.patch,
  })
  return res.json(result)
}
