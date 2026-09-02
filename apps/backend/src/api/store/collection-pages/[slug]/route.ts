import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getCollectionPages } from "../../../../modules/content/config"

/**
 * GET /store/collection-pages/:slug - the landing content for one collection.
 * 404 when there is none, or when it is switched off in the admin.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const pages = await getCollectionPages(service)
  const page = pages.find(
    (p: any) => p.collection_slug === req.params.slug && p.is_visible
  )

  if (!page) {
    return res.status(404).json({ message: "No landing page for that collection" })
  }

  res.json({
    page: {
      collection_slug: page.collection_slug,
      hero_image_url: page.hero_image_url,
      hero_eyebrow: page.hero_eyebrow,
      hero_heading: page.hero_heading,
      cta_label: page.cta_label,
      cta_href: page.cta_href,
      intro_heading: page.intro_heading,
      intro_copy: page.intro_copy,
      design_slugs: page.design_slugs ?? [],
    },
  })
}
