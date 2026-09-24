import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  ensureOps,
  hydrateOrders,
  opsByOrderId,
  opsService,
  projectManagedOrder,
} from "../../../../lib/order-ops"
import {
  createBulkConsignments,
  normalizeBdPhone,
  sanitizeInvoice,
  type ConsignmentInput,
} from "../../../../lib/steadfast"

type SendResult = {
  order_id: string
  ok: boolean
  tracking_code?: string
  consignment_id?: string
  error?: string
}

/**
 * POST /admin/courier/send { order_ids: string[] }
 * Book one or many orders with Steadfast in a single bulk call, then stamp the
 * consignment id + tracking code on each op row and move it to `shipped`.
 * Orders already sent, or with an unusable phone, are skipped with a reason.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { order_ids?: unknown }
  const orderIds = Array.isArray(body.order_ids)
    ? body.order_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : []
  if (!orderIds.length) return res.status(400).json({ message: "No orders selected." })

  await ensureOps(req.scope, orderIds)
  const [orders, ops] = await Promise.all([
    hydrateOrders(req.scope, orderIds),
    opsByOrderId(req.scope, orderIds),
  ])

  const results: SendResult[] = []
  const inputs: ConsignmentInput[] = []
  const invoiceToOrder = new Map<string, string>()

  for (const orderId of orderIds) {
    const order = orders.get(orderId)
    const op = ops.get(orderId)
    if (!order) {
      results.push({ order_id: orderId, ok: false, error: "Order not found." })
      continue
    }
    if (op?.steadfast_consignment_id) {
      results.push({
        order_id: orderId,
        ok: true,
        tracking_code: op.steadfast_tracking_code ?? undefined,
        consignment_id: op.steadfast_consignment_id,
        error: "Already sent.",
      })
      continue
    }
    const m = projectManagedOrder(order, op)
    const phone = normalizeBdPhone(m.phone)
    if (!phone) {
      results.push({ order_id: orderId, ok: false, error: "No valid 11-digit phone." })
      continue
    }
    const invoice = sanitizeInvoice(m.display_id ?? orderId)
    invoiceToOrder.set(invoice, orderId)
    inputs.push({
      invoice,
      recipient_name: (m.customer_name || "Customer").slice(0, 100),
      recipient_phone: phone,
      recipient_address: (m.address || m.district || "Bangladesh").slice(0, 250),
      cod_amount: Math.max(0, Math.round(m.total)),
      note: (m.note || (order.metadata?.order_note as string) || "").slice(0, 250) || undefined,
    })
  }

  if (inputs.length) {
    const bulk = await createBulkConsignments(req.scope, inputs)
    if (!bulk.ok) {
      return res.status(400).json({ message: bulk.error || "Courier is not ready." })
    }
    const svc = opsService(req.scope)
    const updates: any[] = []
    for (const r of bulk.results) {
      const orderId = invoiceToOrder.get(r.invoice)
      if (!orderId) continue
      const op = ops.get(orderId)
      if (r.ok && op) {
        updates.push({
          id: op.id,
          steadfast_consignment_id: r.consignment_id ?? null,
          steadfast_tracking_code: r.tracking_code ?? null,
          steadfast_status: r.status ?? "in_review",
          steadfast_synced_at: new Date(),
          workflow_status: "shipped",
          status_changed_at: new Date(),
        })
        results.push({ order_id: orderId, ok: true, tracking_code: r.tracking_code, consignment_id: r.consignment_id })
      } else {
        results.push({ order_id: orderId, ok: false, error: r.error || "Steadfast rejected this order." })
      }
    }
    if (updates.length) await svc.updateOrderOps(updates)
  }

  const sent = results.filter((r) => r.ok && !r.error).length
  return res.json({ success: true, sent, results })
}
