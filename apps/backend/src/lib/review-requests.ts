import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { opsService } from "./order-ops"
import { reviewRequestEmail } from "./review-emails"
import { loadInvite, type ReviewInvite } from "./review-invites"
import { reviewLink, reviewToken, storefrontUrl } from "./review-links"
import type { ReviewProgram, WhatsAppPolicy } from "./review-program"
import { manualRequestText, requestTemplateMessage, reviewPageUrl } from "./review-whatsapp"
import { sendEmail } from "./send-email"
import { getWhatsAppSettings, sendTemplate, waMeLink, whatsappReady } from "./whatsapp"

const DAY = 86_400_000
/** At most four products in one request email, as on florayn.com. */
export const PRODUCTS_PER_EMAIL = 4

/** When an order reached its current status (older rows fall back to their last update). */
export const changedAt = (op: any): Date => new Date(op.status_changed_at ?? op.updated_at ?? op.created_at)

/**
 * Whether an order is due its request: in a qualifying status for at least
 * the delay, not older than the cut-off, reached after requests were switched
 * on, and never asked before. Orders imported from florayn.com were handled
 * (and asked) there, so they are never due here.
 */
export function isDue(op: any, settings: ReviewProgram, now = Date.now()): boolean {
  const r = settings.requests
  if (op.source || op.review_request_sent_at || !r.statuses.includes(op.workflow_status)) return false
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
 * Which way an order is asked: email when it has a real address, WhatsApp
 * when the shop's WhatsApp is connected and the policy covers this order
 * ("no_email": only when there is no address; "always": as well as email).
 */
export function requestChannels(invite: { email: string | null; phone: string | null }, policy: WhatsAppPolicy, whatsappConnected: boolean) {
  const whatsapp = whatsappConnected && Boolean(invite.phone) && (policy === "always" || (policy === "no_email" && !invite.email))
  return { email: Boolean(invite.email), whatsapp }
}

export type RequestResult = { ok: boolean; note?: string | null; channel?: string | null }

/**
 * Send one order's review request - "How is your Florayn order?" by email,
 * and/or the WhatsApp template - and record it. An order that cannot be
 * reached (no email, WhatsApp not connected) or has nothing to review is
 * recorded too, with the reason, so it leaves the queue; the admin can still
 * open WhatsApp with the message typed in and send it by hand.
 */
export async function sendReviewRequest(container: any, orderId: string, settings: ReviewProgram): Promise<RequestResult> {
  const svc = opsService(container)
  const [op] = await svc.listOrderOps({ order_id: orderId }, { take: 1 })
  const record = async (note: string | null, channel: string | null) => {
    if (op) await svc.updateOrderOps({ id: op.id, review_request_sent_at: new Date(), review_request_note: note, review_request_channel: channel })
  }
  const invite = await loadInvite(container, orderId)
  if (!invite) return { ok: false, note: "order not found" }
  if (!invite.products.length) { await record("no reviewable products", null); return { ok: false, note: "no reviewable products" } }

  const wa = await getWhatsAppSettings(container)
  const plan = requestChannels(invite, settings.whatsapp.requests, whatsappReady(wa))
  if (!plan.email && !plan.whatsapp) {
    const note = !invite.phone ? "no email or mobile" : settings.whatsapp.requests === "off" ? "no email (WhatsApp is off)" : "no email; WhatsApp not connected"
    await record(note, null)
    return { ok: false, note }
  }

  const sent: string[] = []
  const problems: string[] = []
  if (plan.email) {
    const message = reviewRequestEmail({
      firstName: invite.firstName,
      products: inviteLinks(invite),
      photoPct: settings.rewards.photo_pct,
      textPct: settings.rewards.text_pct,
      rewardsOn: settings.rewards.enabled,
    })
    const result = await sendEmail({ to: invite.email!, fromName: settings.from_name, ...message })
    if (result.ok) sent.push("email")
    else problems.push(`email not sent: ${result.error}`)
  }
  if (plan.whatsapp) {
    const result = await sendTemplate(wa, requestTemplateMessage(settings, invite, invite.phone!, reviewToken(invite.orderId)))
    if (result.ok) sent.push("whatsapp")
    else problems.push(`WhatsApp not sent: ${result.error}`)
  }
  const channel = sent.join("+") || null
  const note = problems.join("; ") || null
  await record(note, channel)
  return { ok: Boolean(channel), note, channel }
}

/**
 * The request as a wa.me link, for the admin to send from the shop's own
 * WhatsApp: opens the customer's chat with the message and review link typed
 * in. Works without any WhatsApp Business setup.
 */
export async function manualRequest(container: any, orderId: string, settings: ReviewProgram): Promise<{ url: string; text: string; phone: string } | { error: string }> {
  const invite = await loadInvite(container, orderId)
  if (!invite) return { error: "Order not found." }
  if (!invite.phone) return { error: "This order has no Bangladeshi mobile number." }
  if (!invite.products.length) return { error: "Nothing in this order can be reviewed." }
  const text = manualRequestText(settings, invite, reviewPageUrl(storefrontUrl(), reviewToken(invite.orderId)))
  return { url: waMeLink(invite.phone, text), text, phone: invite.phone }
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
