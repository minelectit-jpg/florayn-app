import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../modules/content"
import { reviewInput, reviewProduct } from "../lib/product-reviews"

const submitProductReview = createStep("submit-product-review", async (input: { productId: string; customerId: string; body: unknown }, { container }) => {
  if (!input.customerId) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Sign in to write a review.")
  await container.resolve(Modules.CUSTOMER).retrieveCustomer(input.customerId, { select: ["id"] })
  const { key } = await reviewProduct(container, input.productId)
  const values = reviewInput(input.body)
  const service = container.resolve(CONTENT_MODULE)
  const existing = await service.listProductReviews({ review_key: key, customer_id: input.customerId }, { take: 1, select: ["id"] })
  if (existing.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, "You have already submitted a review for this design.")
  const [, count] = await service.listAndCountProductReviews({ customer_id: input.customerId, created_at: { $gte: new Date(Date.now() - 86400000) } }, { take: 1, select: ["id"] })
  if (count >= 10) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Please try again tomorrow.")
  const review = await service.createProductReviews({ ...values, review_key: key, product_id: input.productId, customer_id: input.customerId, status: "pending", reply: "" })
  return new StepResponse({ id: review.id, status: "pending" }, review.id)
}, async (id, { container }) => { if (id) await container.resolve(CONTENT_MODULE).deleteProductReviews(id) })

const moderateProductReview = createStep("moderate-product-review", async (input: { id: string; status: unknown; reply: unknown }, { container }) => {
  if (!["pending", "approved", "rejected"].includes(String(input.status)) || typeof input.reply !== "string" || input.reply.length > 2000) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a review status and keep the reply within 2,000 characters.")
  const service = container.resolve(CONTENT_MODULE)
  const before = await service.retrieveProductReview(input.id)
  const review = await service.updateProductReviews({ id: before.id, status: input.status as "pending" | "approved" | "rejected", reply: input.reply.trim() })
  return new StepResponse({ id: review.id }, { id: before.id, status: before.status, reply: before.reply })
}, async (before, { container }) => { if (before) await container.resolve(CONTENT_MODULE).updateProductReviews(before) })

export const submitProductReviewWorkflow = createWorkflow("submit-product-review", (input: { productId: string; customerId: string; body: unknown }) => new WorkflowResponse(submitProductReview(input)))
export const moderateProductReviewWorkflow = createWorkflow("moderate-product-review", (input: { id: string; status: unknown; reply: unknown }) => new WorkflowResponse(moderateProductReview(input)))
