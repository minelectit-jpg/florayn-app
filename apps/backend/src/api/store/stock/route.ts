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
  if (req.query.handle !== undefined) {
    const handle = req.query.handle
    if (typeof handle !== "string" || handle.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
      res.status(400).json({ message: "Invalid product handle." })
      return
    }
    const { data: products } = await query.graph({ entity: "product", filters: { handle, status: "published" }, fields: [
      "id", "variants.id", "variants.manage_inventory", "variants.allow_backorder",
      "variants.inventory_items.required_quantity", "variants.inventory_items.inventory.location_levels.stocked_quantity",
      "variants.inventory_items.inventory.location_levels.reserved_quantity",
    ] })
    const stock: Record<string, number> = {}
    for (const v of (products[0] as any)?.variants ?? []) {
      if (!v.manage_inventory || v.allow_backorder) continue
      const available = (v.inventory_items ?? []).map((item: any) => {
        const total = (item.inventory?.location_levels ?? []).reduce((n: number, l: any) => n + Math.max(0, Number(l.stocked_quantity) - Number(l.reserved_quantity)), 0)
        return Math.floor(total / Math.max(1, Number(item.required_quantity ?? 1)))
      })
      stock[`variant:${v.id}`] = available.length ? Math.min(...available) : 0
    }
    res.json({ stock })
    return
  }
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
