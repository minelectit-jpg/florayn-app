import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { safeName } from "../../../lib/backup/files"
import { authorizePull } from "../../../lib/backup/pull"
import { markPulled } from "../../../lib/backup/settings"

/**
 * POST /backup-pull/ack { name, sha256 } - the Google Drive script saved this
 * file and its checksum matched (BACKUP.md). Admin > Backups shows it as
 * collected, and the missing-pull alert stays quiet.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(await authorizePull(req, res))) return
  const body = (req.body ?? {}) as { name?: unknown; sha256?: unknown }
  const name = safeName(body.name)
  const sha256 = typeof body.sha256 === "string" && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : null
  if (!name || !sha256) return res.status(400).json({})
  const ok = await markPulled(req.scope, name, sha256, new Date())
  res.status(ok ? 200 : 404).json({ ok })
}
