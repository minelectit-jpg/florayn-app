import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { BUNDLES_MODULE } from "../../../modules/bundles"
import {
  getBundleConfig,
  withMatchingSetDefaults,
} from "../../../modules/bundles/config"

/** GET /admin/bundles - settings plus every tier, enabled or not. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  const { settings, tiers } = await getBundleConfig(service)
  res.json({
    settings: { ...settings, ...withMatchingSetDefaults(settings) },
    tiers,
  })
}

/** POST /admin/bundles - update the store-wide settings. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  const { settings } = await getBundleConfig(service)
  const body = (req.body ?? {}) as Record<string, unknown>

  const patch: Record<string, unknown> = {}
  if (typeof body.heading === "string") patch.heading = body.heading.trim()
  if (typeof body.single_label === "string") {
    patch.single_label = body.single_label.trim()
  }
  if (body.free_shipping_threshold != null) {
    const value = Number(body.free_shipping_threshold)
    if (!Number.isFinite(value) || value < 0) {
      return res
        .status(400)
        .json({ message: "free_shipping_threshold must be 0 or more" })
    }
    patch.free_shipping_threshold = Math.round(value)
  }
  if (typeof body.scope === "string") patch.scope = body.scope.trim()
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active

  // Matching Set (phone + AirPods bundle).
  if (typeof body.matching_set_enabled === "boolean") {
    patch.matching_set_enabled = body.matching_set_enabled
  }
  if (typeof body.matching_set_title === "string") {
    patch.matching_set_title = body.matching_set_title.trim()
  }
  if (typeof body.matching_set_subtitle === "string") {
    patch.matching_set_subtitle = body.matching_set_subtitle.trim()
  }
  if (body.matching_set_discount != null) {
    const value = Number(body.matching_set_discount)
    if (!Number.isFinite(value) || value < 0) {
      return res
        .status(400)
        .json({ message: "matching_set_discount must be 0 or more" })
    }
    patch.matching_set_discount = Math.round(value)
  }
  if (typeof body.matching_set_default_airpods === "string") {
    patch.matching_set_default_airpods = body.matching_set_default_airpods.trim()
  }

  await service.updateBundleSettings({ id: settings.id, ...patch })
  const next = await getBundleConfig(service)
  res.json({ settings: next.settings, tiers: next.tiers })
}
