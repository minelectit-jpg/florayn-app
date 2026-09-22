import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../../../../modules/catalog"
import { readRecommendationSettings, RECOMMENDATION_KEY, validateRecommendationSettings } from "../../../../lib/recommendation-settings"

async function catalogChoices(container: any) {
  const catalog = container.resolve(CATALOG_MODULE)
  const [devices, caseTypes] = await Promise.all([
    catalog.listDevices({ is_active: true }, { order: { sort_order: "ASC" }, take: 1000 }),
    catalog.listCaseTypes({}, { relations: ["devices"], take: 1000 }),
  ])
  return { devices, caseTypes }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const [{ settings }, choices] = await Promise.all([readRecommendationSettings(req.scope), catalogChoices(req.scope)])
  res.json({ settings, ...choices })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const [{ store }, { devices, caseTypes }] = await Promise.all([readRecommendationSettings(req.scope), catalogChoices(req.scope)])
  if (!store) return res.status(409).json({ message: "Create the store before saving recommendations." })
  let settings
  try { settings = validateRecommendationSettings(req.body, devices, caseTypes) }
  catch (error: any) { return res.status(400).json({ message: error.message }) }
  await updateStoresWorkflow(req.scope).run({ input: {
    selector: { id: store.id },
    update: { metadata: { ...store.metadata, [RECOMMENDATION_KEY]: settings } },
  } })
  res.json({ settings })
}
