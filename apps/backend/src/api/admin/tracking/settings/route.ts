import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { emailConfigured } from "../../../../lib/send-email"
import { kickStaleJobs } from "../../../../lib/tracking/jobs"
import {
  invalidateTrackingSettings,
  isPrivacyPublished,
  parseTrackingConfig,
  parseTrackingPatch,
  present,
  readTrackingSettingsRow,
  saveTrackingTokens,
  SUGGESTED_CONSENT_TEXT,
} from "../../../../lib/tracking/settings"
import { updateTrackingSettingsWorkflow } from "../../../../workflows/update-tracking-settings"

/**
 * GET/POST /admin/tracking/settings - Admin > Tracking (TRACKING.md 3.5, 4.6).
 * Tokens are write-only: the GET returns them masked, a blank POST keeps them
 * and "__remove__" clears them. Non-secret config goes through the workflow;
 * tokens are written straight through the module service (3.3). Request
 * bodies are never logged.
 */
async function view(req: MedusaRequest) {
  const [row, privacyPublished] = await Promise.all([
    readTrackingSettingsRow(req.scope),
    isPrivacyPublished(req.scope),
  ])
  return {
    settings: present(row ?? {}),
    email_configured: emailConfigured(),
    privacy_published: privacyPublished,
    suggested_consent_text: SUGGESTED_CONSENT_TEXT,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const body = await view(req)
  kickStaleJobs(req.scope)
  return res.json(body)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const [row, privacyPublished] = await Promise.all([
    readTrackingSettingsRow(req.scope),
    isPrivacyPublished(req.scope),
  ])
  const current = parseTrackingConfig(row?.config)
  const parsed = parseTrackingPatch(req.body, { current, privacyPublished })
  if (!parsed.ok) {
    return res.status(400).json({ message: "Please check the tracking settings.", errors: parsed.errors })
  }
  // An unchanged config (a token-only save) skips the storefront refresh.
  if (JSON.stringify(parsed.config) !== JSON.stringify(current)) {
    await updateTrackingSettingsWorkflow(req.scope).run({ input: { config: parsed.config } })
  }
  await saveTrackingTokens(req.scope, parsed.tokens)
  invalidateTrackingSettings()
  return res.json(await view(req))
}
