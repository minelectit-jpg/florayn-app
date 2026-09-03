import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { getSeoConfig } from "../../../../modules/content/config"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  res.json(await getSeoConfig(service))
}

/** POST /admin/content/seo - edit the templates. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const { settings } = await getSeoConfig(service)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: settings.id }

  for (const key of [
    "title_template",
    "description_template",
    "heading_template",
  ]) {
    if (typeof body[key] === "string" && body[key].trim()) {
      patch[key] = (body[key] as string).trim()
    }
  }
  if (typeof body.fit_copy_enabled === "boolean") {
    patch.fit_copy_enabled = body.fit_copy_enabled
  }

  await service.updateSeoSettings(patch)
  res.json(await getSeoConfig(service))
}
