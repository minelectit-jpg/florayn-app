import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { getDesignDetail } from "../../../../lib/design-admin"

/**
 * GET /admin/designs/:slug - one design's full shape (products, options and
 * variants) for the Design Manager editor.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { slug } = req.params
  if (!slug) {
    res.status(400).json({ message: "slug is required." })
    return
  }
  const detail = await getDesignDetail(req.scope, slug)
  if (!detail) {
    res.status(404).json({ message: `No design found for "${slug}".` })
    return
  }
  res.json({ design: detail })
}

/**
 * DELETE /admin/designs/:slug - remove a design from the store: delete every
 * product tied to it (phone case, AirPods, etc.). Uses productModule.deleteProducts
 * directly - deleteProductsWorkflow throws "Cannot delete product options that
 * are associated with products", the module method cascades cleanly. The shared
 * blank inventory is left alone (other designs may still use it).
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { slug } = req.params
  if (!slug) {
    res.status(400).json({ message: "slug is required." })
    return
  }
  const productModule = req.scope.resolve(Modules.PRODUCT)

  const all = await productModule.listProducts(
    {},
    { select: ["id", "handle", "metadata"], take: 10000 }
  )
  const ids = all
    .filter((p: any) => {
      const bySlug = (p.metadata as any)?.design_slug === slug
      const byHandle = p.handle === slug || p.handle?.startsWith(`${slug}-`)
      return bySlug || byHandle
    })
    .map((p: any) => p.id)

  if (!ids.length) {
    res.status(404).json({ message: `No products found for "${slug}".` })
    return
  }

  try {
    await productModule.deleteProducts(ids)
    res.json({ ok: true, deleted: ids.length })
  } catch (error: any) {
    const logger = req.scope.resolve("logger")
    logger.error(`[delete-design ${slug}] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
