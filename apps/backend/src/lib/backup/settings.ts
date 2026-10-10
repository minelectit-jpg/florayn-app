import { getState, setState, trackingDb } from "../tracking/db"

/**
 * Backups (BACKUP.md). The settings, the run history and the alert state are
 * small JSON values in the key/value table tracking_state, so the feature needs
 * no migration. Nothing secret is stored: the encryption key is the owner's
 * PUBLIC age recipient (the private key never reaches the server) and the
 * Google pull token is kept only as a SHA-256 hash.
 */
export const SETTINGS_KEY = "backup:settings"
export const RUNS_KEY = "backup:runs"
export const ALERTS_KEY = "backup:alerts"

export type BackupKind = "db" | "env"

export type BackupSettings = {
  enabled: boolean
  /** The owner's age X25519 recipient (age1...), or null until a key is made. */
  recipient: string | null
  /** SHA-256 hex of the Google Drive pull token, or null before one is made. */
  pull_token_hash: string | null
  /** Last 4 characters of the pull token, so the admin can tell tokens apart. */
  pull_token_hint: string | null
  /** Encrypted files kept on the server; Google Drive keeps the history. */
  keep_local: number
  /** Where failures and missing Drive pulls are emailed; empty uses the tracking alert email. */
  alert_email: string | null
  updated_at: string | null
}

export type BackupRun = {
  id: string
  kind: BackupKind
  trigger: "schedule" | "manual"
  started_at: string
  finished_at: string | null
  ok: boolean
  file: string | null
  bytes: number | null
  sha256: string | null
  /** Tables with data in the dump (pg_restore --list), a sanity check. */
  tables: number | null
  error: string | null
  pulled_at: string | null
}

export const DEFAULT_SETTINGS: BackupSettings = {
  enabled: false,
  recipient: null,
  pull_token_hash: null,
  pull_token_hint: null,
  keep_local: 6,
  alert_email: null,
  updated_at: null,
}

export const MAX_RUNS = 200
export const KEEP_LOCAL_MIN = 2
export const KEEP_LOCAL_MAX = 48

/** An age X25519 recipient: "age1" and 58 bech32 characters. */
const RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i

export function isRecipient(value: unknown): value is string {
  return typeof value === "string" && RECIPIENT.test(value)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/** Stored JSON to settings, filling defaults and dropping anything malformed. */
export function readSettings(raw: unknown): BackupSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const keep = Number(r.keep_local)
  return {
    enabled: bool(r.enabled, d.enabled),
    recipient: isRecipient(r.recipient) ? r.recipient : null,
    pull_token_hash: typeof r.pull_token_hash === "string" && /^[0-9a-f]{64}$/.test(r.pull_token_hash) ? r.pull_token_hash : null,
    pull_token_hint: typeof r.pull_token_hint === "string" ? r.pull_token_hint.slice(0, 4) : null,
    keep_local: Number.isInteger(keep) && keep >= KEEP_LOCAL_MIN && keep <= KEEP_LOCAL_MAX ? keep : d.keep_local,
    alert_email: typeof r.alert_email === "string" && EMAIL.test(r.alert_email) ? r.alert_email : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  }
}

export type SettingsPatch = { enabled?: unknown; recipient?: unknown; keep_local?: unknown; alert_email?: unknown }

/** Validates an admin save. Turning backups on needs an encryption key. */
export function parseSettingsPatch(body: unknown, current: BackupSettings):
  { ok: true; next: BackupSettings } | { ok: false; errors: Record<string, string> } {
  const b = (body && typeof body === "object" ? body : {}) as SettingsPatch
  const errors: Record<string, string> = {}
  const next: BackupSettings = { ...current }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") errors.enabled = "Choose on or off."
    else next.enabled = b.enabled
  }
  if (b.recipient !== undefined) {
    const value = typeof b.recipient === "string" ? b.recipient.trim() : b.recipient
    if (value === "" || value === null) next.recipient = null
    else if (isRecipient(value)) next.recipient = value
    else errors.recipient = "The encryption key must be an age public key that starts with age1 (63 characters)."
  }
  if (b.keep_local !== undefined) {
    const keep = Number(b.keep_local)
    if (!Number.isInteger(keep) || keep < KEEP_LOCAL_MIN || keep > KEEP_LOCAL_MAX) errors.keep_local = `Keep between ${KEEP_LOCAL_MIN} and ${KEEP_LOCAL_MAX} files on the server.`
    else next.keep_local = keep
  }
  if (b.alert_email !== undefined) {
    const value = typeof b.alert_email === "string" ? b.alert_email.trim() : ""
    if (!value) next.alert_email = null
    else if (EMAIL.test(value)) next.alert_email = value
    else errors.alert_email = "Enter a valid email address, or leave it empty to use the tracking alert email."
  }
  if (next.enabled && !next.recipient) errors.enabled = "Create or paste the encryption key before turning backups on."
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, next }
}

export async function loadSettings(container: any): Promise<BackupSettings> {
  return readSettings(await getState(trackingDb(container), SETTINGS_KEY))
}

export async function saveSettings(container: any, settings: BackupSettings): Promise<BackupSettings> {
  const next = { ...settings, updated_at: new Date().toISOString() }
  await setState(trackingDb(container), SETTINGS_KEY, next)
  return next
}

export function readRuns(raw: unknown): BackupRun[] {
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === "object" && typeof r.id === "string") as BackupRun[] : []
}

export async function loadRuns(container: any): Promise<BackupRun[]> {
  return readRuns(await getState(trackingDb(container), RUNS_KEY))
}

/** Adds or replaces a run (newest first), keeping the last MAX_RUNS. */
export function upsertRun(runs: readonly BackupRun[], run: BackupRun): BackupRun[] {
  return [run, ...runs.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS)
}

export async function recordRun(container: any, run: BackupRun): Promise<void> {
  const db = trackingDb(container)
  await setState(db, RUNS_KEY, upsertRun(readRuns(await getState(db, RUNS_KEY)), run))
}

/** Marks the run that produced `file` as pulled by Google Drive. False when no run matches the file and hash. */
export async function markPulled(container: any, file: string, sha256: string, at: Date): Promise<boolean> {
  const db = trackingDb(container)
  const runs = readRuns(await getState(db, RUNS_KEY))
  const run = runs.find((r) => r.file === file && r.sha256 === sha256)
  if (!run) return false
  await setState(db, RUNS_KEY, upsertRun(runs, { ...run, pulled_at: at.toISOString() }))
  return true
}
