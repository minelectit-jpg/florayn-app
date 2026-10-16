import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { COLOUR_SLUG } from "../../../lib/mockup-settings"

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function imageUrl(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4096 && /^https?:\/\//i.test(value) ? value : null
}

/**
 * A page-sized projection of saved cards: no prices or other device matrices.
 * With ?colour=<slug> (a shop phone colour page, PHONE_COLOURS.md 7.3) a card
 * whose pair has that colour's extra gallery also gets colourImage, its first
 * picture. image and imagesByCaseType never change, and a card without the
 * colour keeps its own picture: colour never filters, counts or sorts.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { handles: rawHandles, device, case_type: caseType, colour } = req.query
  if (colour !== undefined && (typeof colour !== "string" || !COLOUR_SLUG.test(colour))) {
    res.status(400).json({ message: "colour must be a phone colour web name." })
    return
  }
  if (typeof rawHandles !== "string" || typeof device !== "string" || typeof caseType !== "string"
    || !device.trim() || !caseType.trim() || device.length > 160 || caseType.length > 160
    || /[|\r\n]/.test(device + caseType) || rawHandles.length > 6431) {
    res.status(400).json({ message: "Provide handles, device and case_type for one shop page." })
    return
  }
  const handles = [...new Set(rawHandles.split(","))]
  if (!handles.length || handles.length > 32 || handles.some((handle) => !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(handle))) {
    res.status(400).json({ message: "Provide between 1 and 32 valid product handles." })
    return
  }

  const productModule = req.scope.resolve(Modules.PRODUCT)
  const products = await productModule.listProducts(
    { handle: handles, status: ProductStatus.PUBLISHED },
    { select: ["handle", "metadata"], take: handles.length },
  )
  const prefix = `${device}|`
  const cards: { handle: string; variantId: string | null; image: string | null; imagesByCaseType: Record<string, string>; colourImage?: string }[] = products.map((product) => {
    const pairs = record(record(record(product.metadata).card).pairs)
    const pair = record(pairs[`${prefix}${caseType}`])
    const imagesByCaseType: Record<string, string> = Object.create(null)
    for (const [key, value] of Object.entries(pairs)) {
      if (!key.startsWith(prefix)) continue
      const name = key.slice(prefix.length)
      const image = imageUrl(record(value).image)
      if (name && name.length <= 160 && image) imagesByCaseType[name] = image
    }
    return {
      handle: product.handle,
      variantId: typeof pair.variantId === "string" && pair.variantId.length <= 200 ? pair.variantId : null,
      image: imageUrl(pair.image),
      imagesByCaseType,
    }
  })
  if (typeof colour === "string") {
    // One query for at most 32 variants; the main row (no images) gives nothing.
    const ids = [...new Set(cards.map((card) => card.variantId).filter((id): id is string => Boolean(id)))]
    const rows = ids.length
      ? await req.scope.resolve(CATALOG_MODULE).listPhoneColourGalleries(
        { variant_id: ids, colour_slug: colour, is_main: false },
        { select: ["variant_id", "images"], take: ids.length }
      ) as { variant_id: string; images: string[] | null }[]
      : []
    const firstImage = new Map<string, string>()
    for (const row of rows) {
      const image = imageUrl(row.images?.[0])
      if (image) firstImage.set(row.variant_id, image)
    }
    for (const card of cards) {
      const image = card.variantId ? firstImage.get(card.variantId) : undefined
      if (image) card.colourImage = image
    }
  }
  res.json({ cards })
}
