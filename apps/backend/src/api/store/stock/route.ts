import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { blankAvailability, variantAvailability } from "../../../lib/stock-availability"

/**
 * GET /store/stock - availability per BLANK (case type x device), keyed by
 * "<Case Type name>|<Device name>". Stock is shared across every design printed
 * on a blank, so the storefront reads this once and greys out / marks sold-out
 * any (case type, device) whose pool is empty - the same number for all designs.
 * With ?handle= it answers per variant of that published regular product. The
 * reads live in lib/stock-availability.ts, shared with the catalog feed.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  if (req.query.handle !== undefined) {
    const handle = req.query.handle
    if (typeof handle !== "string" || handle.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
      res.status(400).json({ message: "Invalid product handle." })
      return
    }
    res.json({ stock: await variantAvailability(query, handle) })
    return
  }
  res.json({ stock: await blankAvailability(query) })
}
