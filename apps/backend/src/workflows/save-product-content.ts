import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { productContent, PRODUCT_CONTENT_KEY } from "../lib/product-content"

const prepareProductPageContent = createStep("prepare-product-page-content", async (input: { productId: string; settings: unknown }, { container }) => {
  const settings = productContent(input.settings)
  const product = await container.resolve(Modules.PRODUCT).retrieveProduct(input.productId, { select: ["id", "metadata"] })
  return new StepResponse({ selector: { id: product.id }, update: { metadata: { ...product.metadata, [PRODUCT_CONTENT_KEY]: settings } } })
})
export const saveProductContentWorkflow = createWorkflow("save-product-content", (input: { productId: string; settings: unknown }) => {
  const result = updateProductsWorkflow.runAsStep({ input: prepareProductPageContent(input) })
  return new WorkflowResponse(result)
})
