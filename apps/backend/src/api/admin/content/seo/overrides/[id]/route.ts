import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../../modules/content"
import { getSeoConfig } from "../../../../../../modules/content/config"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const body = (req.body ?? {}) as Record<string, any>
  const patch: Record<string, unknown> = { id: req.params.id }
  for (const key of ["title", "description", "fit_copy"]) {
    if (typeof body[key] === "string") patch[key] = body[key].trim() || null
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active
  await service.updateSeoOverrides(patch)
  res.json(await getSeoConfig(service))
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  await service.deleteSeoOverrides(req.params.id)
  res.json(await getSeoConfig(service))
}
