import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { bdMobile } from "../../../../lib/contact"
import { loadReviewProgram } from "../../../../lib/review-program"
import { requestTemplateMessage } from "../../../../lib/review-whatsapp"
import { getWhatsAppSettings, sendTemplate, whatsappReady } from "../../../../lib/whatsapp"

/**
 * POST /admin/whatsapp/test { to } - send the review request template, with
 * sample values, to the owner's own number: proves the connection, the
 * approved template and the button end to end.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const to = bdMobile((req.body as any)?.to)
  if (!to) { res.status(400).json({ message: "Enter a Bangladeshi mobile number, e.g. 01712345678." }); return }
  const [s, { settings: program }] = await Promise.all([getWhatsAppSettings(req.scope), loadReviewProgram(req.scope)])
  if (!whatsappReady(s)) { res.status(400).json({ message: "Switch WhatsApp on and save the Phone number ID and access token first." }); return }
  const sample = { orderId: "order_test", displayId: 0, email: null, phone: to, customerId: null, firstName: "Florayn", fullName: "Florayn", products: [{ id: "prod_test", handle: "test", title: "Moon Drift", thumbnail: null, design: null }] }
  const sent = await sendTemplate(s, requestTemplateMessage(program, sample, to, "test"))
  if (!sent.ok) { res.status(400).json({ message: sent.error }); return }
  res.json({ ok: true, id: sent.id })
}
