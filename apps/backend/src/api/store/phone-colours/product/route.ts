import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

import { CATALOG_MODULE } from "../../../../modules/catalog"
import { readMockupSettings } from "../../../../lib/mockup-settings"
import { productPhoneColours, type ColourRowRead, type GalleryRowRead } from "../../../../lib/phone-colours"

const PRODUCT_ID = /^prod_[0-9A-Z]{26}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * GET /store/phone-colours/product?product_id=<prod_...>&device=<slug> - the
 * product page's phone colours (PHONE_COLOURS.md 3.4), called by the storefront
 * server: { colours, variants, base, galleries }, or {} when the product has no
 * variant with 2 or more colours or is not published. Galleries are sent only
 * for `device`'s variants; other models load /store/phone-colours/variant/:id.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { product_id: productId, device } = req.query
  if (typeof productId !== "string" || !PRODUCT_ID.test(productId) || typeof device !== "string" || device.length > 160 || !SLUG.test(device)) {
    res.status(400).json({ message: "Provide product_id and device." })
    return
  }
  const productModule = req.scope.resolve(Modules.PRODUCT)
  const catalog = req.scope.resolve(CATALOG_MODULE)
  // One round trip: every read is independent.
  const [products, variants, rows, galleryRows, { settings }] = await Promise.all([
    productModule.listProducts({ id: productId, status: ProductStatus.PUBLISHED }, { select: ["id"], take: 1 }),
    productModule.listProductVariants({ product_id: productId }, { select: ["id"], take: 5000 }),
    catalog.listPhoneColourGalleries({ product_id: productId }, { select: ["variant_id", "device_slug", "colour_slug", "is_main"], take: 5000 }) as Promise<ColourRowRead[]>,
    catalog.listPhoneColourGalleries({ product_id: productId, device_slug: device, is_main: false }, { select: ["variant_id", "colour_slug", "is_main", "images"], take: 1000 }) as Promise<GalleryRowRead[]>,
    readMockupSettings(req.scope),
  ])
  if (!products.length) {
    res.json({})
    return
  }
  res.json(productPhoneColours({ rows, galleryRows, liveVariantIds: new Set(variants.map((v: { id: string }) => v.id)), settings, device }))
}
