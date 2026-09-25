import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sanitizeBadge } from "../../../../lib/menu-section-input"
import { CATALOG_MODULE } from "../../../../modules/catalog"

/**
 * POST /admin/devices/:id - update one device. Only the fields an admin should
 * edit are accepted; is_active is the important one (turning a device off hides
 * it from the storefront). name and sort_order are allowed for tidying. badge
 * (12 characters or fewer, "" or null clears it) shows next to the model in the
 * menu and search.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.body ?? {}) as {
    is_active?: boolean
    name?: string
    sort_order?: number
    badge?: string | null
  }

  const update: Record<string, unknown> = { id }
  if (typeof body.is_active === "boolean") update.is_active = body.is_active
  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim()
  }
  if (Number.isFinite(body.sort_order)) update.sort_order = body.sort_order
  if (typeof body.badge === "string" || body.badge === null) {
    try {
      update.badge = sanitizeBadge(body.badge)
    } catch (error: any) {
      return res.status(400).json({ message: error?.message ?? String(error) })
    }
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [device] = await catalog.updateDevices([update])
  res.json({ device })
}
