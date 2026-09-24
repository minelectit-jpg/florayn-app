import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../../../modules/content"
import { bdMobile, localMobile, realEmail } from "../../../lib/contact"
import { storefrontUrl } from "../../../lib/review-links"
import { loadReviewProgram } from "../../../lib/review-program"
import { manualRewardText } from "../../../lib/review-whatsapp"
import { waMeLink } from "../../../lib/whatsapp"

/**
 * GET /admin/review-rewards - the last 50 codes issued for reviews. A code
 * that has not reached its reviewer yet (phone-only, WhatsApp not connected)
 * carries a wa.me link that opens their chat with the code typed in.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const content: any = req.scope.resolve(CONTENT_MODULE)
  const { settings } = await loadReviewProgram(req.scope)
  const reviews = await content.listProductReviews({ coupon_code: { $ne: null } }, { take: 50, order: { reward_issued_at: "DESC" } })
  const productIds = [...new Set<string>(reviews.map((r: any) => r.product_id))]
  const products = productIds.length ? await req.scope.resolve(Modules.PRODUCT).listProducts({ id: productIds }, { select: ["id", "title", "metadata"], take: productIds.length }) : []
  const title = new Map<string, string>(products.map((p: any) => [p.id, (p.metadata?.design_name as string) || p.title]))
  res.json({
    rewards: reviews.map((r: any) => {
      const phone = bdMobile(r.phone)
      const delivered = Boolean(r.reward_mailed_at)
      return {
        id: r.id, author: r.author, email: realEmail(r.email), phone: localMobile(r.phone),
        product: title.get(r.product_id) ?? r.product_id,
        code: r.coupon_code, pct: r.reward_pct, photos: Array.isArray(r.images) ? r.images.length : 0,
        issued_at: r.reward_issued_at, mailed: delivered, channel: r.reward_channel ?? null, note: r.reward_note ?? null,
        whatsapp_url: phone ? waMeLink(phone, manualRewardText(settings, {
          author: r.author, code: r.coupon_code, pct: r.reward_pct ?? 0, issuedAt: new Date(r.reward_issued_at),
        }, storefrontUrl())) : null,
      }
    }),
  })
}

/**
 * POST /admin/review-rewards { action: "mark_sent", id } - the admin sent a
 * code on WhatsApp by hand, so it no longer shows as waiting.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.action !== "mark_sent" || typeof body.id !== "string" || !/^review_[A-Za-z0-9]+$/.test(body.id)) {
    res.status(400).json({ message: "Choose a code." })
    return
  }
  const content: any = req.scope.resolve(CONTENT_MODULE)
  const review = await content.retrieveProductReview(body.id).catch(() => null)
  if (!review?.coupon_code) { res.status(404).json({ message: "That review has no code." }); return }
  await content.updateProductReviews({ id: review.id, reward_mailed_at: new Date(), reward_channel: "whatsapp by hand", reward_note: null })
  res.json({ ok: true })
}
