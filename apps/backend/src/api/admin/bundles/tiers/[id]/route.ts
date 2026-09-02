import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { BUNDLES_MODULE } from "../../../../../modules/bundles"
import { getBundleConfig } from "../../../../../modules/bundles/config"
import { validateTier } from "../../../../../modules/bundles/validate"

/** POST /admin/bundles/tiers/:id - edit a tier. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  const parsed = validateTier(req.body, { partial: true })

  if ("error" in parsed) {
    return res.status(400).json({ message: parsed.error })
  }

  await service.updateBundleTiers({ id: req.params.id, ...parsed.value })
  const next = await getBundleConfig(service)
  res.json({ settings: next.settings, tiers: next.tiers })
}

/** DELETE /admin/bundles/tiers/:id */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(BUNDLES_MODULE)
  await service.deleteBundleTiers(req.params.id)
  const next = await getBundleConfig(service)
  res.json({ settings: next.settings, tiers: next.tiers })
}
