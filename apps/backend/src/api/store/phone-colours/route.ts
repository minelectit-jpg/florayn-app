import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { readMockupSettings } from "../../../lib/mockup-settings"
import { shopPalette } from "../../../lib/phone-colours"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * GET /store/phone-colours?device=<slug>&case_type=<slug> - the shop's phone
 * colour palette for one model and case type (PHONE_COLOURS.md 3.4):
 * { caseType, default, colours: [slug, name, hex, available 0|1][] } in palette
 * order. available = a live variant of a published product has pictures in
 * that colour (rows left by a deleted variant are inert). Sets switched off in
 * Studio still count: products outlive a disabled set.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { device, case_type: caseType } = req.query
  if (typeof device !== "string" || typeof caseType !== "string" || device.length > 160 || caseType.length > 160 || !SLUG.test(device) || !SLUG.test(caseType)) {
    res.status(400).json({ message: "Provide device and case_type as web names." })
    return
  }
  const [{ settings }, rows] = await Promise.all([
    readMockupSettings(req.scope),
    // Bounded by designs x colours for one model and case type.
    req.scope.resolve(CATALOG_MODULE).listPhoneColourGalleries(
      { device_slug: device, case_type_slug: caseType },
      { select: ["colour_slug", "product_id", "variant_id"], take: 50000 }
    ) as Promise<{ colour_slug: string; product_id: string; variant_id: string }[]>,
  ])
  const productIds = [...new Set(rows.map((row) => row.product_id))]
  const variantIds = [...new Set(rows.map((row) => row.variant_id))]
  const productModule = req.scope.resolve(Modules.PRODUCT)
  // Both depend only on the rows: one more round trip, not two.
  const [published, live] = productIds.length
    ? await Promise.all([
      productModule.listProducts({ id: productIds, status: ProductStatus.PUBLISHED }, { select: ["id"], take: productIds.length }),
      productModule.listProductVariants({ id: variantIds }, { select: ["id"], take: variantIds.length }),
    ])
    : [[], []]
  res.json(shopPalette({
    settings, device, caseType, rows,
    publishedProductIds: new Set(published.map((p: { id: string }) => p.id)),
    liveVariantIds: new Set(live.map((v: { id: string }) => v.id)),
  }))
}
