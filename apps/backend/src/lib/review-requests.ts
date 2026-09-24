import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { opsService } from "./order-ops"
import { reviewRequestEmail } from "./review-emails"
import { loadInvite, type ReviewInvite } from "./review-invites"
import { reviewLink, reviewToken } from "./review-links"
import type { ReviewProgram } from "./review-program"
import { sendEmail } from "./send-email"

const DAY = 86_400_000
/** At most four products in one request email, as on florayn.com. */
export const PRODUCTS_PER_EMAIL = 4

/** When an order reached its current status (older rows fall back to their last update). */
export const changedAt = (op: any): Date => new Date(op.status_changed_at ?? op.updated_at ?? op.created_at)

/**
 * Whether an order is due its request: in a qualifying status for at least
 * the delay, not older than the cut-off, reached after requests were switched
 * on, and never asked before.
 */
export function isDue(op: any, settings: ReviewProgram, now = Date.now()): boolean {
  const r = settings.requests
  if (op.review_request_sent_at || !r.statuses.includes(op.workflow_status)) return false
  const at = changedAt(op).getTime()
  if (Number.isNaN(at) || at > now - r.delay_days * DAY || at < now - r.max_age_days * DAY) return false
  return !r.started_at || at >= Date.parse(r.started_at)
}

/** Orders due a request, oldest first (so none waits behind newer ones). */
export async function dueOrders(container: any, settings: ReviewProgram, limit = 500): Promise<any[]> {
  const ops = await opsService(container).listOrderOps(
    { workflow_status: settings.requests.statuses, review_request_sent_at: null },
    { take: 2000, order: { updated_at: "ASC" } }
  )
  return ops.filter((op: any) => isDue(op, settings)).sort((a: any, b: any) => changedAt(a).getTime() - changedAt(b).getTime()).slice(0, limit)
}

/** The review links for an order: five stars per product, plus a plain link (4 stars) to paste. */
export function inviteLinks(invite: ReviewInvite) {
  const token = reviewToken(invite.orderId)
  return invite.products.slice(0, PRODUCTS_PER_EMAIL).map((p) => ({
    ...p,
    starLinks: [1, 2, 3, 4, 5].map((r) => reviewLink(p.handle, token, r)),
    link: reviewLink(p.handle, token, 5),
  }))
}

/**
 * Send one order's "How is your Florayn order?" email and record it. An order
 * without an email or a reviewable product is recorded too, with the reason,
 * so it leaves the queue; its links can still be copied from the admin.
 */
export async function sendReviewRequest(container: any, orderId: string, settings: ReviewProgram): Promise<{ ok: boolean; note?: string }> {
  const svc = opsService(container)
  const [op] = await svc.listOrderOps({ order_id: orderId }, { take: 1 })
  const record = async (note: string | null) => {
    if (op) await svc.updateOrderOps({ id: op.id, review_request_sent_at: new Date(), review_request_note: note })
  }
  const invite = await loadInvite(container, orderId)
  if (!invite) return { ok: false, note: "order not found" }
  const email = invite.email?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await record("no email"); return { ok: false, note: "no email" } }
  if (!invite.products.length) { await record("no reviewable products"); return { ok: false, note: "no reviewable products" } }
  const message = reviewRequestEmail({
    firstName: invite.firstName,
    products: inviteLinks(invite),
    photoPct: settings.rewards.photo_pct,
    textPct: settings.rewards.text_pct,
    rewardsOn: settings.rewards.enabled,
  })
  const sent = await sendEmail({ to: email, fromName: settings.from_name, ...message })
  await record(sent.ok ? null : `not sent: ${sent.error}`)
  return sent.ok ? { ok: true } : { ok: false, note: sent.error }
}

/** Requests sent in the last 24 hours, so the daily limit holds across hourly runs. */
async function sentToday(container: any): Promise<number> {
  const [, count] = await opsService(container).listAndCountOrderOps(
    { review_request_sent_at: { $gte: new Date(Date.now() - DAY) } },
    { take: 1, select: ["id"] }
  )
  return count
}

/** One run: send what is due, within the day's limit. */
export async function runReviewRequests(container: any, settings: ReviewProgram, { ignoreDisabled = false } = {}): Promise<{ sent: number; failed: number }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!settings.requests.enabled && !ignoreDisabled) return { sent: 0, failed: 0 }
  const room = Math.max(0, settings.requests.batch - (await sentToday(container)))
  if (!room) return { sent: 0, failed: 0 }
  let sent = 0
  let failed = 0
  for (const op of await dueOrders(container, settings, room)) {
    const result = await sendReviewRequest(container, op.order_id, settings).catch((error) => ({ ok: false, note: String(error?.message ?? error) }))
    if (result.ok) sent++
    else failed++
  }
  if (sent || failed) logger.info(`[review-requests] ${sent} sent, ${failed} not sent`)
  return { sent, failed }
}
