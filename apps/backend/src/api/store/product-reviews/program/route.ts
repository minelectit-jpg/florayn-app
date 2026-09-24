import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { inviteFromToken } from "../../../../lib/review-invites"
import { loadReviewProgram } from "../../../../lib/review-program"

/**
 * GET /store/product-reviews/program[?token=] - what the review form needs:
 * how many photos, what a review earns, and, for a review request link, who is
 * reviewing (their name pre-fills the form) and which products the link covers
 * (the /review/<token> page a WhatsApp request opens lists them). Only the
 * holder of the signed link sees these; no email or phone is returned.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { settings } = await loadReviewProgram(req.scope)
  const invite = req.query.token ? await inviteFromToken(req.scope, req.query.token) : null
  res.json({
    max_photos: settings.rewards.max_photos,
    rewards: settings.rewards.enabled ? { photo_pct: settings.rewards.photo_pct, text_pct: settings.rewards.text_pct } : null,
    auto_approve: settings.auto_approve,
    invite: invite ? {
      name: invite.fullName ?? invite.firstName,
      product_ids: invite.products.map((p) => p.id),
      designs: invite.products.map((p) => p.design).filter(Boolean),
      products: invite.products.map((p) => ({ id: p.id, handle: p.handle, title: p.title, thumbnail: p.thumbnail })),
    } : null,
    invite_invalid: Boolean(req.query.token) && !invite,
  })
}
