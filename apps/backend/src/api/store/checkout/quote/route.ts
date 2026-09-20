import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkoutWorkflow } from "../../../../workflows/checkout"

/** A quote only prepares delivery and discounts; it never creates a payment or order. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const { result } = await checkoutWorkflow(req.scope).run({ input: { body: req.body, complete: false } })
  return res.status(result.status).json(result.body)
}
