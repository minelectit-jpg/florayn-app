import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/stock - availability per BLANK (case type x device), keyed by
 * "<Case Type name>|<Device name>". Stock is shared across every design printed
 * on a blank, so the storefront reads this once and greys out / marks sold-out
 * any (case type, device) whose pool is empty - the same number for all designs.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "metadata",
      "location_levels.stocked_quantity",
      "location_levels.reserved_quantity",
    ],
  })

  const stock: Record<string, number> = {}
  for (const it of items) {
    const ct = (it as any).metadata?.case_type_name
    const dev = (it as any).metadata?.device_name
    if (!ct || !dev) continue
    let available = 0
    for (const lvl of (it as any).location_levels ?? []) {
      available += (lvl.stocked_quantity ?? 0) - (lvl.reserved_quantity ?? 0)
    }
    stock[`${ct}|${dev}`] = Math.max(0, available)
  }

  res.json({ stock })
}
