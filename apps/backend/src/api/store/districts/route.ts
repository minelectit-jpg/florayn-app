import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  DISTRICTS,
  INSIDE_DHAKA_DISTRICTS,
  SHIPPING,
} from "../../../modules/catalog/data/bangladesh"

/**
 * GET /store/districts - the 64 districts for the checkout dropdown, plus the
 * delivery rates, so the storefront can show a live shipping estimate without
 * hardcoding numbers that could drift from the backend.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    districts: DISTRICTS,
    count: DISTRICTS.length,
    inside_dhaka: INSIDE_DHAKA_DISTRICTS,
    shipping: {
      inside_dhaka: SHIPPING.insideDhaka,
      outside_dhaka: SHIPPING.outsideDhaka,
      free_threshold: SHIPPING.freeThreshold,
    },
  })
}
