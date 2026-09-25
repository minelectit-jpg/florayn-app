import { DEFAULT_COLLECTION_PAGES } from "./collection-pages"
import { normaliseBlocks, normaliseTemplate, normaliseTheme } from "./collection-templates"
import {
  DEFAULT_FEATURE_BLOCKS,
  DEFAULT_HOME_SECTIONS,
  DEFAULT_MEN_HOME_SECTIONS,
  DEFAULT_MENU,
  FOOTER_NOTE,
  SOCIAL_LINKS,
} from "./defaults"

/**
 * Reading the site content, seeding it from the live site's structure the
 * first time it is asked for. Same pattern as the bundles module: a fresh
 * database serves a complete home page and menu immediately, and everything
 * is editable in the admin from then on.
 */
export async function getContent(service: any) {
  let sections = await service.listHomeSections(
    {},
    { order: { position: "ASC" } }
  )

  if (!sections?.length) {
    await service.createHomeSections([...DEFAULT_HOME_SECTIONS, ...menHomeSections(DEFAULT_HOME_SECTIONS)] as any)
    sections = await service.listHomeSections({}, { order: { position: "ASC" } })
  }

  let menuSections = await service.listMenuSections(
    {},
    { order: { position: "ASC" } }
  )

  if (!menuSections?.length) {
    for (const [index, group] of DEFAULT_MENU.entries()) {
      const created = await service.createMenuSections({
        menu: group.menu,
        label: group.label,
        href: group.href,
        position: index,
        is_visible: true,
        kind: group.kind ?? "links",
        placement: group.placement ?? "all",
        config: group.config ?? null,
      })
      const sectionId = Array.isArray(created) ? created[0].id : created.id
      await service.createMenuItems(
        group.items.map((item, i) => ({
          section_id: sectionId,
          group: item.group ?? null,
          label: item.label,
          href: item.href,
          badge: item.badge ?? null,
          position: i,
          is_visible: true,
        }))
      )
    }
    menuSections = await service.listMenuSections(
      {},
      { order: { position: "ASC" } }
    )
  }

  const items = await service.listMenuItems({}, { order: { position: "ASC" } })

  return {
    sections,
    menuSections,
    items,
    footerNote: FOOTER_NOTE,
    social: SOCIAL_LINKS,
  }
}

/**
 * The Men home page to seed: its own sections, plus a copy of the Women
 * testimonials band (the same customers) at the end.
 */
export function menHomeSections(women: any[]): any[] {
  const quotes = women.find((s) => s.type === "testimonials")
  return [
    ...DEFAULT_MEN_HOME_SECTIONS,
    ...(quotes ? [{
      key: "men-testimonials", audience: "men", type: "testimonials", position: DEFAULT_MEN_HOME_SECTIONS.length,
      is_visible: quotes.is_visible ?? true, title: quotes.title ?? null, subtitle: quotes.subtitle ?? null,
      eyebrow: quotes.eyebrow ?? null, config: quotes.config ?? {},
    }] : []),
  ]
}

/** The Men header navigation's menu name; "primary" is the Women (root) one. */
export const MEN_MENU = "primary-men"

/**
 * Which modes each collection has published designs for, from one grouped SQL
 * read of product.metadata->>audience (no product metadata is loaded). A
 * product without a tag counts for both.
 */
export async function collectionAudiences(knex: any, collectionIds: string[]): Promise<Map<string, ("women" | "men")[]>> {
  const result = new Map<string, ("women" | "men")[]>()
  if (!knex || !collectionIds.length) return result
  const rows: { collection_id: string; audience: string | null }[] = await knex("product")
    .select("collection_id", knex.raw("metadata->>'audience' as audience"))
    .whereIn("collection_id", collectionIds)
    .andWhere("status", "published")
    .whereNull("deleted_at")
    .groupBy("collection_id", knex.raw("metadata->>'audience'"))
  for (const row of rows) {
    const modes = new Set(result.get(row.collection_id) ?? [])
    if (row.audience !== "men") modes.add("women")
    if (row.audience !== "women") modes.add("men")
    result.set(row.collection_id, (["women", "men"] as const).filter((m) => modes.has(m)))
  }
  return result
}

/**
 * Copy one menu (sections and links, visibility kept) into an empty one, e.g.
 * the Women header into the Men header as its starting point. Does nothing
 * and returns 0 when the target already has sections.
 */
export async function copyMenu(service: any, from: string, to: string): Promise<number> {
  const sections = await service.listMenuSections({}, { order: { position: "ASC" } })
  if (sections.some((s: any) => s.menu === to)) return 0
  const items = await service.listMenuItems({}, { order: { position: "ASC" } })
  let copied = 0
  for (const section of sections.filter((s: any) => s.menu === from)) {
    const created = await service.createMenuSections({
      menu: to, label: section.label, href: section.href, position: section.position, is_visible: section.is_visible,
      kind: section.kind ?? "links", image_url: section.image_url ?? null, badge: section.badge ?? null,
      placement: section.placement ?? "all", config: section.config ?? null,
    })
    const sectionId = Array.isArray(created) ? created[0].id : created.id
    const links = items.filter((i: any) => i.section_id === section.id)
    if (links.length) {
      await service.createMenuItems(links.map((i: any) => ({
        section_id: sectionId, group: i.group, label: i.label, href: i.href, badge: i.badge, position: i.position, is_visible: i.is_visible,
      })))
    }
    copied++
  }
  return copied
}

/**
 * Shapes the flat rows into the nested menu the storefront renders. Only a
 * links section carries groups; the automatic kinds (devices, case_types,
 * collections) fill themselves on the storefront from their config, and any
 * links they had before stay in the database unused.
 */
export function buildMenu(
  menuSections: any[],
  items: any[],
  menu: string,
  { visibleOnly = true } = {}
) {
  return menuSections
    .filter((s) => s.menu === menu && (!visibleOnly || s.is_visible))
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const kind = section.kind ?? "links"
      const own = kind !== "links" ? [] : items
        .filter(
          (i) => i.section_id === section.id && (!visibleOnly || i.is_visible)
        )
        .sort((a, b) => a.position - b.position)

      // Preserve the order groups first appear in, rather than sorting names.
      const groups: { heading: string | null; links: any[] }[] = []
      for (const item of own) {
        const heading = item.group || null
        let bucket = groups.find((g) => g.heading === heading)
        if (!bucket) {
          bucket = { heading, links: [] }
          groups.push(bucket)
        }
        bucket.links.push({
          id: item.id,
          label: item.label,
          href: item.href,
          badge: item.badge,
        })
      }

      return {
        id: section.id,
        label: section.label,
        href: section.href,
        kind,
        image: section.image_url ?? null,
        badge: section.badge ?? null,
        placement: section.placement ?? "all",
        config: kind === "links" ? null : section.config ?? null,
        groups,
      }
    })
}

/**
 * The collection landing pages, seeded on first read like the rest of the
 * content module. `cta_href` defaults to the collection's own URL.
 */
export async function getCollectionPages(service: any) {
  let pages = await service.listCollectionPages({}, { order: { position: "ASC" } })

  if (!pages?.length) {
    await service.createCollectionPages(
      DEFAULT_COLLECTION_PAGES.map((page, index) => ({
        ...page,
        title: page.title ?? null,
        template: page.template ?? "overlay",
        theme: page.theme ?? null,
        cta_href: page.cta_href ?? `/collection/${page.collection_slug}/`,
        hero_image_url: page.hero_image_url ?? null,
        hero_mobile_image_url: page.hero_mobile_image_url ?? null,
        hero_copy: page.hero_copy ?? null,
        card_image_url: page.card_image_url ?? null,
        blocks: page.blocks ?? [],
        design_slugs: [],
        is_visible: true,
        position: index,
      }))
    )
    pages = await service.listCollectionPages({}, { order: { position: "ASC" } })
  }

  return pages ?? []
}

/**
 * The visible landing pages as cards for "Shop by collection" and the
 * collections index: name, picture and colours. A page without a card image
 * falls back to its hero, then to one of the collection's own product renders.
 */
export async function getCollectionCards(service: any, productModule: any, knex?: any) {
  const pages = (await getCollectionPages(service))
    .filter((p: any) => p.is_visible)
    .map(shapeCollectionPage)
  if (!pages.length) return []

  const collections = await productModule.listProductCollections(
    { handle: pages.map((p: any) => p.collection_slug) },
    { select: ["id", "handle", "title"], take: pages.length }
  )
  const byHandle = new Map<string, any>((collections ?? []).map((c: any) => [c.handle, c]))

  const needArt = pages
    .filter((p: any) => !p.card_image_url && !p.hero_image_url)
    .map((p: any) => byHandle.get(p.collection_slug)?.id)
    .filter(Boolean)
  const artwork = new Map<string, string>()
  const audiences = await collectionAudiences(knex, (collections ?? []).map((c: any) => c.id)).catch(() => new Map())
  if (needArt.length) {
    const products = await productModule.listProducts(
      { collection_id: needArt },
      { select: ["id", "thumbnail", "collection_id", "metadata"], take: needArt.length * 40 }
    )
    for (const product of products ?? []) {
      if (!product.thumbnail || artwork.has(product.collection_id)) continue
      if ((product.metadata?.form ?? "phone") !== "phone") continue
      artwork.set(product.collection_id, product.thumbnail)
    }
  }

  return pages.map((page: any) => {
    const collection = byHandle.get(page.collection_slug)
    const image = page.card_image_url || page.hero_image_url || null
    return {
      slug: page.collection_slug,
      collection_id: collection?.id ?? null,
      title: page.title || collection?.title || page.hero_heading || page.collection_slug,
      image,
      /** A product render (white ground), shown contained rather than cropped. */
      artwork: image ? null : (collection ? artwork.get(collection.id) ?? null : null),
      /** Modes with designs in it; absent when unknown (the storefront then shows it in both). */
      ...(collection && audiences.has(collection.id) ? { audiences: audiences.get(collection.id) } : {}),
      /** "Show in menu": in the phone menu's Collections row, in this list's order. */
      in_menu: page.show_in_menu !== false,
      theme: {
        bg: page.theme.bg,
        text: page.theme.text,
        accent: page.theme.accent,
        accent_text: page.theme.accent_text,
        hero_bg: page.theme.hero_bg,
        hero_text: page.theme.hero_text,
      },
    }
  })
}

/** A page row with its look filled in: old rows predate template/theme/blocks. */
export function shapeCollectionPage(page: any) {
  return {
    ...page,
    template: normaliseTemplate(page.template),
    theme: normaliseTheme(page.theme),
    blocks: normaliseBlocks(page.blocks),
    design_slugs: Array.isArray(page.design_slugs) ? page.design_slugs : [],
  }
}

/**
 * The product page's "Features" blocks, seeded from the example set the first
 * time they are asked for. Ordered top to bottom; editable in the admin.
 */
export async function getFeatureBlocks(service: any) {
  let blocks = await service.listFeatureBlocks(
    {},
    { order: { position: "ASC" } }
  )

  if (!blocks?.length) {
    await service.createFeatureBlocks(DEFAULT_FEATURE_BLOCKS as any)
    blocks = await service.listFeatureBlocks({}, { order: { position: "ASC" } })
  }

  return blocks ?? []
}

/**
 * The hand-picked designs for "We think you'll love". Unseeded — an empty list
 * simply hides the band until the owner adds picks from the admin.
 */
export async function getFeaturedPicks(service: any) {
  const picks = await service.listFeaturedPicks(
    {},
    { order: { position: "ASC" } }
  )
  return picks ?? []
}

/**
 * Gallery videos, optionally for one design. Keyed by design + case type and
 * shared across devices.
 */
export async function getGalleryVideos(service: any, designSlug?: string) {
  const where = designSlug ? { design_slug: designSlug } : {}
  const videos = await service.listGalleryVideos(where)
  return videos ?? []
}

/** SEO templates and their overrides, seeded on first read. */
export async function getSeoConfig(service: any) {
  let [settings] = await service.listSeoSettings({}, { take: 1 })
  if (!settings) {
    settings = await service.createSeoSettings({})
  }
  const overrides = await service.listSeoOverrides({ is_active: true })
  return { settings, overrides: overrides ?? [] }
}
