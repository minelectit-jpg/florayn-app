import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sortNewestFirst } from "../../../lib/device-order"
import { CATALOG_MODULE } from "../../../modules/catalog"

/**
 * GET /store/devices - the full device list, grouped by family, for the
 * "find your device" navigation. Families keep their admin order; within a
 * family the newest model comes first (lib/device-order.ts).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalogModuleService: any = req.scope.resolve(CATALOG_MODULE)

  const devices = sortNewestFirst(
    await catalogModuleService.listDevices(
      { is_active: true },
      { order: { sort_order: "ASC" } }
    ),
    (d: any) => d.name,
    (d: any) => d.family
  )

  const families: Record<string, any[]> = {}
  for (const device of devices) {
    ;(families[device.family] ??= []).push(device)
  }

  res.json({ devices, families, count: devices.length })
}
