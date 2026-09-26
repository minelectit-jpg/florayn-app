// Admin > Privacy: the saved page plus Claude's suggested draft. The policy
// text is never logged.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SUGGESTED_PRIVACY_BODY, SUGGESTED_PRIVACY_TITLE } from "../../../modules/content/privacy-draft"
import {
  parsePrivacyPatch,
  readPrivacySettings,
} from "../../../modules/content/privacy-settings"
import { updatePrivacySettingsWorkflow } from "../../../workflows/update-privacy-settings"

export const AUTHENTICATE = true

const suggested = { title: SUGGESTED_PRIVACY_TITLE, body: SUGGESTED_PRIVACY_BODY }

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  res.json({ settings: await readPrivacySettings(req.scope), suggested })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const parsed = parsePrivacyPatch(req.body, await readPrivacySettings(req.scope))
  if (!parsed.ok) {
    return res.status(400).json({
      message: "Please check the privacy page.",
      errors: parsed.errors,
    })
  }
  const { result } = await updatePrivacySettingsWorkflow(req.scope).run({
    input: parsed.patch,
  })
  return res.json({ ...result, suggested })
}
