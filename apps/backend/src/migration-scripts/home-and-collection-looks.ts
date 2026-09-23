import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import { DEFAULT_COLLECTION_PAGES } from "../modules/content/collection-pages"
import {
  AIRPODS_BANNER_SECTION,
  COLLECTION_GRID_SECTION,
  HERO_SLIDE_IMAGES,
  HOME_ITEM_IMAGES,
  NEWEST_SLIDE,
} from "../modules/content/defaults"

/**
 * One-off content upgrade for a store seeded before the home rebuild and the
 * collection templates (September 2026). Fresh databases get all of this from
 * the seeds; this brings an existing one level without trampling edits:
 *
 *   - home pills, tiles and hero slides get florayn.com's pictures where they
 *     have none (matched by label / link), and the newest-flagship slide leads
 *     the hero if it is missing;
 *   - the marquee gets a list of messages if it only has a title;
 *   - "Shop by collection" and the AirPods banner are added if absent;
 *   - a collection page that has never been styled gets its template, theme,
 *     imagery and banners; any field the owner already filled is left alone.
 *
 * Medusa records the script once it has run; the logic is idempotent anyway.
 */
export default async function upgradeHomeAndCollectionLooks({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(CONTENT_MODULE)

  const sections: any[] = await service.listHomeSections({}, { order: { position: "ASC" } })
  if (sections.length) {
    for (const section of sections) {
      const config = { ...(section.config ?? {}) }
      let changed = false

      if (section.type === "category_pills" || section.type === "tile_grid") {
        const listKey = section.type === "category_pills" ? "items" : "tiles"
        const pictures = HOME_ITEM_IMAGES[section.type]
        config[listKey] = (config[listKey] ?? []).map((item: any) => {
          const picture = pictures[String(item?.label ?? "").trim().toLowerCase()]
          if (item?.image || !picture) return item
          changed = true
          return { ...item, image: picture }
        })
      }

      if (section.type === "hero") {
        const slides = (config.slides ?? []).map((s: any) => {
          const art = HERO_SLIDE_IMAGES.find((a) => String(s?.href ?? "").startsWith(a.match))
          if (!art || (s.image && s.mobile_image)) return s
          changed = true
          return { ...s, image: s.image || art.image, mobile_image: s.mobile_image || art.mobile_image }
        })
        if (!slides.some((s: any) => s?.heading === NEWEST_SLIDE.heading)) {
          slides.unshift(NEWEST_SLIDE)
          changed = true
        }
        config.slides = slides
      }

      if (section.type === "marquee" && !(config.items ?? []).length) {
        config.items = [section.title || "3 To 5 Days Delivery", "Cash On Delivery Across Bangladesh"]
        changed = true
      }

      if (changed) await service.updateHomeSections({ id: section.id, config })
    }

    const keys = new Set(sections.map((s) => s.key))
    const order = sections.map((s) => s.id)
    const add = async (row: Record<string, unknown>, at: number) => {
      const created = await service.createHomeSections({ ...row, position: at })
      order.splice(at, 0, Array.isArray(created) ? created[0].id : created.id)
    }
    if (!keys.has(COLLECTION_GRID_SECTION.key)) {
      const after = sections.findIndex((s) => s.type === "product_carousel")
      await add(COLLECTION_GRID_SECTION, after >= 0 ? after + 1 : order.length)
    }
    if (!keys.has(AIRPODS_BANNER_SECTION.key)) {
      const before = order.findIndex((id) => sections.find((s) => s.id === id)?.type === "testimonials")
      await add(AIRPODS_BANNER_SECTION, before >= 0 ? before : order.length)
    }
    for (const [position, id] of order.entries()) {
      await service.updateHomeSections({ id, position })
    }
    logger.info(`[content-upgrade] home: ${sections.length} sections checked, ${order.length} now`)
  }

  const pages: any[] = await service.listCollectionPages({})
  let styled = 0
  for (const page of pages) {
    const seed = DEFAULT_COLLECTION_PAGES.find((p) => p.collection_slug === page.collection_slug)
    if (!seed) continue
    const patch: Record<string, unknown> = {}
    if (!page.theme && seed.theme) {
      patch.theme = seed.theme
      patch.template = seed.template ?? "overlay"
    }
    for (const field of ["hero_image_url", "hero_mobile_image_url", "card_image_url", "hero_copy"] as const) {
      if (!page[field] && seed[field]) patch[field] = seed[field]
    }
    if (!(page.blocks ?? []).length && seed.blocks?.length) patch.blocks = seed.blocks
    if (Object.keys(patch).length) {
      await service.updateCollectionPages({ id: page.id, ...patch })
      styled++
    }
  }
  logger.info(`[content-upgrade] collection pages: ${styled} of ${pages.length} updated`)
}
