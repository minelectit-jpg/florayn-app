import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * POST /admin/stock/:id - set a blank's stocked quantity at the warehouse.
 * :id is the inventory item (blank) id. Because every design shares the blank,
 * this one number is the stock for that case type + device across the store.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.body ?? {}) as {
    location_id?: string
    stocked_quantity?: number
  }

  if (!body.location_id || !Number.isFinite(body.stocked_quantity)) {
    res.status(400).json({ message: "location_id and stocked_quantity required" })
    return
  }

  const inventory: any = req.scope.resolve(Modules.INVENTORY)
  await inventory.updateInventoryLevels([
    {
      inventory_item_id: id,
      location_id: body.location_id,
      stocked_quantity: Math.max(0, Math.floor(body.stocked_quantity as number)),
    },
  ])

  res.json({ ok: true })
}
