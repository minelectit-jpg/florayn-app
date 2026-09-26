// The storefront's /privacy/ page. The text is public only once published.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { readPrivacySettings } from "../../../modules/content/privacy-settings"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { title, body, published, updated_at } = await readPrivacySettings(req.scope)
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({ settings: { title, body: published ? body : "", published, updated_at } })
}
