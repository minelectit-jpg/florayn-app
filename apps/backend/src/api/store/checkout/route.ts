import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { countCheckoutHeader, decodeTrackingHeader } from "../../../lib/tracking/checkout-context"
import { checkoutWithTrackingWorkflow } from "../../../workflows/checkout"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  // A signed-in shopper carries a customer auth context; link their order to
  // the account. Guests have none and check out exactly as before.
  const auth = (req as unknown as { auth_context?: { actor_type?: string; actor_id?: string } }).auth_context
  const customerId =
    auth?.actor_type === "customer" && typeof auth.actor_id === "string" && auth.actor_id
      ? auth.actor_id
      : undefined
  // Ad tracking context from the storefront's signed headers (TRACKING.md
  // 4.4, 6.5). It never fails or delays the order: a bad header only means
  // this order is placed without tracking, and the counters are not awaited.
  const tracking = decodeTrackingHeader(req.headers)
  countCheckoutHeader(req.scope, { ...tracking, rejected: false })
  const { result } = await checkoutWithTrackingWorkflow(req.scope).run({
    input: { body: req.body, complete: true, customerId, tracking: tracking.ctx },
  })
  // A rejected header counts only once an order was placed: the header name is
  // public, so a bare POST must not raise the checkout_without_tracking alert.
  // A real secret mismatch also shows there as orders without a context.
  if (tracking.rejected && result.status === 200 && result.body?.order?.id) countCheckoutHeader(req.scope, tracking)
  return res.status(result.status).json(result.body)
}
