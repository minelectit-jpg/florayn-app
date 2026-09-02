import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { BUNDLES_MODULE } from "../../../modules/bundles"
import { getBundleConfig } from "../../../modules/bundles/config"

/**
 * GET /store/bundles - the multi-buy widget's configuration.
 *
 * Only enabled tiers are returned; the storefront prices them against whichever
 * device the shopper has selected, because Alcantara is not flat.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  const { settings, tiers } = await getBundleConfig(service)

  res.json({
    settings: {
      heading: settings.heading,
      single_label: settings.single_label,
      free_shipping_threshold: settings.free_shipping_threshold,
      scope: settings.scope,
      is_active: settings.is_active,
    },
    tiers: tiers
      .filter((tier: any) => tier.is_enabled)
      .map((tier: any) => ({
        id: tier.id,
        quantity: tier.quantity,
        badge: tier.badge,
        discount_amount: tier.discount_amount,
        min_pct: tier.min_pct,
        max_pct: tier.max_pct,
      })),
  })
}
