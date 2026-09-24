import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { getImportSettings, outdatedImports, presentImport, previewFloraynImport, runFloraynImport } from "../../../lib/florayn-import"
import { opsService } from "../../../lib/order-ops"

/**
 * GET /admin/florayn-import - the saved key (masked), the last run's progress,
 * and how many imported orders an older version of the import made (the next
 * run rebuilds them).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const [settings, outdated] = await Promise.all([getImportSettings(req.scope), outdatedImports(req.scope)])
  res.json({ import: { ...presentImport(settings), outdated } })
}

/**
 * POST /admin/florayn-import
 *   { action: "save", site_url?, consumer_key?, consumer_secret? }  blank keeps the saved value
 *   { action: "preview" }  the newest five orders as they would be imported (writes nothing)
 *   { action: "run" }      import every order in the background; poll GET for progress
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const settings = await getImportSettings(req.scope)

  if (body.action === "save") {
    const patch: Record<string, unknown> = { id: settings.id }
    const errors: Record<string, string> = {}
    if (typeof body.site_url === "string" && body.site_url.trim()) {
      const site = body.site_url.trim().replace(/\/+$/, "")
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(site)) errors.site_url = "Use the shop's https:// address, e.g. https://florayn.com"
      else patch.site_url = site
    }
    if (typeof body.consumer_key === "string" && body.consumer_key.trim()) {
      if (!/^ck_[A-Za-z0-9]{20,64}$/.test(body.consumer_key.trim())) errors.consumer_key = "The consumer key starts with ck_"
      else patch.consumer_key = body.consumer_key.trim()
    }
    if (typeof body.consumer_secret === "string" && body.consumer_secret.trim()) {
      if (!/^cs_[A-Za-z0-9]{20,64}$/.test(body.consumer_secret.trim())) errors.consumer_secret = "The consumer secret starts with cs_"
      else patch.consumer_secret = body.consumer_secret.trim()
    }
    if (Object.keys(errors).length) { res.status(400).json({ message: "Check the highlighted fields.", errors }); return }
    await opsService(req.scope).updateOrderImports(patch)
    res.json({ import: presentImport(await getImportSettings(req.scope)) })
    return
  }

  if (body.action === "preview") {
    try { res.json(await previewFloraynImport(req.scope)) }
    catch (error: any) { res.status(400).json({ message: String(error?.message ?? error) }) }
    return
  }

  if (body.action === "run") {
    const current = presentImport(settings)
    if (!current.ready) { res.status(400).json({ message: "Save the WooCommerce key first." }); return }
    if (current.state === "running") { res.status(409).json({ message: "An import is already running." }); return }
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    // Runs past this response; the admin polls GET for progress.
    void runFloraynImport(req.scope).catch((error) => logger.error(`[florayn-import] ${error?.message ?? error}`))
    res.status(202).json({ import: { ...current, state: "running" } })
    return
  }

  res.status(400).json({ message: "Choose save, preview or run." })
}
