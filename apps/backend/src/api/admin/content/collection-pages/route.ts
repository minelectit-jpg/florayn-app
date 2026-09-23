import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getCollectionPages, shapeCollectionPage } from "../../../../modules/content/config"
import {
  HERO_LAYOUTS,
  TEMPLATE_PRESETS,
  normaliseBlocks,
  normaliseTheme,
  presetById,
} from "../../../../modules/content/collection-templates"

type Target = { handle: string; title: string; kind: "collection" | "category" }

/** Every Medusa collection and category a landing page could be served for. */
async function landingTargets(scope: MedusaRequest["scope"]): Promise<Target[]> {
  const productModule: any = scope.resolve(Modules.PRODUCT)
  const [collections, categories] = await Promise.all([
    productModule.listProductCollections({}, { select: ["id", "handle", "title"], take: 500 }),
    productModule.listProductCategories({}, { select: ["id", "handle", "name"], take: 500 }),
  ])
  const seen = new Set<string>()
  const targets: Target[] = []
  for (const c of collections ?? []) {
    if (!c.handle || seen.has(c.handle)) continue
    seen.add(c.handle)
    targets.push({ handle: c.handle, title: c.title ?? c.handle, kind: "collection" })
  }
  // A collection shadows a category of the same handle on the storefront.
  for (const c of categories ?? []) {
    if (!c.handle || seen.has(c.handle)) continue
    seen.add(c.handle)
    targets.push({ handle: c.handle, title: c.name ?? c.handle, kind: "category" })
  }
  return targets
}

/**
 * GET /admin/content/collection-pages
 *
 * Every landing page, hidden ones included, plus what the editor needs to
 * offer real choices rather than free text: the designs each collection
 * contains, the collections/categories that could get a page, and the
 * template presets.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const [pages, products, targets] = await Promise.all([
    getCollectionPages(service),
    productModule.listProducts(
      {},
      { select: ["id", "metadata"], relations: ["collection"], take: 2000 }
    ),
    landingTargets(req.scope),
  ])

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

  res.json({
    pages: pages.map(shapeCollectionPage),
    designsByCollection: designsBy,
    targets,
    presets: TEMPLATE_PRESETS,
    layouts: HERO_LAYOUTS,
    storefrontUrl: (process.env.STOREFRONT_URL ?? "").replace(/\/+$/, ""),
  })
}

/**
 * Swap the source collection's name and URL for the new one's. Copy often
 * shortens a name ("Van Gogh AirPods Cases" for Van Gogh Dreams), so the name
 * minus its last word is tried too when that still leaves two words.
 */
function retarget(value: unknown, from: { slug: string; title: string }, to: { slug: string; title: string }) {
  if (typeof value !== "string" || !value) return value ?? null
  const next = value.split(`/collection/${from.slug}/`).join(`/collection/${to.slug}/`)
  const words = from.title.trim().split(/\s+/).filter(Boolean)
  const names = [words.join(" ")]
  if (words.length >= 3) names.push(words.slice(0, -1).join(" "))
  for (const name of names) {
    if (!name) continue
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
    if (pattern.test(next)) return next.replace(pattern, to.title)
  }
  return next
}

/**
 * POST /admin/content/collection-pages
 *
 *   { order: string[] }                                   reorder (card order)
 *   { action: "create", collection_slug, preset? }        new page from a template
 *   { action: "duplicate", id, collection_slug }          copy a page's design + content
 *
 * The slug must be a Medusa collection or category without a page yet - the
 * storefront has nothing to show for any other URL. New pages start hidden.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const pages = await getCollectionPages(service)

  if (Array.isArray(body.order)) {
    for (const [position, id] of body.order.entries()) {
      if (typeof id === "string") await service.updateCollectionPages({ id, position })
    }
    return res.json({ pages: (await getCollectionPages(service)).map(shapeCollectionPage) })
  }

  if (body.action !== "create" && body.action !== "duplicate") {
    return res.status(400).json({ message: "Unknown action." })
  }

  const slug = typeof body.collection_slug === "string" ? body.collection_slug.trim() : ""
  const targets = await landingTargets(req.scope)
  const target = targets.find((t) => t.handle === slug)
  if (!target) {
    return res.status(400).json({ message: "Choose a collection or category that exists in the store." })
  }
  if (pages.some((p: any) => p.collection_slug === slug)) {
    return res.status(400).json({ message: `/collection/${slug}/ already has a page - edit that one.` })
  }
  const position = pages.length

  let row: Record<string, unknown>
  if (body.action === "create") {
    const preset = presetById(body.preset) ?? TEMPLATE_PRESETS[0]
    row = {
      collection_slug: slug,
      title: null,
      template: preset.template,
      theme: preset.theme,
      hero_eyebrow: "Meet The New",
      hero_heading: target.title,
      hero_copy: null,
      cta_label: "Shop Now",
      cta_href: `/collection/${slug}/`,
      intro_heading: `${target.title} Phone Cases`,
      intro_copy: null,
      blocks: [],
    }
  } else {
    const source = pages.find((p: any) => p.id === body.id)
    if (!source) return res.status(404).json({ message: "Page to copy not found." })
    const from = {
      slug: source.collection_slug,
      title: source.title || targets.find((t) => t.handle === source.collection_slug)?.title || "",
    }
    const to = { slug, title: target.title }
    row = {
      collection_slug: slug,
      title: null,
      template: source.template ?? "overlay",
      theme: normaliseTheme(source.theme),
      hero_image_url: source.hero_image_url,
      hero_mobile_image_url: source.hero_mobile_image_url,
      hero_eyebrow: retarget(source.hero_eyebrow, from, to),
      hero_heading: retarget(source.hero_heading, from, to),
      hero_copy: retarget(source.hero_copy, from, to),
      card_image_url: null,
      cta_label: retarget(source.cta_label, from, to),
      cta_href: retarget(source.cta_href, from, to),
      intro_heading: retarget(source.intro_heading, from, to),
      intro_copy: retarget(source.intro_copy, from, to),
      blocks: normaliseBlocks(source.blocks).map((block) =>
        block.type === "banner"
          ? {
              ...block,
              heading: retarget(block.heading, from, to),
              copy: retarget(block.copy, from, to),
              cta_href: retarget(block.cta_href, from, to),
            }
          : { ...block, heading: retarget(block.heading, from, to), copy: retarget(block.copy, from, to) }
      ),
    }
  }

  const created = await service.createCollectionPages({
    ...row,
    // A copied page keeps the look; designs belong to the source collection.
    design_slugs: [],
    is_visible: false,
    position,
  })
  const createdId = Array.isArray(created) ? created[0].id : created.id
  res.json({ pages: (await getCollectionPages(service)).map(shapeCollectionPage), created_id: createdId })
}
