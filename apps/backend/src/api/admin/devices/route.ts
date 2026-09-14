import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /admin/devices - every device, active or not, for the admin screen where
 * an admin turns devices on and off. The storefront's /store/devices only ever
 * returns is_active ones, so deactivating a device here removes it from the site
 * without touching code (this is how a "dummy" device is retired).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const devices = await catalog.listDevices(
    {},
    { order: { sort_order: "ASC" } }
  )
  res.json({ devices, count: devices.length })
}
