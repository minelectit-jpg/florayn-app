import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { publicReviews } from "../../../lib/product-reviews"
import { loadReviewProgram } from "../../../lib/review-program"
import { issueReviewReward, rewardFor } from "../../../lib/review-rewards"
import { submitProductReviewWorkflow } from "../../../workflows/product-reviews"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number(req.query.offset ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || typeof req.query.product_id !== "string") { res.status(400).json({ message: "Choose a product and a valid review page." }); return }
  res.json(await publicReviews(req.scope, req.query.product_id, offset))
}

/**
 * POST /store/product-reviews - a signed-in customer's review, or one sent
 * through a review request link ({ token }). A published review gets its
 * discount code straight away (shown in the thank-you and mailed); a held one
 * says what it will earn once published.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (typeof body.product_id !== "string") { res.status(400).json({ message: "Choose a product." }); return }
  const { result } = await submitProductReviewWorkflow(req.scope).run({
    input: { productId: body.product_id, customerId: req.auth_context?.actor_id ?? null, token: body.token, body },
  })
  if (result.status === "approved") {
    const reward = await issueReviewReward(req.scope, result.id)
    res.status(201).json({ ...result, reward })
    return
  }
  const { settings } = await loadReviewProgram(req.scope)
  const images = Array.isArray(body.images) ? body.images : []
  const expected = rewardFor({ rating: Number(body.rating), images, status: "approved" }, settings)
  res.status(201).json({ ...result, reward: null, pending_reward_pct: "pct" in expected ? expected.pct : null })
}
