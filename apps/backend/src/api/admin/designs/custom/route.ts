import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { uploadedPairs, wholeStock } from "../../../../lib/product-manager-input"

import {
  createUploadedDesign,
  type UploadedPairs,
} from "../../../../lib/create-uploaded-design"

/**
 * POST /admin/designs/custom - create a brand-new design's product(s) from
 * mockups the owner has already uploaded (via /admin/designs/upload). The body
 * carries the design's identity and its case-type -> device -> image-URL map;
 * the engine builds the Structure-B products, shares the blank stock and wires
 * the images. This is the manual "upload a new design" path, separate from the
 * catalogue import that GET/POST /admin/designs drives off designs.ts.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as {
    name?: string
    slug?: string
    theme?: string | null
    skuCode?: string
    blankStock?: number
    pairs?: UploadedPairs
    status?: "published" | "draft"
    description?: string
  }

  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) {
    res.status(400).json({ message: "A design name is required." })
    return
  }
  if (!body.pairs || !Object.keys(body.pairs).length) {
    res.status(400).json({ message: "No uploaded images were supplied." })
    return
  }

  const logger = req.scope.resolve("logger")
  try {
    const result = await createUploadedDesign({
      container: req.scope,
      name: body.name,
      slug: body.slug,
      theme: body.theme ?? null,
      skuCode: body.skuCode,
      blankStock: wholeStock(body.blankStock ?? 10),
      pairs: uploadedPairs(body.pairs),
      status: body.status,
      description: body.description,
    })
    res.json({ ok: true, result })
  } catch (error: any) {
    logger.error(`[create-uploaded-design] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
