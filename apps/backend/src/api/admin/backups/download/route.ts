import fs from "node:fs"
import path from "node:path"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { backupDir, safeName } from "../../../../lib/backup/files"

export const AUTHENTICATE = true

/** GET /admin/backups/download?name= - an encrypted backup file, for a copy on a USB stick (BACKUP.md). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const name = safeName(req.query.name)
  const file = name ? path.join(backupDir(), name) : null
  if (!name || !file || !fs.existsSync(file)) return res.status(404).json({ message: "That backup is no longer on the server; Google Drive keeps the older ones." })
  res.setHeader("Content-Type", "application/octet-stream")
  res.setHeader("Content-Length", String(fs.statSync(file).size))
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res)
}
