import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { savePhoneColourGalleriesWorkflow } from "../../../../../workflows/phone-colours"

export const AUTHENTICATE = true

/**
 * POST /admin/designs/:slug/colours { source, variants } - save which phone
 * colour each variant's main gallery shows and the extra colours' galleries
 * (PHONE_COLOURS.md). Display only: no option, variant, price or stock changes.
 * The storefront refresh is automatic (an /admin/designs write).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { slug } = req.params
  if (!slug || !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(slug)) {
    res.status(400).json({ message: "Give the design's web address." })
    return
  }
  const body = (req.body ?? {}) as { source?: unknown; variants?: unknown }
  try {
    const { result } = await savePhoneColourGalleriesWorkflow(req.scope).run({ input: { designSlug: slug, source: body.source, variants: body.variants } })
    res.json(result)
  } catch (error: any) {
    const known = error?.type === MedusaError.Types.INVALID_DATA || error?.type === MedusaError.Types.NOT_FOUND
    if (!known) req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`[design-colours ${slug}] ${error?.message ?? error}`)
    // Only refusals are 4xx; anything else is a server failure the console
    // retries once (runSteps). The save is one transaction, so a retry is safe.
    const status = error?.type === MedusaError.Types.NOT_FOUND ? 404 : known ? 400 : 500
    res.status(status).json({ message: known ? error.message || "Could not save the phone colour pictures." : "Could not save the phone colour pictures. Try again." })
  }
}
