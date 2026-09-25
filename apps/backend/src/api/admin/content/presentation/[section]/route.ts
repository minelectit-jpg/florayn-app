import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readStorefrontPresentation } from "../../../../../lib/read-storefront-presentation"
import { isPresentationSection, PRESENTATION_VALIDATORS, saveStorefrontPresentationWorkflow } from "../../../../../workflows/save-storefront-presentation"

/** GET/POST /admin/content/presentation/:section - footer, delivery or buy_box. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const section = req.params.section
  if (!isPresentationSection(section)) return res.status(404).json({ message: "Unknown section." })
  const { settings } = await readStorefrontPresentation(req.scope)
  res.json({ settings: settings[section] })
}
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const section = req.params.section
  if (!isPresentationSection(section)) return res.status(404).json({ message: "Unknown section." })
  let settings
  try {
    const body = req.body as { settings?: unknown } | undefined
    settings = PRESENTATION_VALIDATORS[section](body?.settings)
  }
  catch (error: any) { return res.status(400).json({ message: error.message }) }
  await saveStorefrontPresentationWorkflow(req.scope).run({ input: { section, settings } })
  res.json({ settings })
}
