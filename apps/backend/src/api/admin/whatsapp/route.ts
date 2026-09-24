import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { opsService } from "../../../lib/order-ops"
import { storefrontUrl } from "../../../lib/review-links"
import { loadReviewProgram } from "../../../lib/review-program"
import { templatePreview } from "../../../lib/review-whatsapp"
import { getWhatsAppSettings, presentWhatsApp } from "../../../lib/whatsapp"

/**
 * GET /admin/whatsapp - the WhatsApp Business connection (token masked) and
 * the review templates it needs, as they will be submitted to Meta.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const [settings, { settings: program }] = await Promise.all([getWhatsAppSettings(req.scope), loadReviewProgram(req.scope)])
  res.json({ settings: presentWhatsApp(settings), templates: templatePreview(program, storefrontUrl()), storefront: storefrontUrl() })
}

const ID = /^\d{5,30}$/

/**
 * POST /admin/whatsapp { enabled?, phone_number_id?, business_account_id?,
 * access_token?, api_version? } - save. A blank token keeps the saved one, so
 * the owner can switch WhatsApp on or off without pasting it again.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const settings = await getWhatsAppSettings(req.scope)
  const patch: Record<string, unknown> = { id: settings.id }
  const errors: Record<string, string> = {}
  for (const key of ["phone_number_id", "business_account_id"] as const) {
    if (typeof body[key] !== "string") continue
    const value = (body[key] as string).trim()
    if (value && !ID.test(value)) errors[key] = "Paste the number exactly as WhatsApp Manager shows it (digits only)."
    else patch[key] = value || null
  }
  if (typeof body.access_token === "string" && body.access_token.trim()) {
    const token = body.access_token.trim()
    if (!/^[A-Za-z0-9_\-.|]{20,1000}$/.test(token)) errors.access_token = "That does not look like an access token."
    else patch.access_token = token
  }
  if (typeof body.api_version === "string" && body.api_version.trim()) {
    if (!/^v\d{1,3}\.\d{1,3}$/.test(body.api_version.trim())) errors.api_version = "Use a Graph API version such as v23.0."
    else patch.api_version = body.api_version.trim()
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled
  if (Object.keys(errors).length) { res.status(400).json({ message: "Check the highlighted fields.", errors }); return }
  await opsService(req.scope).updateWhatsAppSettings(patch)
  res.json({ settings: presentWhatsApp(await getWhatsAppSettings(req.scope)) })
}
