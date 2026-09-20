import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"

import { DESIGNS } from "../../../modules/catalog/data/designs"
import { CATALOG_MODULE } from "../../../modules/catalog"
import { CASE_TYPES } from "../../../modules/catalog/data/case-types"

const manifestBySlug = new Map(DESIGNS.map((design) => [design.slug, design]))

/**
 * GET /store/shop-catalog - the light list the shop grid needs: every live design
 * (one with products) with its case-type slugs and which forms it is sold in.
 *
 * This is deliberately product-LEVEL only (handle + metadata, no variants and no
 * calculated_price). Pulling variants/prices for the whole catalogue is what made
 * the shop take ~40s once every design went live; the storefront now builds each
 * card from this list and a page-sized product lookup. Uploaded designs use
 * their persisted card image URLs; legacy designs retain their manifest data.
 * This endpoint never computes per-variant prices.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule = req.scope.resolve(Modules.PRODUCT)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const [products, caseTypes] = await Promise.all([
    productModule.listProducts({ status: ProductStatus.PUBLISHED }, { select: ["handle", "title", "metadata"], take: 10000 }),
    catalog.listCaseTypes({}, { select: ["slug", "name"], take: 1000 }),
  ])
  const knownCaseTypes = [...CASE_TYPES, ...caseTypes]
  const slugByName = new Map<string, string>(knownCaseTypes.map((caseType: any) => [caseType.name, caseType.slug]))
  const validSlugs = new Set<string>(knownCaseTypes.map((caseType: any) => caseType.slug))

  const bySlug = new Map<
    string,
    { slug: string; name: string; caseTypes: string[]; forms: string[] }
  >()

  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, any>
    const slug = typeof meta.design_slug === "string" ? meta.design_slug.trim() : ""
    if (!slug) continue
    const manifest = manifestBySlug.get(slug)
    const savedSlugs = Array.isArray(meta.case_type_slugs) ? meta.case_type_slugs : []
    const cardNames = Array.isArray(meta.card?.caseTypes) ? meta.card.caseTypes : []
    const productCaseTypes = [...new Set<string>([
      ...(manifest?.case_types ?? []),
      ...savedSlugs.filter((value: unknown): value is string => typeof value === "string" && validSlugs.has(value)),
      ...cardNames.flatMap((name: unknown) => typeof name === "string" && slugByName.has(name) ? [slugByName.get(name)!] : []),
    ])]
    // A regular product without design compatibility metadata is not a case.
    if (!productCaseTypes.length) continue

    let entry = bySlug.get(slug)
    if (!entry) {
      entry = {
        slug,
        name: typeof meta.design_name === "string" && meta.design_name.trim()
          ? meta.design_name
          : manifest?.name ?? p.title ?? slug,
        caseTypes: [],
        forms: [],
      }
      bySlug.set(slug, entry)
    }
    for (const caseType of productCaseTypes) {
      if (!entry.caseTypes.includes(caseType)) entry.caseTypes.push(caseType)
    }
    const form = typeof meta.form === "string" ? meta.form : "phone"
    if (!entry.forms.includes(form)) entry.forms.push(form)
  }

  res.json({ designs: [...bySlug.values()] })
}
