import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { readStorefrontPresentation } from "../lib/read-storefront-presentation"
import { PRESENTATION_KEY, validateBuyBoxPresentation, validateDeliveryPresentation, validateFooterPresentation, validateNavigationPresentation, validateSearchPresentation } from "../lib/storefront-presentation"

/** Each editable section and its validator. */
export const PRESENTATION_VALIDATORS = {
  footer: validateFooterPresentation,
  delivery: validateDeliveryPresentation,
  buy_box: validateBuyBoxPresentation,
  navigation: validateNavigationPresentation,
  search: validateSearchPresentation,
} as const
export type PresentationSection = keyof typeof PRESENTATION_VALIDATORS
export const isPresentationSection = (value: unknown): value is PresentationSection =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESENTATION_VALIDATORS, value)

type Input = { section: PresentationSection; settings: unknown }
const prepareStorefrontPresentation = createStep("prepare-storefront-presentation", async (input: Input, { container }) => {
  if (!isPresentationSection(input.section)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unknown presentation section.")
  const settings = PRESENTATION_VALIDATORS[input.section](input.settings)
  const { store, settings: current } = await readStorefrontPresentation(container)
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Create the store before saving its content.")
  return new StepResponse({ selector: { id: store.id }, update: { metadata: { ...store.metadata, [PRESENTATION_KEY]: { ...current, [input.section]: settings } } } })
})
export const saveStorefrontPresentationWorkflow = createWorkflow("save-storefront-presentation", (input: Input) => {
  const result = updateStoresWorkflow.runAsStep({ input: prepareStorefrontPresentation(input) })
  return new WorkflowResponse(result)
})
