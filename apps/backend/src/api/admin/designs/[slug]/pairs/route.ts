import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { addPairsToDesign } from "../../../../../lib/add-design-pairs"
import type { UploadedPairs } from "../../../../../lib/create-uploaded-design"

/**
 * POST /admin/designs/:slug/pairs { pairs, blankStock? }
 * Append new (case type × device) variants - with images - to an existing
 * design's products. `pairs` is caseTypeSlug -> deviceSlug -> image URLs, exactly
 * like /admin/designs/custom. Existing variants are left untouched; only new
 * pairs are added. Price comes from the case type (never per-design).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { slug } = req.params
  if (!slug) {
    res.status(400).json({ message: "slug is required." })
    return
  }
  const body = (req.body ?? {}) as { pairs?: UploadedPairs; blankStock?: number }
  if (!body.pairs || !Object.keys(body.pairs).length) {
    res.status(400).json({ message: "No pairs were supplied." })
    return
  }
  try {
    const result = await addPairsToDesign(
      req.scope,
      slug,
      body.pairs,
      Number.isFinite(body.blankStock) ? Number(body.blankStock) : 10
    )
    res.json(result)
  } catch (error: any) {
    req.scope.resolve("logger").error(`[add-design-pairs ${slug}] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
