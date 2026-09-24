import { randomInt } from "node:crypto"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"

import { CONTENT_MODULE } from "../modules/content"
import { bdMobile, realEmail } from "./contact"
import { rewardEmail } from "./review-emails"
import { storefrontUrl } from "./review-links"
import { loadReviewProgram, type ReviewProgram } from "./review-program"
import { rewardTemplateMessage } from "./review-whatsapp"
import { sendEmail } from "./send-email"
import { getWhatsAppSettings, sendTemplate, whatsappReady } from "./whatsapp"

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

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

/** Whether this reviewer (by email, or by mobile) already had a code within the cooldown. */
async function inCooldown(content: any, contact: { email: string | null; phone: string | null }, days: number): Promise<boolean> {
  if (days <= 0) return false
  const since = new Date(Date.now() - days * 86_400_000)
  for (const [field, value] of [["email", contact.email], ["phone", contact.phone]] as const) {
    if (!value) continue
    const [recent] = await content.listProductReviews({ [field]: value, reward_issued_at: { $gte: since } }, { take: 1, select: ["id"] })
    if (recent) return true
  }
  return false
}

/**
 * Issue a review's discount once it is published: a single-use percentage
 * code (Medusa promotion, limit 1, expiring with its own campaign), sent to
 * the reviewer by email, or on WhatsApp when they ordered with only a phone.
 * One code per review; one per email address or mobile per cooldown. When it
 * cannot be sent (WhatsApp not connected) the code still stands and the admin
 * sends it by hand. Never throws: a review is never lost over a reward.
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

    const email = realEmail(review.email)
    const phone = bdMobile(review.phone)
    if (!email && !phone) {
      await content.updateProductReviews({ id: review.id, reward_note: "no email or mobile to send it to" })
      return null
    }
    if (await inCooldown(content, { email, phone }, settings.rewards.cooldown_days)) {
      await content.updateProductReviews({ id: review.id, reward_note: "cooldown" })
      return null
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

    let channel: "email" | "whatsapp" | null = null
    const problems: string[] = []
    if (email) {
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
      if (sent.ok) channel = "email"
      else problems.push(`email not sent: ${sent.error}`)
    }
    if (!channel && phone) {
      const wa = await getWhatsAppSettings(container)
      if (!settings.whatsapp.rewards) problems.push("send it on WhatsApp by hand (WhatsApp codes are off)")
      else if (!whatsappReady(wa)) problems.push("send it on WhatsApp by hand (WhatsApp not connected)")
      else {
        const sent = await sendTemplate(wa, rewardTemplateMessage(settings, { author: review.author, code, pct: decision.pct, issuedAt: now }, phone))
        if (sent.ok) channel = "whatsapp"
        else problems.push(`WhatsApp not sent: ${sent.error}`)
      }
    }
    await content.updateProductReviews({
      id: review.id,
      reward_mailed_at: channel ? new Date() : null,
      reward_channel: channel,
      reward_note: channel ? null : problems.join("; ") || null,
    })
    if (!channel) logger.warn(`[review-rewards] code ${code} made but not sent: ${problems.join("; ")}`)
    return { code, pct: decision.pct }
  } catch (error: any) {
    logger.error(`[review-rewards] review ${reviewId}: ${error?.message ?? error}`)
    return null
  }
}
