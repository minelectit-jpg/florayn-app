import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { BUNDLE_BADGE_KEY, readBundleBadge, validateBundleBadge } from "../lib/bundle-badge"
const prepareBundleBadge = createStep("prepare-bundle-badge", async (input: { text: unknown }, { container }) => {
  let text
  try { text = validateBundleBadge(input.text) }
  catch (error: any) { throw new MedusaError(MedusaError.Types.INVALID_DATA, error.message) }
  const { store } = await readBundleBadge(container)
  if (!store) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Create a store first.")
  return new StepResponse({ selector: { id: store.id }, update: { metadata: { ...store.metadata, [BUNDLE_BADGE_KEY]: text } } })
})
export const saveBundleBadgeWorkflow = createWorkflow("save-bundle-badge", (input: { text: unknown }) => {
  const result = updateStoresWorkflow.runAsStep({ input: prepareBundleBadge(input) })
  return new WorkflowResponse(result)
})
