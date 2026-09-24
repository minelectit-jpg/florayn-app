import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTENT_MODULE } from "../../../../modules/content"
import { reviewProduct, publicReview } from "../../../../lib/product-reviews"

/**
 * GET /admin/content/product-reviews - reviews for moderation, newest first,
 * with what the admin needs beyond the public view: the reviewer's email and
 * order, and the discount code the review earned (or why it did not).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number(req.query.offset ?? 0)
  const status = req.query.status
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || (status && !["pending", "approved", "rejected"].includes(String(status)))) { res.status(400).json({ message: "Invalid review filter." }); return }
  const key = typeof req.query.product_id === "string" ? (await reviewProduct(req.scope, req.query.product_id, false)).key : undefined
  const [reviews, count] = await req.scope.resolve(CONTENT_MODULE).listAndCountProductReviews({ ...(key ? { review_key: key } : {}), ...(status ? { status } : {}) }, { take: 20, skip: offset, order: { created_at: "DESC", id: "DESC" } })
  res.json({
    reviews: reviews.map((r: any) => ({
      ...publicReview(r),
      status: r.status, product_id: r.product_id, review_key: r.review_key,
      email: r.email ?? null, order_id: r.order_id ?? null,
      coupon_code: r.coupon_code ?? null, reward_pct: r.reward_pct ?? null,
      reward_mailed: Boolean(r.reward_mailed_at), reward_note: r.reward_note ?? null,
    })),
    count, offset, limit: 20,
  })
}
