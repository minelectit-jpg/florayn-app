import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderSummaryWorkflow } from "../../../../workflows/order-summary"

/** Guest confirmation addressed by the opaque order ID; phone stays masked. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const { result: order } = await orderSummaryWorkflow(req.scope).run({ input: { id: req.params.id } })
  if (!order) return res.status(404).json({ message: "Order not found" })
  return res.json({ order })
}
