import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { readRecommendationSettings } from "../../../../lib/recommendation-settings"
import { readStorefrontPresentation } from "../../../../lib/read-storefront-presentation"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getFeatureBlocks, getFeaturedPicks } from "../../../../modules/content/config"

/**
 * GET /store/content/product-sections - the admin-managed bands the product
 * page renders below the gallery: the "Features" blocks and the hand-picked
 * "We think you'll love" designs (as bare handles the storefront resolves).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const [blocks, picks, { settings: recommendationDefaults }, { settings }] = await Promise.all([
    getFeatureBlocks(service),
    getFeaturedPicks(service),
    readRecommendationSettings(req.scope),
    readStorefrontPresentation(req.scope),
  ])

  res.json({
    recommendationDefaults,
    delivery: settings.delivery,
    buyBox: settings.buy_box,
    featureBlocks: blocks
      .filter((b: any) => b.is_visible)
      .map((b: any) => ({
        id: b.id,
        case_type: b.case_type ?? null,
        title: b.title,
        description: b.description,
        image_url: b.image_url,
        video_url: b.video_url,
      })),
    featuredPicks: picks
      .filter((p: any) => p.is_visible)
      .map((p: any) => p.handle),
  })
}
