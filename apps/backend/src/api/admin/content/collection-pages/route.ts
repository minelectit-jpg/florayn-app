import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getCollectionPages } from "../../../../modules/content/config"

/**
 * GET /admin/content/collection-pages
 *
 * Every landing page, hidden ones included, plus the designs each collection
 * actually contains - so the editor can offer a real list to order rather than
 * asking whoever is editing to remember slugs.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const pages = await getCollectionPages(service)

  const products = await productModule.listProducts(
    {},
    { select: ["id", "metadata"], relations: ["collection"], take: 2000 }
  )

  // collection handle -> unique designs in it, in catalogue order.
  const designsBy: Record<string, { slug: string; name: string }[]> = {}
  const seen: Record<string, Set<string>> = {}
  for (const product of products) {
    const handle = product.collection?.handle
    const slug = product.metadata?.design_slug as string | undefined
    const name = (product.metadata?.design_name as string) ?? slug
    if (!handle || !slug) continue
    seen[handle] ??= new Set()
    if (seen[handle].has(slug)) continue
    seen[handle].add(slug)
    ;(designsBy[handle] ??= []).push({ slug, name })
  }
  for (const list of Object.values(designsBy)) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }

  res.json({ pages, designsByCollection: designsBy })
}
