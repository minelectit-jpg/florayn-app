import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import { getSeoConfig } from "../../../../../modules/content/config"

/** POST /admin/content/seo/overrides - add an override for a design or device. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const scope = body.scope === "device" ? "device" : "design"
  const key = String(body.key ?? "").trim()

  if (!key) return res.status(400).json({ message: "key is required" })

  await service.createSeoOverrides({
    scope,
    key,
    title: body.title?.trim() || null,
    description: body.description?.trim() || null,
    fit_copy: body.fit_copy?.trim() || null,
    is_active: true,
  })
  res.json(await getSeoConfig(service))
}
