import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCheckout } from "./checkout-service"

type Input = { body: unknown; complete: boolean }

const prepareCheckoutStep = createStep("prepare-checkout", async (input: Input, { container }) => {
  return new StepResponse(await runCheckout(container, input.body, input.complete))
})

export const checkoutWorkflow = createWorkflow("checkout", (input: Input) => {
  return new WorkflowResponse(prepareCheckoutStep(input))
})
