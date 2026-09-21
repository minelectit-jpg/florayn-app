import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getCourierSettings } from "../../../../lib/steadfast"
import { opsService } from "../../../../lib/order-ops"

/** A masked view - never returns the raw key/secret to the browser. */
function present(s: any) {
  const mask = (v: string | null) =>
    v && v.length > 4 ? `••••••••${v.slice(-4)}` : v ? "••••" : ""
  return {
    provider: s.provider ?? "steadfast",
    base_url: s.base_url ?? "https://portal.packzy.com/api/v1",
    enabled: Boolean(s.enabled),
    default_delivery_type: Number(s.default_delivery_type ?? 0),
    api_key_masked: mask(s.api_key ?? null),
    secret_key_masked: mask(s.secret_key ?? null),
    api_key_set: Boolean(s.api_key),
    secret_key_set: Boolean(s.secret_key),
    // The webhook token is meant to be copied into the Steadfast portal, so it
    // is returned in full (it only authorizes inbound status pushes).
    webhook_token: s.webhook_token ?? "",
    webhook_path: "/webhooks/steadfast",
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const settings = await getCourierSettings(req.scope)
  return res.json({ settings: present(settings) })
}

/**
 * POST /admin/courier/settings
 * Update credentials/config. Empty api_key/secret_key are ignored so the owner
 * can toggle `enabled` or change the base URL without re-entering the secret.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const settings = await getCourierSettings(req.scope)

  const patch: Record<string, unknown> = { id: settings.id }
  if (typeof body.api_key === "string" && body.api_key.trim()) patch.api_key = body.api_key.trim()
  if (typeof body.secret_key === "string" && body.secret_key.trim()) patch.secret_key = body.secret_key.trim()
  if (typeof body.base_url === "string" && body.base_url.trim()) patch.base_url = body.base_url.trim()
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled
  if (body.default_delivery_type != null && Number.isFinite(Number(body.default_delivery_type))) {
    patch.default_delivery_type = Number(body.default_delivery_type) === 1 ? 1 : 0
  }

  await opsService(req.scope).updateCourierSettings(patch)
  const updated = await getCourierSettings(req.scope)
  return res.json({ success: true, settings: present(updated) })
}
