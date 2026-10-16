import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

import { CATALOG_MODULE } from "../../../../../modules/catalog"
import { readMockupSettings } from "../../../../../lib/mockup-settings"
import { variantPhoneColours, type ColourRowRead } from "../../../../../lib/phone-colours"

const VARIANT_ID = /^variant_[0-9A-Z]{26}$/

/**
 * GET /store/phone-colours/variant/:id - one variant's extra phone colour
 * galleries, loaded when the shopper switches model (PHONE_COLOURS.md 3.4):
 * { base, galleries: { <colour slug>: [URL tails] } }. 404 unless the variant
 * belongs to a published product.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  if (typeof id !== "string" || !VARIANT_ID.test(id)) {
    res.status(400).json({ message: "Provide a variant ID." })
    return
  }
  const productModule = req.scope.resolve(Modules.PRODUCT)
  const [variants, rows, { settings }] = await Promise.all([
    productModule.listProductVariants({ id }, { select: ["id", "product_id"], take: 1 }),
    req.scope.resolve(CATALOG_MODULE).listPhoneColourGalleries(
      { variant_id: id },
      { select: ["variant_id", "device_slug", "colour_slug", "is_main", "images"], take: 100 }
    ) as Promise<(ColourRowRead & { images: string[] | null })[]>,
    readMockupSettings(req.scope),
  ])
  const productId = variants[0]?.product_id
  const published = productId ? await productModule.listProducts({ id: productId, status: ProductStatus.PUBLISHED }, { select: ["id"], take: 1 }) : []
  if (!published.length) {
    res.status(404).json({ message: "No published variant with that ID." })
    return
  }
  res.json(variantPhoneColours({ rows, variantId: id, settings }))
}
