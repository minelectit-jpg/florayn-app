import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"

function list(service: any) {
  return service.listFeaturedPicks({}, { order: { position: "ASC" } })
}

/** GET /admin/content/featured-picks - the "We think you'll love" picks. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  res.json({ picks: await list(service) })
}

/**
 * POST /admin/content/featured-picks - add a design (by its product handle) to
 * the end of the list. A handle already picked is left as-is.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const handle =
    typeof (req.body as any)?.handle === "string"
      ? (req.body as any).handle.trim()
      : ""
  if (!handle) {
    return res.status(400).json({ message: "handle is required." })
  }

  const existing = await service.listFeaturedPicks({})
  if (!existing.some((p: any) => p.handle === handle)) {
    const position = existing.length
      ? Math.max(...existing.map((p: any) => p.position ?? 0)) + 1
      : 0
    await service.createFeaturedPicks({ handle, position, is_visible: true })
  }

  res.json({ picks: await list(service) })
}
