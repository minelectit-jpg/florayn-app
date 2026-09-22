import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { publicReviews } from "../../../lib/product-reviews"
import { submitProductReviewWorkflow } from "../../../workflows/product-reviews"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number(req.query.offset ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || typeof req.query.product_id !== "string") { res.status(400).json({ message: "Choose a product and a valid review page." }); return }
  res.json(await publicReviews(req.scope, req.query.product_id, offset))
}
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (typeof body.product_id !== "string") { res.status(400).json({ message: "Choose a product." }); return }
  const { result } = await submitProductReviewWorkflow(req.scope).run({ input: { productId: body.product_id, customerId: req.auth_context.actor_id, body } })
  res.status(201).json(result)
}

