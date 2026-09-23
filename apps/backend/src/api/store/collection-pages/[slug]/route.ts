import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getCollectionPages, shapeCollectionPage } from "../../../../modules/content/config"

/**
 * GET /store/collection-pages/:slug - the landing content for one collection.
 * 404 when there is none, or when it is switched off in the admin.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const pages = await getCollectionPages(service)
  const found = pages.find(
    (p: any) => p.collection_slug === req.params.slug && p.is_visible
  )

  if (!found) {
    return res.status(404).json({ message: "No landing page for that collection" })
  }

  const page = shapeCollectionPage(found)
  res.json({
    page: {
      collection_slug: page.collection_slug,
      title: page.title ?? null,
      template: page.template,
      theme: page.theme,
      hero_image_url: page.hero_image_url,
      hero_mobile_image_url: page.hero_mobile_image_url ?? null,
      hero_eyebrow: page.hero_eyebrow,
      hero_heading: page.hero_heading,
      hero_copy: page.hero_copy ?? null,
      cta_label: page.cta_label,
      cta_href: page.cta_href,
      intro_heading: page.intro_heading,
      intro_copy: page.intro_copy,
      design_slugs: page.design_slugs,
      blocks: page.blocks,
    },
  })
}
