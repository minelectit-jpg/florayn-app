import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CONTENT_MODULE } from "../../../modules/content"
import { loadReviewProgram, parseReviewProgram, saveReviewProgram } from "../../../lib/review-program"
import { dueOrders } from "../../../lib/review-requests"
import { emailConfigured } from "../../../lib/send-email"
import { opsService } from "../../../lib/order-ops"

/** GET /admin/review-program - the review programme's settings and its numbers. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { settings } = await loadReviewProgram(req.scope)
  const content: any = req.scope.resolve(CONTENT_MODULE)
  const [queue, [, sent], [, coupons], [, approved], [, pending]] = await Promise.all([
    dueOrders(req.scope, settings, 5000),
    opsService(req.scope).listAndCountOrderOps({ review_request_sent_at: { $ne: null } }, { take: 1, select: ["id"] }),
    content.listAndCountProductReviews({ coupon_code: { $ne: null } }, { take: 1, select: ["id"] }),
    content.listAndCountProductReviews({ status: "approved" }, { take: 1, select: ["id"] }),
    content.listAndCountProductReviews({ status: "pending" }, { take: 1, select: ["id"] }),
  ])
  res.json({
    settings,
    email_configured: emailConfigured(),
    stats: { queue: queue.length, sent, coupons, approved, pending },
  })
}

/** POST /admin/review-program { settings } - save; switching requests on starts from now. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { settings, errors } = parseReviewProgram((req.body as any)?.settings)
  if (!settings) { res.status(400).json({ message: "Check the highlighted settings.", errors }); return }
  res.json({ settings: await saveReviewProgram(req.scope, settings) })
}
