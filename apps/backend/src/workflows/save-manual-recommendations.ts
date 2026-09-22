import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { manualRecommendations, manualRecommendationRows, MANUAL_RECOMMENDATIONS_KEY } from "../lib/manual-recommendations"

const prepareManualRecommendations = createStep("prepare-manual-recommendations", async (input: { productId: string; settings: unknown }, { container }) => {
  let settings
  try { settings = manualRecommendations(input.settings) }
  catch (error: any) { throw new MedusaError(MedusaError.Types.INVALID_DATA, error.message) }
  const source = await container.resolve(Modules.PRODUCT).retrieveProduct(input.productId, { select: ["id", "metadata"] })
  const ids = [...new Set([...settings.recommended, ...settings.featured])]
  const rows = await manualRecommendationRows(container, ids)
  if (rows.length !== ids.length || rows.some((v: any) => v.product_id === source.id || v.status !== "published")) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose published products other than the product you are editing. Remove any deleted or draft selections.")
  }
  return new StepResponse({ selector: { id: source.id }, update: { metadata: { ...source.metadata, [MANUAL_RECOMMENDATIONS_KEY]: settings } } })
})
export const saveManualRecommendationsWorkflow = createWorkflow("save-manual-recommendations", (input: { productId: string; settings: unknown }) => {
  const patch = prepareManualRecommendations(input)
  const result = updateProductsWorkflow.runAsStep({ input: patch })
  return new WorkflowResponse(result)
})
