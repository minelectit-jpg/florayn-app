import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { issueReviewReward } from "../../../../../lib/review-rewards"
import { moderateProductReviewWorkflow } from "../../../../../workflows/product-reviews"

/** POST /admin/content/product-reviews/:id - publish, hide or reply. Publishing issues the review's code. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { result } = await moderateProductReviewWorkflow(req.scope).run({ input: { id: req.params.id, status: body.status, reply: body.reply } })
  const reward = result.status === "approved" ? await issueReviewReward(req.scope, result.id) : null
  res.json({ ...result, reward })
}
