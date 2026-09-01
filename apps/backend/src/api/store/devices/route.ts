import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /store/devices - the full device list, grouped by family, for the
 * "find your device" navigation.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalogModuleService: any = req.scope.resolve(CATALOG_MODULE)

  const devices = await catalogModuleService.listDevices(
    { is_active: true },
    { order: { sort_order: "ASC" } }
  )

  const families: Record<string, any[]> = {}
  for (const device of devices) {
    ;(families[device.family] ??= []).push(device)
  }

  res.json({ devices, families, count: devices.length })
}
