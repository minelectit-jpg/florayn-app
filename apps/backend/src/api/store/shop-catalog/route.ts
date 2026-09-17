import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { DESIGNS } from "../../../modules/catalog/data/designs"

/**
 * GET /store/shop-catalog - the light list the shop grid needs: every live design
 * (one with products) with its case-type slugs and which forms it is sold in.
 *
 * This is deliberately product-LEVEL only (handle + metadata, no variants and no
 * calculated_price). Pulling variants/prices for the whole catalogue is what made
 * the shop take ~40s once every design went live; the storefront now builds each
 * card from this list plus the fixed case-type price and a constructed image URL,
 * so no per-variant price is ever computed for a grid.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule = req.scope.resolve(Modules.PRODUCT)

  const products = await productModule.listProducts(
    {},
    { select: ["handle", "metadata"], take: 10000 }
  )

  const bySlug = new Map<
    string,
    { slug: string; name: string; caseTypes: string[]; forms: string[] }
  >()

  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, any>
    const slug = meta.design_slug as string | undefined
    if (!slug) continue
    const manifest = DESIGNS.find((d) => d.slug === slug)
    if (!manifest) continue

    let entry = bySlug.get(slug)
    if (!entry) {
      entry = {
        slug,
        name: (meta.design_name as string) ?? manifest.name,
        caseTypes: manifest.case_types,
        forms: [],
      }
      bySlug.set(slug, entry)
    }
    const form = (meta.form as string) ?? "phone"
    if (!entry.forms.includes(form)) entry.forms.push(form)
  }

  res.json({ designs: [...bySlug.values()] })
}
