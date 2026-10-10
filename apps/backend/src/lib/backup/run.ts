import fs from "node:fs"
import path from "node:path"

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { sendEmail } from "../send-email"
import { getState, setState, trackingDb } from "../tracking/db"
import { loadTrackingSettings } from "../tracking/settings"
import { dumpDatabase, type Runner } from "./dump"
import { type AgeLib, encryptFile, encryptText } from "./encrypt"
import { ensureDir, fileNameFor, listFiles, prune, sha256File, stamp } from "./files"
import { ALERTS_KEY, type BackupRun, type BackupSettings, loadRuns, loadSettings, recordRun } from "./settings"

/**
 * One backup pass (BACKUP.md): the database every run, the backend settings
 * once a day, then pruning and alert emails. One pass at a time per process
 * (scheduled jobs run side by side, medusa-config.ts). Never throws; failures
 * are recorded in the run history and emailed.
 */
let running = false

export type PassResult =
  | { status: "busy" | "skipped"; reason: string; runs: BackupRun[] }
  | { status: "done" | "failed"; runs: BackupRun[] }

export type PassOptions = {
  trigger?: "schedule" | "manual"
  now?: () => Date
  dir?: string
  run?: Runner
  age?: AgeLib
  databaseUrl?: string
  mail?: typeof sendEmail
}

/** Environment variables that describe the container, not the app; left out of the settings snapshot. */
const SYSTEM_ENV = new Set(["PATH", "HOME", "HOSTNAME", "PWD", "OLDPWD", "SHLVL", "TERM", "_", "NODE_VERSION", "YARN_VERSION", "LANG"])

export function envSnapshot(env: NodeJS.ProcessEnv, at: Date): string {
  const kept = Object.entries(env).filter(([key, value]) => typeof value === "string" && !SYSTEM_ENV.has(key)).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify({ app: "florayn-backend", created_at: at.toISOString(), env: Object.fromEntries(kept) }, null, 2)
}

function failureText(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === "string" ? (error as Error).message : String(error)
  return message.replace(/postgres(ql)?:\/\/\S+/gi, "<database url>").slice(0, 300) || "error"
}

async function backupDatabase(dir: string, at: Date, settings: BackupSettings, trigger: BackupRun["trigger"], opts: PassOptions): Promise<BackupRun> {
  const file = fileNameFor("db", at)
  const run: BackupRun = {
    id: `db-${stamp(at)}-${trigger}`, kind: "db", trigger, started_at: at.toISOString(), finished_at: null,
    ok: false, file: null, bytes: null, sha256: null, tables: null, error: null, pulled_at: null,
  }
  const plain = path.join(dir, `.plain-${stamp(at)}.dump`)
  try {
    run.tables = await dumpDatabase(plain, { databaseUrl: opts.databaseUrl, run: opts.run })
    const target = path.join(dir, file)
    run.bytes = await encryptFile(plain, target, settings.recipient!, opts.age)
    run.sha256 = await sha256File(target)
    run.file = file
    run.ok = true
  } catch (error) {
    run.error = failureText(error)
  } finally {
    fs.rmSync(plain, { force: true })
    run.finished_at = (opts.now?.() ?? new Date()).toISOString()
  }
  return run
}

async function backupSettingsSnapshot(dir: string, at: Date, settings: BackupSettings, trigger: BackupRun["trigger"], opts: PassOptions): Promise<BackupRun> {
  const file = fileNameFor("env", at)
  const run: BackupRun = {
    id: `env-${stamp(at, false)}`, kind: "env", trigger, started_at: at.toISOString(), finished_at: null,
    ok: false, file: null, bytes: null, sha256: null, tables: null, error: null, pulled_at: null,
  }
  try {
    const target = path.join(dir, file)
    run.bytes = await encryptText(envSnapshot(process.env, at), target, settings.recipient!, opts.age)
    run.sha256 = await sha256File(target)
    run.file = file
    run.ok = true
  } catch (error) {
    run.error = failureText(error)
  } finally {
    run.finished_at = (opts.now?.() ?? new Date()).toISOString()
  }
  return run
}

// ---------------------------------------------------------------- alerts

type AlertState = { failing_since: string | null; failure_mailed_at: string | null; stale_mailed_at: string | null }
const HOUR = 3_600_000
export const FAILURE_REPEAT_MS = 6 * HOUR
export const PULL_STALE_MS = 4 * HOUR
export const STALE_REPEAT_MS = 12 * HOUR

export type AlertMail = { subject: string; text: string }

/**
 * Which emails a pass should send, and the next alert state. Pure.
 * - the database backup failed: mail at once, then every 6 hours while it fails
 * - it works again after failing: one "working again" mail
 * - Google Drive is set up (a pull token exists) but has collected nothing for
 *   4 hours although backups exist: mail, then every 12 hours
 */
export function alertsFor(input: { state: AlertState; dbRun: BackupRun | null; runs: readonly BackupRun[]; driveSetUp: boolean; now: Date }):
  { mails: AlertMail[]; state: AlertState } {
  const { dbRun, runs, driveSetUp, now } = input
  const state = { ...input.state }
  const mails: AlertMail[] = []
  const t = now.getTime()
  if (dbRun && !dbRun.ok) {
    if (!state.failing_since) state.failing_since = now.toISOString()
    const last = state.failure_mailed_at ? Date.parse(state.failure_mailed_at) : 0
    if (t - last >= FAILURE_REPEAT_MS) {
      mails.push({ subject: "Florayn backup failed", text: `The hourly database backup failed: ${dbRun.error ?? "unknown error"}.\nFailing since ${state.failing_since}. Open Admin > Backups.` })
      state.failure_mailed_at = now.toISOString()
    }
  } else if (dbRun && dbRun.ok && state.failing_since) {
    mails.push({ subject: "Florayn backups are working again", text: `The database backup succeeded again at ${dbRun.finished_at}. It had been failing since ${state.failing_since}.` })
    state.failing_since = null
    state.failure_mailed_at = null
  }
  if (driveSetUp) {
    const okDb = runs.filter((r) => r.kind === "db" && r.ok)
    const lastPulled = Math.max(0, ...okDb.map((r) => (r.pulled_at ? Date.parse(r.pulled_at) : 0)))
    const oldestWaiting = okDb.filter((r) => !r.pulled_at && r.finished_at).map((r) => Date.parse(r.finished_at!)).sort((a, b) => a - b)[0]
    const stale = oldestWaiting !== undefined && t - oldestWaiting > PULL_STALE_MS && t - lastPulled > PULL_STALE_MS
    const lastMail = state.stale_mailed_at ? Date.parse(state.stale_mailed_at) : 0
    if (stale && t - lastMail >= STALE_REPEAT_MS) {
      const hours = Math.round((t - (lastPulled || oldestWaiting!)) / HOUR)
      mails.push({ subject: "Google Drive has not collected Florayn backups", text: `No backup has been collected by the Google Drive script for about ${hours} hours. Check the script's triggers and executions in Google Apps Script, then Admin > Backups.` })
      state.stale_mailed_at = now.toISOString()
    }
    if (!stale) state.stale_mailed_at = null
  }
  return { mails, state }
}

async function sendAlerts(container: any, settings: BackupSettings, dbRun: BackupRun | null, now: Date, opts: PassOptions): Promise<void> {
  const db = trackingDb(container)
  const raw = (await getState<AlertState>(db, ALERTS_KEY)) ?? { failing_since: null, failure_mailed_at: null, stale_mailed_at: null }
  const { mails, state } = alertsFor({ state: raw, dbRun, runs: await loadRuns(container), driveSetUp: Boolean(settings.pull_token_hash), now })
  if (JSON.stringify(state) !== JSON.stringify(raw)) await setState(db, ALERTS_KEY, state)
  if (!mails.length) return
  let to = settings.alert_email
  if (!to) to = (await loadTrackingSettings(container).catch(() => null))?.config.alerts.email ?? null
  if (!to) return
  const mail = opts.mail ?? sendEmail
  for (const m of mails) {
    const html = `<p>${m.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`
    await mail({ to, subject: m.subject, html, text: m.text, fromName: "Florayn backups" }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------- the pass

export async function runBackupPass(container: any, opts: PassOptions = {}): Promise<PassResult> {
  const trigger = opts.trigger ?? "schedule"
  if (running) return { status: "busy", reason: "A backup is already running.", runs: [] }
  running = true
  try {
    const settings = await loadSettings(container)
    if (!settings.recipient) return { status: "skipped", reason: "No encryption key yet.", runs: [] }
    if (!settings.enabled && trigger === "schedule") return { status: "skipped", reason: "Backups are off.", runs: [] }
    const now = opts.now ?? (() => new Date())
    const dir = ensureDir(opts.dir)
    const done: BackupRun[] = []

    const dbRun = await backupDatabase(dir, now(), settings, trigger, opts)
    await recordRun(container, dbRun)
    done.push(dbRun)

    const today = stamp(now(), false)
    const hasToday = listFiles(dir).some((f) => f.kind === "env" && f.name.includes(`-${today}.`))
    if (!hasToday) {
      const envRun = await backupSettingsSnapshot(dir, now(), settings, trigger, opts)
      await recordRun(container, envRun)
      done.push(envRun)
    }
    prune(settings.keep_local, dir)
    await sendAlerts(container, settings, dbRun, now(), opts).catch(() => undefined)
    return { status: done.every((r) => r.ok) ? "done" : "failed", runs: done }
  } catch (error) {
    try {
      container.resolve(ContainerRegistrationKeys.LOGGER).warn(`[backup] pass failed: ${failureText(error)}`)
    } catch {
      // Logging is best effort.
    }
    return { status: "failed", runs: [] }
  } finally {
    running = false
  }
}
