import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCheckout } from "./checkout-service"
import type { CheckoutResult } from "./checkout-service"
import type { CheckoutTrackingContext } from "../lib/tracking/contract"
import { recordCheckoutTracking, stashCheckoutTracking } from "../lib/tracking/purchase"

type Input = { body: unknown; complete: boolean; customerId?: string }

const prepareCheckoutStep = createStep("prepare-checkout", async (input: Input, { container }) => {
  return new StepResponse(await runCheckout(container, input.body, input.complete, input.customerId))
})

export const checkoutWorkflow = createWorkflow("checkout", (input: Input) => {
  return new WorkflowResponse(prepareCheckoutStep(input))
})

/**
 * Checkout with ad tracking (TRACKING.md 6.5, B1, B2). Only /store/checkout
 * runs this; the quote route and the isolated CI script keep using
 * checkoutWorkflow above, unchanged. The same prepare-checkout step places
 * the order; around it, one step stashes the shopper's tracking context by
 * cart and one records the Purchase once an order exists. Both tracking
 * steps swallow every error and wait only a short budget, so tracking can
 * never fail or hold up an order. The response gains `tracking` (the
 * browser's Purchase block) only when one was recorded.
 */
type TrackedInput = Input & { tracking?: CheckoutTrackingContext | null }

const stashCheckoutTrackingStep = createStep("stash-checkout-tracking", async (input: TrackedInput, { container }) => {
  try {
    await stashCheckoutTracking(container, input)
  } catch {
    // stashCheckoutTracking never throws; this is only the last guard around the order.
  }
  return new StepResponse(null)
})

const recordPurchaseTrackingStep = createStep(
  "record-purchase-tracking",
  async ({ input, result }: { input: TrackedInput; result: CheckoutResult }, { container }) => {
    let block: Awaited<ReturnType<typeof recordCheckoutTracking>> = null
    try {
      // Only for a placed order (status 200 with an order id, which covers the
      // recovery paths in runCheckout too) that came with a context.
      block = await recordCheckoutTracking(container, input, result)
    } catch {
      block = null
    }
    return new StepResponse(block)
  }
)

export const checkoutWithTrackingWorkflow = createWorkflow("checkout-with-tracking", (input: TrackedInput) => {
  stashCheckoutTrackingStep(input)
  const result = prepareCheckoutStep(input)
  const tracking = recordPurchaseTrackingStep({ input, result })
  return new WorkflowResponse(transform({ result, tracking }, ({ result, tracking }) =>
    tracking ? { ...result, body: { ...result.body, tracking } } : result))
})
