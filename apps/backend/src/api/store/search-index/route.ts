import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"

import { sortNewestFirst } from "../../../lib/device-order"
import { readStorefrontPresentation } from "../../../lib/read-storefront-presentation"
import { buildSearchIndex } from "../../../lib/search-index"
import { DEFAULT_IMAGE_BASE_URL } from "../../../lib/wire-images-device"
import { CATALOG_MODULE } from "../../../modules/catalog"
import { CASE_TYPES } from "../../../modules/catalog/data/case-types"
import { DESIGNS } from "../../../modules/catalog/data/designs"
import { CONTENT_MODULE } from "../../../modules/content"
import { getCollectionCards, MEN_MENU } from "../../../modules/content/config"

const designCaseTypes = new Map(DESIGNS.map((design) => [design.slug, design.case_types]))
const seedGroupsBySlug = new Map(CASE_TYPES.map((c) => [c.slug, c.price_groups ?? null]))

/**
 * GET /store/search-index - the whole catalogue as one small search index
 * (lib/search-index.ts), for the storefront's /search-index.json. That route
 * does the long edge caching; this one only asks for a minute.
 *
 * The same product-level read /store/shop-catalog pays (handle, title,
 * thumbnail, collection and metadata; no variants, no prices), plus devices,
 * case types, collection pages, the header's link sections and Admin > Search.
 * Any failed read fails the whole response: a partial index would be cached
 * and hide designs.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const content: any = req.scope.resolve(CONTENT_MODULE)
  const knex: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const [products, devices, caseTypes, collections, menuSections, { settings }] = await Promise.all([
      productModule.listProducts(
        { status: ProductStatus.PUBLISHED },
        { select: ["handle", "title", "thumbnail", "collection_id", "metadata"], order: { created_at: "DESC" }, take: 10000 },
      ),
      catalog.listDevices({ is_active: true }, { order: { sort_order: "ASC" } }),
      catalog.listCaseTypes({ is_active: true }, { order: { sort_order: "ASC" }, relations: ["devices"] }),
      getCollectionCards(content, productModule, knex),
      content.listMenuSections({ menu: ["primary", MEN_MENU] }, { order: { position: "ASC" } }),
      readStorefrontPresentation(req.scope),
    ])

    const index = buildSearchIndex({
      img: (process.env.IMAGE_BASE_URL || process.env.R2_PUBLIC_URL || DEFAULT_IMAGE_BASE_URL).trim().replace(/\/+$/, ""),
      products,
      devices: sortNewestFirst(devices, (d: any) => d.name, (d: any) => d.family),
      // Unsaved per-device prices fall back to the seed's, as variants are priced.
      caseTypes: caseTypes.map((c: any) => ({ ...c, price_groups: c.price_groups ?? seedGroupsBySlug.get(c.slug) ?? null })),
      collections,
      menus: {
        women: menuSections.filter((s: any) => s.menu === "primary"),
        men: menuSections.filter((s: any) => s.menu === MEN_MENU),
      },
      search: settings.search,
      caseTypeNames: CASE_TYPES,
      designCaseTypes,
    })

    res.setHeader("Cache-Control", "public, max-age=60")
    res.json(index)
  } catch (error: any) {
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`[search-index] ${error?.message ?? error}`)
    res.setHeader("Cache-Control", "no-store")
    res.status(500).json({ message: "Could not build the search index." })
  }
}
