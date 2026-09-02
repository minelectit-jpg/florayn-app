import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { BUNDLES_MODULE } from "../../../../modules/bundles"
import { getBundleConfig } from "../../../../modules/bundles/config"
import { validateTier } from "../../../../modules/bundles/validate"

/** POST /admin/bundles/tiers - add a tier. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  const parsed = validateTier(req.body, { partial: false })

  if ("error" in parsed) {
    return res.status(400).json({ message: parsed.error })
  }

  const { tiers } = await getBundleConfig(service)
  await service.createBundleTiers({
    sort_order: tiers.length,
    ...parsed.value,
  })

  const next = await getBundleConfig(service)
  res.json({ settings: next.settings, tiers: next.tiers })
}
