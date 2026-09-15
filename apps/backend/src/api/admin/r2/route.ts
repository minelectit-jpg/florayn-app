import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { deleteObject, deletePrefix, listPrefix } from "../../../lib/r2"

/**
 * GET  /admin/r2?prefix=foo/bar   -> folders + files directly under that prefix.
 * DELETE /admin/r2?target=...&type=file|folder -> remove one file, or a whole
 * folder (recursive). The File Manager's window onto the R2 media bucket.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const prefix = (req.query.prefix as string | undefined) ?? ""
    const listing = await listPrefix(prefix)
    res.json(listing)
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Could not list R2." })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const target = (req.query.target as string | undefined)?.trim()
  const type = (req.query.type as string | undefined) ?? "file"
  if (!target) {
    res.status(400).json({ message: "target is required." })
    return
  }
  try {
    const result =
      type === "folder" ? await deletePrefix(target) : await deleteObject(target)
    res.json({ ok: true, ...result })
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Delete failed." })
  }
}
