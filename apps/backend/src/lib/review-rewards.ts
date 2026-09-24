import { randomInt } from "node:crypto"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"

import { CONTENT_MODULE } from "../modules/content"
import { rewardEmail } from "./review-emails"
import { storefrontUrl } from "./review-links"
import { loadReviewProgram, type ReviewProgram } from "./review-program"
import { sendEmail } from "./send-email"

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** REV + six letters/digits, e.g. REVK7Q2MX (no 0/O or 1/I to misread). */
export function rewardCode(): string {
  return "REV" + Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("")
}

export type RewardDecision = { pct: number; withPhotos: boolean } | { skip: string }

/** What a published review earns under the programme, before any code is made. */
export function rewardFor(review: { rating: number; images?: unknown; coupon_code?: string | null; status: string }, settings: ReviewProgram): RewardDecision {
  if (!settings.rewards.enabled) return { skip: "rewards off" }
  if (review.status !== "approved") return { skip: "not published" }
  if (review.coupon_code) return { skip: "already rewarded" }
  if (review.rating < settings.rewards.min_rating) return { skip: `below ${settings.rewards.min_rating} stars` }
  const withPhotos = Array.isArray(review.images) && review.images.length > 0
  const pct = withPhotos ? settings.rewards.photo_pct : settings.rewards.text_pct
  return pct > 0 ? { pct, withPhotos } : { skip: "no reward for this kind of review" }
}

/**
 * Issue a review's discount once it is published: a single-use percentage
 * code (Medusa promotion, limit 1, expiring with its own campaign), mailed to
 * the reviewer. One code per review; one per email address per cooldown.
 * Never throws: a review is never lost over a reward.
 */
export async function issueReviewReward(container: any, reviewId: string): Promise<{ code: string; pct: number } | null> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const content: any = container.resolve(CONTENT_MODULE)
    const { settings } = await loadReviewProgram(container)
    const review = await content.retrieveProductReview(reviewId)
    const decision = rewardFor(review, settings)
    if ("skip" in decision) {
      if (decision.skip !== "already rewarded" && decision.skip !== "not published") {
        await content.updateProductReviews({ id: review.id, reward_note: decision.skip })
      }
      return null
    }

    const email = typeof review.email === "string" && EMAIL.test(review.email) ? review.email.toLowerCase() : null
    if (!email) {
      await content.updateProductReviews({ id: review.id, reward_note: "no email to send it to" })
      return null
    }
    if (settings.rewards.cooldown_days > 0) {
      const since = new Date(Date.now() - settings.rewards.cooldown_days * 86_400_000)
      const [recent] = await content.listProductReviews({ email, reward_issued_at: { $gte: since } }, { take: 1, select: ["id"] })
      if (recent) {
        await content.updateProductReviews({ id: review.id, reward_note: "cooldown" })
        return null
      }
    }

    const promotions: any = container.resolve(Modules.PROMOTION)
    let code = rewardCode()
    for (let tries = 0; tries < 5; tries++) {
      const [taken] = await promotions.listPromotions({ code }, { take: 1, select: ["id"] })
      if (!taken) break
      code = rewardCode()
    }
    const now = new Date()
    const ends = settings.rewards.expiry_days > 0 ? new Date(now.getTime() + settings.rewards.expiry_days * 86_400_000) : null
    await createPromotionsWorkflow(container).run({
      input: {
        promotionsData: [{
          code,
          type: "standard",
          status: "active",
          is_automatic: false,
          limit: 1,
          application_method: { type: "percentage", target_type: "order", value: decision.pct, currency_code: "bdt" },
          ...(ends ? { campaign: { name: `Review reward ${code}`, campaign_identifier: `review-reward-${code}`, starts_at: now, ends_at: ends } } : {}),
        } as any],
      },
    })
    await content.updateProductReviews({ id: review.id, coupon_code: code, reward_pct: decision.pct, reward_issued_at: now, reward_note: null })

    const product = await container.resolve(Modules.PRODUCT).retrieveProduct(review.product_id, { select: ["title", "metadata"] }).catch(() => null)
    const message = rewardEmail({
      author: review.author,
      product: (product?.metadata?.design_name as string) || product?.title || "your Florayn case",
      withPhotos: decision.withPhotos,
      code,
      pct: decision.pct,
      expiryDays: settings.rewards.expiry_days,
      shopUrl: storefrontUrl(),
    })
    const sent = await sendEmail({ to: email, fromName: settings.from_name, ...message })
    if (sent.ok) await content.updateProductReviews({ id: review.id, reward_mailed_at: new Date() })
    else logger.warn(`[review-rewards] code ${code} made but not mailed: ${sent.error}`)
    return { code, pct: decision.pct }
  } catch (error: any) {
    logger.error(`[review-rewards] review ${reviewId}: ${error?.message ?? error}`)
    return null
  }
}
