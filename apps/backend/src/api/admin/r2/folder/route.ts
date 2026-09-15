import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { asPrefix, createFolder } from "../../../../lib/r2"

/**
 * POST /admin/r2/folder - create an (empty) folder in R2 under a parent prefix.
 * Body: { parent?: string, name: string }.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { parent?: string; name?: string }
  const name = body.name?.trim()
  if (!name) {
    res.status(400).json({ message: "A folder name is required." })
    return
  }
  const prefix = `${asPrefix(body.parent)}${name}`
  try {
    const result = await createFolder(prefix)
    res.json({ ok: true, ...result })
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Could not create folder." })
  }
}
