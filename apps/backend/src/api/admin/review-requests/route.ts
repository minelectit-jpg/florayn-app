import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../../../modules/content"
import { opsService } from "../../../lib/order-ops"
import { loadInvite } from "../../../lib/review-invites"
import { loadReviewProgram } from "../../../lib/review-program"
import { changedAt, dueOrders, inviteLinks, runReviewRequests, sendReviewRequest } from "../../../lib/review-requests"

const PAGE = 50

/** Display facts for a set of orders: number, customer, email, phone. */
async function orderFacts(scope: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>()
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "display_id", "email", "created_at", "shipping_address.first_name", "shipping_address.last_name", "shipping_address.phone"],
    filters: { id: ids },
  })
  return new Map<string, any>((data ?? []).map((o: any) => [o.id, {
    display_id: o.display_id,
    email: o.email ?? null,
    name: [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(" ") || null,
    phone: o.shipping_address?.phone ?? null,
  }]))
}

/** Order ids matching an order number, email, phone or customer name (newest first, 10 at most). */
async function findOrders(scope: any, q: string): Promise<string[]> {
  const knex: any = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
  const rows: { id: string }[] = await knex("order as o")
    .leftJoin("order_address as a", "a.id", "o.shipping_address_id")
    .whereNull("o.deleted_at")
    .andWhere((w: any) => {
      if (/^\d{1,9}$/.test(q)) w.orWhere("o.display_id", Number(q))
      w.orWhereILike("o.email", like)
        .orWhereILike("a.phone", like)
        .orWhereRaw("concat_ws(' ', a.first_name, a.last_name) ilike ?", [like])
    })
    .orderBy("o.created_at", "desc")
    .limit(10)
    .select("o.id")
  return rows.map((r) => r.id)
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
    const ids = await findOrders(req.scope, req.query.q.trim().slice(0, 100))
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
 *   { action: "send", order_id }  mail one order now (again, if it was sent before)
 *   { action: "run" }             send one batch of what is due now
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { settings } = await loadReviewProgram(req.scope)
  if (body.action === "send" && typeof body.order_id === "string" && /^order_[A-Za-z0-9]+$/.test(body.order_id)) {
    const result = await sendReviewRequest(req.scope, body.order_id, settings)
    if (result.ok) { res.json({ ok: true }); return }
    res.status(400).json({
      ok: false,
      message: result.note === "no email"
        ? "This order has no email address. Copy a link and send it on WhatsApp or Messenger instead."
        : `Could not send that one (${result.note}).`,
    })
    return
  }
  if (body.action === "run") {
    res.json(await runReviewRequests(req.scope, settings, { ignoreDisabled: true }))
    return
  }
  res.status(400).json({ message: "Choose an order to send to." })
}
