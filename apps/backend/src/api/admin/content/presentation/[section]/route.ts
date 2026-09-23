import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readStorefrontPresentation } from "../../../../../lib/read-storefront-presentation"
import { validateFooterPresentation, validateDeliveryPresentation } from "../../../../../lib/storefront-presentation"
import { saveStorefrontPresentationWorkflow } from "../../../../../workflows/save-storefront-presentation"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const section = req.params.section
  if (section !== "footer" && section !== "delivery") return res.status(404).json({ message: "Unknown section." })
  const { settings } = await readStorefrontPresentation(req.scope)
  res.json({ settings: settings[section] })
}
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const section = req.params.section
  if (section !== "footer" && section !== "delivery") return res.status(404).json({ message: "Unknown section." })
  let settings
  try {
    const body = req.body as { settings?: unknown } | undefined
    settings = section === "footer" ? validateFooterPresentation(body?.settings) : validateDeliveryPresentation(body?.settings)
  }
  catch (error: any) { return res.status(400).json({ message: error.message }) }
  await saveStorefrontPresentationWorkflow(req.scope).run({ input: { section, settings } })
  res.json({ settings })
}
