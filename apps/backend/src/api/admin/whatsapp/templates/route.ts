import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { storefrontUrl } from "../../../../lib/review-links"
import { loadReviewProgram } from "../../../../lib/review-program"
import { templateDefinitions } from "../../../../lib/review-whatsapp"
import { getWhatsAppSettings, graphCall } from "../../../../lib/whatsapp"

/**
 * POST /admin/whatsapp/templates - submit the review templates to Meta for
 * approval (usually minutes, at most a day). A template that already exists
 * under that name and language is left alone.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const [s, { settings: program }] = await Promise.all([getWhatsAppSettings(req.scope), loadReviewProgram(req.scope)])
  if (!s.access_token || !s.business_account_id) {
    res.status(400).json({ message: "Save the WhatsApp Business Account ID and access token first." })
    return
  }
  const waba = encodeURIComponent(s.business_account_id)
  const existing = await graphCall<any>(s, `${waba}/message_templates?fields=name,language,status&limit=200`)
  if (!existing.ok) { res.status(400).json({ message: existing.error }); return }
  const have = new Set<string>((existing.data?.data ?? []).map((t: any) => `${t.name}|${t.language}`))
  const results: { name: string; result: string }[] = []
  for (const template of templateDefinitions(program, storefrontUrl())) {
    if (have.has(`${template.name}|${template.language}`)) { results.push({ name: template.name, result: "already there" }); continue }
    const { name, language, category, components } = template
    const created = await graphCall<any>(s, `${waba}/message_templates`, { method: "POST", body: { name, language, category, components } })
    results.push({ name: template.name, result: created.ok ? `submitted (${created.data?.status ?? "PENDING"})` : `not accepted: ${created.error}` })
  }
  res.json({ results })
}
