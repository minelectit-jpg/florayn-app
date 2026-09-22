import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { moderateProductReviewWorkflow } from "../../../../../workflows/product-reviews"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { result } = await moderateProductReviewWorkflow(req.scope).run({ input: { id: req.params.id, status: body.status, reply: body.reply } })
  res.json(result)
}

