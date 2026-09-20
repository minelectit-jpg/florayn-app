import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkoutWorkflow } from "../../../workflows/checkout"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const { result } = await checkoutWorkflow(req.scope).run({ input: { body: req.body, complete: true } })
  return res.status(result.status).json(result.body)
}
