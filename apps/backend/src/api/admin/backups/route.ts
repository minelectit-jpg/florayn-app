// Admin > Backups (BACKUP.md): status, settings, the Google Drive pull token
// and "back up now". The pull token is returned once, when made, and is never
// logged or stored in plain text.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { appsScriptSource } from "../../../lib/backup/apps-script"
import { listFiles } from "../../../lib/backup/files"
import { runBackupPass } from "../../../lib/backup/run"
import { type BackupSettings, loadRuns, loadSettings, parseSettingsPatch, saveSettings } from "../../../lib/backup/settings"
import { newPullToken } from "../../../lib/backup/token"
import { emailConfigured } from "../../../lib/send-email"

export const AUTHENTICATE = true

/** The public base URL the Apps Script calls: MEDUSA_BACKEND_URL, else this request's host. */
function pullBaseUrl(req: MedusaRequest): string {
  const configured = process.env.MEDUSA_BACKEND_URL
  if (configured && /^https:\/\//.test(configured)) return configured.replace(/\/+$/, "")
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim() || "https"
  return `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host}`
}

function view(settings: BackupSettings) {
  const { pull_token_hash, ...rest } = settings
  return { ...rest, token_set: Boolean(pull_token_hash) }
}

async function state(req: MedusaRequest) {
  const [settings, runs] = await Promise.all([loadSettings(req.scope), loadRuns(req.scope)])
  const base = pullBaseUrl(req)
  return {
    settings: view(settings),
    runs: runs.slice(0, 60),
    files: listFiles(),
    pull_url: base,
    script: appsScriptSource(base),
    email_configured: emailConfigured(),
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  res.json(await state(req))
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const body = (req.body ?? {}) as Record<string, unknown>
  const current = await loadSettings(req.scope)

  if (body.action === "save") {
    const parsed = parseSettingsPatch(body, current)
    if (!parsed.ok) return res.status(400).json({ message: "Please check the backup settings.", errors: parsed.errors })
    await saveSettings(req.scope, parsed.next)
    return res.json(await state(req))
  }

  if (body.action === "rotate_token") {
    const { token, hash, hint } = newPullToken()
    await saveSettings(req.scope, { ...current, pull_token_hash: hash, pull_token_hint: hint })
    return res.json({ ...(await state(req)), token })
  }

  if (body.action === "run_now") {
    if (!current.recipient) return res.status(400).json({ message: "Create or paste the encryption key first." })
    const result = await runBackupPass(req.scope, { trigger: "manual" })
    return res.json({ ...(await state(req)), result: { status: result.status, reason: "reason" in result ? result.reason : null } })
  }

  return res.status(400).json({ message: "Unknown action." })
}
