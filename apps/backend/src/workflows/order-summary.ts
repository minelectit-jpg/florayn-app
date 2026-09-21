import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ORDER_SUMMARY_FIELDS, projectOrderSummary, savedOrderImage } from "../lib/order-summary"

const readOrderSummaryStep = createStep("read-order-summary", async ({ id }: { id: string }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({ entity: "order", fields: ORDER_SUMMARY_FIELDS, filters: { id } })
  const order = orders?.[0]
  if (!order) return new StepResponse(null)
  // Older orders did not save selected-device images. Fetch only the selected
  // variants that need a fallback; titles, prices and quantities remain stored.
  const variantIds = [...new Set((order.items ?? []).filter((item: any) =>
    item.variant_id && savedOrderImage(order, item) === undefined).map((item: any) => item.variant_id))]
  const images = new Map<string, string | null>()
  if (variantIds.length) {
    const { data: variants } = await query.graph({ entity: "product_variant", fields: ["id", "metadata"],
      filters: { id: variantIds } })
    for (const variant of variants ?? []) {
      const first = (variant.metadata as any)?.images?.[0]
      if (typeof first === "string" && first.trim()) images.set(variant.id, first)
    }
  }
  return new StepResponse(projectOrderSummary(order, images))
})

export const orderSummaryWorkflow = createWorkflow("order-summary", (input: { id: string }) => {
  return new WorkflowResponse(readOrderSummaryStep(input))
})
