import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import {
  parseContactSettingsPatch,
  readContactSettings,
} from "../../../modules/content/contact-settings"
import type ContentModuleService from "../../../modules/content/service"
import { updateContactSettingsWorkflow } from "../../../workflows/update-contact-settings"

export const AUTHENTICATE = true

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const service: ContentModuleService = req.scope.resolve(CONTENT_MODULE)
  res.json({ settings: await readContactSettings(service) })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const parsed = parseContactSettingsPatch(req.body)
  if (!parsed.ok) {
    return res.status(400).json({
      message: "Please check the contact settings.",
      errors: parsed.errors,
    })
  }
  const { result } = await updateContactSettingsWorkflow(req.scope).run({
    input: parsed.patch,
  })
  return res.json(result)
}

