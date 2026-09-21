import crypto from "node:crypto"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { opsService } from "../../../lib/order-ops"
import { getCourierSettings, mapSteadfastStatus } from "../../../lib/steadfast"

/**
 * POST /webhooks/steadfast - Steadfast pushes a delivery-status change here.
 * Public route (not under /admin or /store, so no session auth); secured by the
 * shared token the owner registers in the Steadfast portal, sent as
 * `Authorization: Bearer <token>` (Steadfast also sends an X-Signature HMAC of
 * the raw body, but the Bearer token alone is sufficient auth here).
 *
 * Steadfast wraps the parcel event as `{ notification_type: "delivery_status",
 * consignment_id, invoice, status, cod_amount, updated_at }`. We parse
 * defensively (flat or nested, several field spellings), only act on
 * delivery_status events, and always answer 200 fast (Steadfast retries 3x on a
 * 5xx and gives up; a 4xx is not retried). Idempotent by design.
 */
function tokenOk(header: unknown, expected: string | null): boolean {
  if (!expected) return false
  const raw = typeof header === "string" ? header : ""
  const provided = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim()
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function pick(obj: any, keys: string[]): unknown {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k]
  }
  return undefined
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const settings = await getCourierSettings(req.scope)
  if (!tokenOk(req.headers.authorization, settings.webhook_token)) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const body = (req.body ?? {}) as any
  const data = body?.data && typeof body.data === "object" ? body.data : body
  const notificationType = pick(body, ["notification_type"]) ?? pick(data, ["notification_type"])

  // Only delivery-status events touch an order. Ack everything else (e.g.
  // balance/account notifications) so Steadfast does not retry.
  if (notificationType && notificationType !== "delivery_status") {
    return res.status(200).json({ received: true })
  }

  const consignmentRaw = pick(data, ["consignment_id", "consignmentId"]) ?? pick(body, ["consignment_id"])
  const consignmentId = consignmentRaw != null ? String(consignmentRaw) : ""
  const rawStatus = pick(data, ["status", "delivery_status", "status_type"]) ?? pick(body, ["status", "delivery_status"])
  const invoiceRaw = pick(data, ["invoice"]) ?? pick(body, ["invoice"])

  if (typeof rawStatus !== "string" || (!consignmentId && invoiceRaw == null)) {
    return res.status(200).json({ received: true })
  }

  const svc = opsService(req.scope)

  // Find the op row by consignment id, falling back to the invoice (= order
  // display id) so a push works even if only the invoice is present.
  let op: any = null
  if (consignmentId) {
    ;[op] = await svc.listOrderOps({ steadfast_consignment_id: consignmentId }, { take: 1 })
  }
  if (!op && invoiceRaw != null) {
    const displayId = Number(String(invoiceRaw).replace(/\D/g, ""))
    if (Number.isFinite(displayId) && displayId > 0) {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
        filters: { display_id: displayId } as any,
      })
      const orderId = orders?.[0]?.id
      if (orderId) [op] = await svc.listOrderOps({ order_id: orderId }, { take: 1 })
    }
  }

  if (op) {
    const workflow = mapSteadfastStatus(rawStatus)
    const charge = pick(data, ["delivery_charge"]) ?? pick(body, ["delivery_charge"])
    const codAmount = pick(data, ["cod_amount"]) ?? pick(body, ["cod_amount"])
    const trackingMessage = pick(data, ["tracking_message"]) ?? pick(body, ["tracking_message"])
    const updatedAt = pick(data, ["updated_at"]) ?? pick(body, ["updated_at"])
    const update: any = {
      id: op.id,
      steadfast_status: rawStatus,
      steadfast_synced_at: new Date(),
      courier_meta: {
        ...(op.courier_meta ?? {}),
        ...(charge != null ? { charge: Number(charge) } : {}),
        ...(codAmount != null ? { cod_amount: Number(codAmount) } : {}),
        ...(typeof trackingMessage === "string" ? { tracking_message: trackingMessage } : {}),
        ...(updatedAt != null ? { updated_at: String(updatedAt) } : {}),
        event: notificationType ?? "delivery_status",
      },
    }
    // Advance only off `shipped`, so a manual refund/cancel is never overridden.
    if (op.workflow_status === "shipped" && workflow !== "shipped") {
      update.workflow_status = workflow
    }
    await svc.updateOrderOps(update)
  }

  return res.status(200).json({ received: true })
}
