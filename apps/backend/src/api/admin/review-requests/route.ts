import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../../../modules/content"
import { localMobile, realEmail } from "../../../lib/contact"
import { opsService, searchOrderIds } from "../../../lib/order-ops"
import { loadInvite } from "../../../lib/review-invites"
import { loadReviewProgram } from "../../../lib/review-program"
import { changedAt, dueOrders, inviteLinks, manualRequest, runReviewRequests, sendReviewRequest } from "../../../lib/review-requests"

const PAGE = 50

/**
 * Display facts for a set of orders: number, customer, email, phone. A
 * phone-only order's checkout placeholder email shows as no email.
 */
async function orderFacts(scope: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>()
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "display_id", "email", "created_at", "metadata", "shipping_address.first_name", "shipping_address.last_name", "shipping_address.phone"],
    filters: { id: ids },
  })
  return new Map<string, any>((data ?? []).map((o: any) => [o.id, {
    display_id: o.display_id,
    email: realEmail(o.email),
    name: [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(" ") || null,
    phone: o.shipping_address?.phone ?? null,
    whatsapp: Boolean(localMobile(o.shipping_address?.phone) ?? localMobile(o.metadata?.customer_phone)),
  }]))
}

/**
 * GET /admin/review-requests
 *   (default)              orders waiting for their request (first 25) and how many
 *   ?view=log&offset=      requests sent, newest first, with whether a review came back
 *   ?q=<order no./email/phone/name>  orders to send to, or whose review links to copy
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { settings } = await loadReviewProgram(req.scope)
  const svc = opsService(req.scope)
  const content: any = req.scope.resolve(CONTENT_MODULE)

  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const ids = await searchOrderIds(req.scope, req.query.q, 10)
    const [facts, ops] = await Promise.all([
      orderFacts(req.scope, ids),
      ids.length ? svc.listOrderOps({ order_id: ids }, { take: ids.length }) : [],
    ])
    const opById = new Map<string, any>(ops.map((op: any) => [op.order_id, op]))
    const orders = await Promise.all(ids.map(async (id) => {
      const invite = await loadInvite(req.scope, id)
      const op = opById.get(id)
      return {
        order_id: id,
        ...facts.get(id),
        status: op?.workflow_status ?? "processing",
        sent_at: op?.review_request_sent_at ?? null,
        note: op?.review_request_note ?? null,
        channel: op?.review_request_channel ?? null,
        products: invite ? inviteLinks(invite).map((p) => ({ id: p.id, title: p.title, thumbnail: p.thumbnail, link: p.link })) : [],
      }
    }))
    res.json({ orders })
    return
  }

  if (req.query.view === "log") {
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const [ops, count] = await svc.listAndCountOrderOps(
      { review_request_sent_at: { $ne: null } },
      { take: PAGE, skip: offset, order: { review_request_sent_at: "DESC" } }
    )
    const ids = ops.map((op: any) => op.order_id)
    const [facts, reviews] = await Promise.all([
      orderFacts(req.scope, ids),
      ids.length ? content.listProductReviews({ order_id: ids }, { take: 500, select: ["order_id", "rating", "status"] }) : [],
    ])
    const reviewed = new Map<string, any>()
    for (const r of reviews) if (!reviewed.has(r.order_id)) reviewed.set(r.order_id, r)
    res.json({
      count, offset, limit: PAGE,
      log: ops.map((op: any) => {
        const review = reviewed.get(op.order_id)
        return {
          order_id: op.order_id,
          ...facts.get(op.order_id),
          sent_at: op.review_request_sent_at,
          note: op.review_request_note,
          channel: op.review_request_channel ?? null,
          review: review ? { rating: review.rating, status: review.status } : null,
        }
      }),
    })
    return
  }

  const due = await dueOrders(req.scope, settings, 5000)
  const first = due.slice(0, 25)
  const facts = await orderFacts(req.scope, first.map((op: any) => op.order_id))
  res.json({
    count: due.length,
    queue: first.map((op: any) => ({ order_id: op.order_id, ...facts.get(op.order_id), status: op.workflow_status, since: changedAt(op) })),
  })
}

/**
 * POST /admin/review-requests
 *   { action: "send", order_id }      send one order now by email and/or
 *                                     WhatsApp (again, if it was sent before)
 *   { action: "whatsapp", order_id }  the request as a wa.me link, to send by
 *                                     hand from the shop's WhatsApp; recorded
 *   { action: "run" }                 send one batch of what is due now
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { settings } = await loadReviewProgram(req.scope)
  const orderId = typeof body.order_id === "string" && /^order_[A-Za-z0-9]+$/.test(body.order_id) ? body.order_id : null
  if (body.action === "send" && orderId) {
    const result = await sendReviewRequest(req.scope, orderId, settings)
    if (result.ok) { res.json({ ok: true, channel: result.channel, note: result.note ?? null }); return }
    res.status(400).json({
      ok: false,
      message: /^no email/.test(result.note ?? "")
        ? "This order has no email address and WhatsApp is not connected. Use the WhatsApp button to send it from your own WhatsApp."
        : `Could not send that one (${result.note}).`,
    })
    return
  }
  if (body.action === "whatsapp" && orderId) {
    const result = await manualRequest(req.scope, orderId, settings)
    if ("error" in result) { res.status(400).json({ message: result.error }); return }
    const svc = opsService(req.scope)
    const [op] = await svc.listOrderOps({ order_id: orderId }, { take: 1 })
    if (op) await svc.updateOrderOps({ id: op.id, review_request_sent_at: new Date(), review_request_note: null, review_request_channel: "whatsapp by hand" })
    res.json({ url: result.url, text: result.text })
    return
  }
  if (body.action === "run") {
    res.json(await runReviewRequests(req.scope, settings, { ignoreDisabled: true }))
    return
  }
  res.status(400).json({ message: "Choose an order to send to." })
}
