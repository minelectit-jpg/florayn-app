import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/** One product's imagery, grouped by device. */
async function readProduct(scope: any, productId: string) {
  const productModule: any = scope.resolve(Modules.PRODUCT)
  const [product] = await productModule.listProducts(
    { id: productId },
    { select: ["id", "handle", "title", "thumbnail", "metadata"], relations: ["variants"] }
  )
  if (!product) return null

  const devices = (product.variants ?? [])
    .map((v: any) => ({
      variant_id: v.id,
      device: v.title,
      device_slug: (v.metadata?.device_slug as string) ?? null,
      images: ((v.metadata?.images as string[]) ?? []),
    }))
    .sort((a: any, b: any) => a.device.localeCompare(b.device))

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    thumbnail: product.thumbnail,
    design: product.metadata?.design_name ?? null,
    case_type: product.metadata?.case_type_name ?? null,
    devices,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product = await readProduct(req.scope, req.params.productId)
  if (!product) return res.status(404).json({ message: "Product not found" })
  res.json({ product })
}

/**
 * POST /admin/media/:productId
 *
 * Body: { variant_id, images: string[] }
 *
 * Replaces one device's gallery. The order of `images` is the order shown, so
 * this covers replacing a shot, adding one for a device that had none, and
 * reordering - all with the same call.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const body = (req.body ?? {}) as Record<string, unknown>
  const variantId = String(body.variant_id ?? "").trim()

  if (!variantId) {
    return res.status(400).json({ message: "variant_id is required" })
  }
  if (!Array.isArray(body.images)) {
    return res.status(400).json({ message: "images must be a list of URLs" })
  }

  const images = (body.images as unknown[])
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((u) => u.trim())

  const bad = images.filter((u) => !/^https?:\/\//i.test(u))
  if (bad.length) {
    return res
      .status(400)
      .json({ message: `Not a URL: ${bad.slice(0, 3).join(", ")}` })
  }

  const [variant] = await productModule.listProductVariants({ id: variantId })
  if (!variant) return res.status(404).json({ message: "Variant not found" })

  await productModule.updateProductVariants(variantId, {
    metadata: { ...(variant.metadata ?? {}), images },
  })

  // Keep the product gallery in step so the admin product page matches.
  const product = await readProduct(req.scope, req.params.productId)
  const unique = [...new Set(product!.devices.flatMap((d: any) => d.images))]
  await productModule.updateProducts(req.params.productId, {
    images: unique.map((url) => ({ url })),
    ...(unique.length ? { thumbnail: unique[0] } : {}),
  })

  res.json({ product: await readProduct(req.scope, req.params.productId) })
}
