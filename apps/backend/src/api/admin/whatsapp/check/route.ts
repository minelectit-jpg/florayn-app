import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { loadReviewProgram } from "../../../../lib/review-program"
import { getWhatsAppSettings, graphCall } from "../../../../lib/whatsapp"

/**
 * POST /admin/whatsapp/check - ask Meta whether the saved connection works:
 * the sending number (name, quality) and the review templates' approval.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const [s, { settings: program }] = await Promise.all([getWhatsAppSettings(req.scope), loadReviewProgram(req.scope)])
  if (!s.access_token || !s.phone_number_id) {
    res.status(400).json({ message: "Save the Phone number ID and access token first." })
    return
  }
  const phone = await graphCall<any>(s, `${encodeURIComponent(s.phone_number_id)}?fields=display_phone_number,verified_name,quality_rating,name_status`)
  const names = [program.whatsapp.request_template, program.whatsapp.reward_template]
  let templates: { name: string; status: string; language: string; category: string; rejected_reason?: string }[] = []
  let templatesError: string | null = null
  if (s.business_account_id) {
    const list = await graphCall<any>(s, `${encodeURIComponent(s.business_account_id)}/message_templates?fields=name,status,language,category,rejected_reason&limit=200`)
    if (list.ok) templates = (list.data?.data ?? []).filter((t: any) => names.includes(t.name))
    else templatesError = list.error
  } else {
    templatesError = "Save the WhatsApp Business Account ID to see the templates."
  }
  res.json({
    phone: phone.ok ? {
      number: phone.data.display_phone_number ?? null,
      name: phone.data.verified_name ?? null,
      quality: phone.data.quality_rating ?? null,
      name_status: phone.data.name_status ?? null,
    } : null,
    phone_error: phone.ok ? null : phone.error,
    templates: names.map((name) => {
      const found = templates.filter((t) => t.name === name)
      const match = found.find((t) => t.language === program.whatsapp.language) ?? found[0]
      return { name, status: match?.status ?? "MISSING", language: match?.language ?? program.whatsapp.language, category: match?.category ?? null, rejected_reason: match?.rejected_reason ?? null }
    }),
    templates_error: templatesError,
  })
}
