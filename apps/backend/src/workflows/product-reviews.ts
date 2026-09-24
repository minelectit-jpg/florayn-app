import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../modules/content"
import { reviewInput, reviewProduct } from "../lib/product-reviews"
import { designKey, inviteFromToken } from "../lib/review-invites"
import { loadReviewProgram } from "../lib/review-program"

type SubmitInput = { productId: string; customerId?: string | null; token?: unknown; body: unknown }

/**
 * A review comes from a signed-in customer, or from the link in a review
 * request email (no sign-in: the signed link names the order, so the review is
 * a verified purchase of a product in it). One review per design per customer
 * (or per order, for link reviews). Published at once or held for approval,
 * as the review programme says.
 */
const submitProductReview = createStep("submit-product-review", async (input: SubmitInput, { container }) => {
  const { key } = await reviewProduct(container, input.productId)
  const { settings } = await loadReviewProgram(container)
  const values = reviewInput(input.body, settings.rewards.max_photos)
  let reviewer: { customer_id: string; email: string | null; order_id: string | null; verified: boolean }

  if (input.token !== undefined && input.token !== null && input.token !== "") {
    const invite = await inviteFromToken(container, input.token)
    if (!invite) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This review link is not valid any more. Sign in to write a review.")
    if (!invite.products.some((p) => designKey(p) === key)) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This link is for the products in your order.")
    reviewer = { customer_id: invite.customerId ?? `order:${invite.orderId}`, email: invite.email, order_id: invite.orderId, verified: true }
  } else {
    if (!input.customerId) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Sign in to write a review.")
    const customer = await container.resolve(Modules.CUSTOMER).retrieveCustomer(input.customerId, { select: ["id", "email"] })
    reviewer = { customer_id: customer.id, email: customer.email ?? null, order_id: null, verified: false }
  }

  const service = container.resolve(CONTENT_MODULE)
  const existing = await service.listProductReviews({ review_key: key, customer_id: reviewer.customer_id }, { take: 1, select: ["id"] })
  if (existing.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, "You have already submitted a review for this design.")
  const [, count] = await service.listAndCountProductReviews({ customer_id: reviewer.customer_id, created_at: { $gte: new Date(Date.now() - 86400000) } }, { take: 1, select: ["id"] })
  if (count >= 10) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Please try again tomorrow.")
  const status = settings.auto_approve ? "approved" : "pending"
  const review = await service.createProductReviews({
    ...values, review_key: key, product_id: input.productId, ...reviewer, status, reply: "",
  })
  return new StepResponse({ id: review.id, status }, review.id)
}, async (id, { container }) => { if (id) await container.resolve(CONTENT_MODULE).deleteProductReviews(id) })

const moderateProductReview = createStep("moderate-product-review", async (input: { id: string; status: unknown; reply: unknown }, { container }) => {
  if (!["pending", "approved", "rejected"].includes(String(input.status)) || typeof input.reply !== "string" || input.reply.length > 2000) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a review status and keep the reply within 2,000 characters.")
  const service = container.resolve(CONTENT_MODULE)
  const before = await service.retrieveProductReview(input.id)
  const review = await service.updateProductReviews({ id: before.id, status: input.status as "pending" | "approved" | "rejected", reply: input.reply.trim() })
  return new StepResponse({ id: review.id, status: review.status }, { id: before.id, status: before.status, reply: before.reply })
}, async (before, { container }) => { if (before) await container.resolve(CONTENT_MODULE).updateProductReviews(before) })

export const submitProductReviewWorkflow = createWorkflow("submit-product-review", (input: SubmitInput) => new WorkflowResponse(submitProductReview(input)))
export const moderateProductReviewWorkflow = createWorkflow("moderate-product-review", (input: { id: string; status: unknown; reply: unknown }) => new WorkflowResponse(moderateProductReview(input)))
