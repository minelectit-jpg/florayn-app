import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { authorizePull, manifest } from "../../../lib/backup/pull"

/** GET /backup-pull/manifest - the encrypted backups the Google Drive script can collect (BACKUP.md). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(await authorizePull(req, res))) return
  res.json({ files: await manifest(req.scope) })
}
