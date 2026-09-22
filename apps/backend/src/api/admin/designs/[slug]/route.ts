import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { getDesignDetail } from "../../../../lib/design-admin"
import { editDesignMeta } from "../../../../lib/edit-design"

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
 * PATCH /admin/designs/:slug - edit a design's name / theme / publish status
 * across all its products. Never changes price, variants, or the slug/URL.
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { slug } = req.params
  if (!slug) {
    res.status(400).json({ message: "slug is required." })
    return
  }
  const body = (req.body ?? {}) as {
    name?: unknown
    theme?: unknown
    status?: unknown
    description?: unknown
  }
  const patch: { name?: string; theme?: string; description?: string; status?: "published" | "draft" } = {}
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200)) {
    res.status(400).json({ message: "Enter a product name within 200 characters." })
    return
  }
  if (typeof body.description === "string" && body.description.length <= 20000) patch.description = body.description
  if (typeof body.name === "string") patch.name = body.name
  if (typeof body.theme === "string") patch.theme = body.theme
  if (body.status === "published" || body.status === "draft") patch.status = body.status
  if (!Object.keys(patch).length) {
    res.status(400).json({ message: "Nothing to update." })
    return
  }

  try {
    if (patch.status === "published") {
      const detail = await getDesignDetail(req.scope, slug)
      if (!detail || detail.products.some((p) => !p.variants.length || p.variants.some((v) => v.price == null || !(v.images.length || p.images.length)))) {
        res.status(400).json({ message: "Every product needs variants with prices and images before publishing." })
        return
      }
    }
    const result = await editDesignMeta(req.scope, slug, patch)
    res.json(result)
  } catch (error: any) {
    req.scope.resolve("logger").error(`[edit-design ${slug}] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
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
      const byHandle = !p.metadata?.design_slug && p.handle === slug
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
