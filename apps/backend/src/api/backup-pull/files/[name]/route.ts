import fs from "node:fs"
import path from "node:path"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { backupDir, safeName } from "../../../../lib/backup/files"
import { authorizePull } from "../../../../lib/backup/pull"

/** GET /backup-pull/files/:name - one encrypted backup file, for the Google Drive script (BACKUP.md). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(await authorizePull(req, res))) return
  const name = safeName(req.params.name)
  const file = name ? path.join(backupDir(), name) : null
  if (!name || !file || !fs.existsSync(file)) return res.status(404).json({})
  res.setHeader("Content-Type", "application/octet-stream")
  res.setHeader("Content-Length", String(fs.statSync(file).size))
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res)
}
