import crypto from "node:crypto"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { opsService } from "../../../lib/order-ops"
import { getCourierSettings, mapSteadfastStatus } from "../../../lib/steadfast"

/**
 * POST /webhooks/steadfast - Steadfast pushes a delivery-status change here.
 * Public route (not under /admin or /store, so no session auth); secured by a
 * shared Bearer token the owner registers in the Steadfast portal alongside
 * this URL. Payload: { consignment_id, invoice, status, cod_amount, updated_at }.
 * Idempotent, returns 200 fast (Steadfast only retries twice).
 */
function tokenOk(header: unknown, expected: string | null): boolean {
  if (!expected) return false
  const raw = typeof header === "string" ? header : ""
  const provided = raw.startsWith("Bearer ") ? raw.slice(7) : raw
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const settings = await getCourierSettings(req.scope)
  if (!tokenOk(req.headers.authorization, settings.webhook_token)) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const body = (req.body ?? {}) as {
    consignment_id?: unknown
    invoice?: unknown
    status?: unknown
    delivery_status?: unknown
  }
  const consignmentId = body.consignment_id != null ? String(body.consignment_id) : ""
  const rawStatus = body.status ?? body.delivery_status
  if (!consignmentId || typeof rawStatus !== "string") {
    // Ack anything malformed so Steadfast does not retry a payload we can't use.
    return res.status(200).json({ received: true })
  }

  const svc = opsService(req.scope)
  const [op] = await svc.listOrderOps({ steadfast_consignment_id: consignmentId }, { take: 1 })
  if (op) {
    const workflow = mapSteadfastStatus(rawStatus)
    const update: any = {
      id: op.id,
      steadfast_status: rawStatus,
      steadfast_synced_at: new Date(),
    }
    // Advance only off `shipped`, so a manual refund/cancel is never overridden.
    if (op.workflow_status === "shipped" && workflow !== "shipped") {
      update.workflow_status = workflow
    }
    await svc.updateOrderOps(update)
  }

  return res.status(200).json({ received: true })
}
