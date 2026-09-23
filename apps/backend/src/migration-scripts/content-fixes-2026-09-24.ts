import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import { BUG_LIFE_DECOR, LEGACY_BUG_LIFE_DECOR_PREFIX } from "../modules/content/site-images"

/**
 * Two small corrections found by the live review of the September 2026 home
 * and collection rebuild. Both touch only values that upgrade seeded, so an
 * owner's own edits are left alone:
 *
 *   - Bug Life's hero decor moves from r2.dev URLs to the storefront's own
 *     /decor/bug-life/ files (one HTTP/2 origin instead of seven HTTP/1.1
 *     connections).
 *   - The home hero's Bug Life slide drops its "Bug Life" headline: the photo
 *     already carries the wordmark, and the overlay sat on top of it.
 */
export default async function contentFixes20260924({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(CONTENT_MODULE)

  const pages: any[] = await service.listCollectionPages({ collection_slug: "bug-life" })
  for (const page of pages) {
    const decor: unknown[] = Array.isArray(page.theme?.decor) ? page.theme.decor : []
    if (!decor.length || !decor.every((u) => typeof u === "string" && u.startsWith(LEGACY_BUG_LIFE_DECOR_PREFIX))) continue
    await service.updateCollectionPages({ id: page.id, theme: { ...page.theme, decor: BUG_LIFE_DECOR } })
    logger.info("[content-fixes] bug-life decor now served by the storefront")
  }

  const [hero] = await service.listHomeSections({ key: "hero" }, { take: 1 })
  const slides: any[] = Array.isArray(hero?.config?.slides) ? hero.config.slides : []
  let changed = false
  const next = slides.map((slide) => {
    if (String(slide?.href ?? "").startsWith("/collection/bug-life") && slide.heading === "Bug Life") {
      changed = true
      return { ...slide, heading: null }
    }
    return slide
  })
  if (changed) {
    await service.updateHomeSections({ id: hero.id, config: { ...hero.config, slides: next } })
    logger.info("[content-fixes] home Bug Life slide headline removed (the photo carries it)")
  }
}
