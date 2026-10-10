import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { listFiles, type LocalFile } from "./files"
import { type BackupRun, loadRuns, loadSettings } from "./settings"
import { bearerToken, noteFailure, tooManyFailures, verifyPullToken } from "./token"

/**
 * The Google Drive pull API (BACKUP.md): public routes under /backup-pull
 * (not /store or /admin, so no Medusa auth), trusted only through the
 * `Authorization: Bearer flb_...` pull token. They hand out ENCRYPTED files
 * only. Answers are never cached.
 */
export async function authorizePull(req: MedusaRequest, res: MedusaResponse): Promise<boolean> {
  res.setHeader("Cache-Control", "no-store")
  if (tooManyFailures()) {
    res.status(429).json({})
    return false
  }
  const settings = await loadSettings(req.scope)
  if (!verifyPullToken(bearerToken(req.headers.authorization), settings.pull_token_hash)) {
    noteFailure()
    res.status(401).json({})
    return false
  }
  return true
}

export type ManifestItem = { name: string; kind: LocalFile["kind"]; bytes: number; sha256: string; created_at: string; pulled: boolean }

/** The files on the server that a successful run produced, newest first, with their checksums. Pure. */
export function manifestOf(files: readonly LocalFile[], runs: readonly BackupRun[]): ManifestItem[] {
  const byFile = new Map(runs.filter((r) => r.ok && r.file && r.sha256).map((r) => [r.file!, r]))
  const items: ManifestItem[] = []
  for (const file of files) {
    const run = byFile.get(file.name)
    if (!run) continue
    items.push({ name: file.name, kind: file.kind, bytes: file.bytes, sha256: run.sha256!, created_at: run.finished_at ?? file.modified, pulled: Boolean(run.pulled_at) })
  }
  return items
}

export async function manifest(container: any): Promise<ManifestItem[]> {
  return manifestOf(listFiles(), await loadRuns(container))
}
