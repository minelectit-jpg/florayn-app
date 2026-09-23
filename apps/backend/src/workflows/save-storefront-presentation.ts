import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { readStorefrontPresentation } from "../lib/read-storefront-presentation"
import { PRESENTATION_KEY, validateDeliveryPresentation, validateFooterPresentation } from "../lib/storefront-presentation"

type Input = { section: "footer" | "delivery"; settings: unknown }
const prepareStorefrontPresentation = createStep("prepare-storefront-presentation", async (input: Input, { container }) => {
  if (!["footer", "delivery"].includes(input.section)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unknown presentation section.")
  const settings = input.section === "footer" ? validateFooterPresentation(input.settings) : validateDeliveryPresentation(input.settings)
  const { store, settings: current } = await readStorefrontPresentation(container)
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Create the store before saving its content.")
  return new StepResponse({ selector: { id: store.id }, update: { metadata: { ...store.metadata, [PRESENTATION_KEY]: { ...current, [input.section]: settings } } } })
})
export const saveStorefrontPresentationWorkflow = createWorkflow("save-storefront-presentation", (input: Input) => {
  const result = updateStoresWorkflow.runAsStep({ input: prepareStorefrontPresentation(input) })
  return new WorkflowResponse(result)
})
