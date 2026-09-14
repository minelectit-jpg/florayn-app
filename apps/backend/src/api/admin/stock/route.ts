import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/stock - the blank stock pools (one per case type x device). In
 * Structure B every design's variant links to a shared blank, so stock is
 * managed here per blank, not per the 13k variants. Each blank carries its case
 * type / device in metadata and has one level at the warehouse.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "sku",
      "title",
      "metadata",
      "location_levels.location_id",
      "location_levels.stocked_quantity",
      "location_levels.reserved_quantity",
    ],
  })

  const blanks = items.map((it: any) => {
    const level = (it.location_levels ?? [])[0] ?? {}
    return {
      id: it.id,
      sku: it.sku,
      title: it.title,
      case_type_slug: it.metadata?.case_type_slug ?? null,
      case_type_name: it.metadata?.case_type_name ?? null,
      device_slug: it.metadata?.device_slug ?? null,
      device_name: it.metadata?.device_name ?? it.title ?? it.sku,
      location_id: level.location_id ?? null,
      stocked: level.stocked_quantity ?? 0,
      reserved: level.reserved_quantity ?? 0,
    }
  })

  res.json({ blanks, count: blanks.length })
}
