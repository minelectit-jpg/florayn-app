import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function imageUrl(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4096 && /^https?:\/\//i.test(value) ? value : null
}

/** A page-sized projection of saved cards: no prices or other device matrices. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { handles: rawHandles, device, case_type: caseType } = req.query
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
  const cards = products.map((product) => {
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
  res.json({ cards })
}
