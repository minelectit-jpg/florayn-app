import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkoutWorkflow } from "../../../workflows/checkout"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  // A signed-in shopper carries a customer auth context; link their order to
  // the account. Guests have none and check out exactly as before.
  const auth = (req as unknown as { auth_context?: { actor_type?: string; actor_id?: string } }).auth_context
  const customerId =
    auth?.actor_type === "customer" && typeof auth.actor_id === "string" && auth.actor_id
      ? auth.actor_id
      : undefined
  const { result } = await checkoutWorkflow(req.scope).run({
    input: { body: req.body, complete: true, customerId },
  })
  return res.status(result.status).json(result.body)
}
