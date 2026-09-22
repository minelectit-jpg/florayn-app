import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { manualRecommendationRows, readManualRecommendations } from "../../../../../lib/manual-recommendations"
import { saveManualRecommendationsWorkflow } from "../../../../../workflows/save-manual-recommendations"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product = await req.scope.resolve(Modules.PRODUCT).retrieveProduct(req.params.id, { select: ["id", "metadata"] })
  const settings = readManualRecommendations(product.metadata)
  const choices = await manualRecommendationRows(req.scope, [...settings.recommended, ...settings.featured])
  res.json({ settings, choices })
}
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await saveManualRecommendationsWorkflow(req.scope).run({ input: { productId: req.params.id, settings: req.body } })
  await GET(req, res)
}
