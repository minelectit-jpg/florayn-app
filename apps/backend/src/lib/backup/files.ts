import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { BackupKind } from "./settings"

/**
 * The encrypted backup files on the server (BACKUP.md). They live in a scratch
 * directory inside the backend container and are lost on redeploy, which is
 * fine: Google Drive pulls them within the hour and keeps the history.
 *   florayn-db-20261010T0705Z.dump.age   (hourly database dump)
 *   florayn-env-20261010.json.age        (daily backend settings)
 */
export const FILE_NAME = /^florayn-(db|env)-(\d{8}(?:T\d{4}Z)?)\.(dump|json)\.age$/

export function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(os.tmpdir(), "florayn-backups")
}

export function ensureDir(dir = backupDir()): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Compact UTC stamps: 20261010T0705Z for dumps, 20261010 for the daily file. */
export function stamp(at: Date, withTime = true): string {
  const iso = at.toISOString()
  const day = iso.slice(0, 10).replace(/-/g, "")
  return withTime ? `${day}T${iso.slice(11, 16).replace(":", "")}Z` : day
}

export function fileNameFor(kind: BackupKind, at: Date): string {
  return kind === "db" ? `florayn-db-${stamp(at)}.dump.age` : `florayn-env-${stamp(at, false)}.json.age`
}

/** A name from a request, accepted only when it is exactly one of ours (no paths). */
export function safeName(name: unknown): string | null {
  return typeof name === "string" && FILE_NAME.test(name) ? name : null
}

export function kindOf(name: string): BackupKind | null {
  const match = FILE_NAME.exec(name)
  return match ? (match[1] as BackupKind) : null
}

export type LocalFile = { name: string; kind: BackupKind; bytes: number; modified: string }

/** Our encrypted files in the directory, newest first. */
export function listFiles(dir = backupDir()): LocalFile[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const files: LocalFile[] = []
  for (const name of entries) {
    const kind = kindOf(name)
    if (!kind) continue
    try {
      const stat = fs.statSync(path.join(dir, name))
      if (stat.isFile()) files.push({ name, kind, bytes: stat.size, modified: stat.mtime.toISOString() })
    } catch {
      // Removed meanwhile.
    }
  }
  return files.sort((a, b) => b.name.localeCompare(a.name))
}

/** Names to delete so each kind keeps its newest `keep` files. Pure. */
export function namesToPrune(files: readonly LocalFile[], keep: number): string[] {
  const out: string[] = []
  for (const kind of ["db", "env"] as const) {
    const ofKind = files.filter((f) => f.kind === kind).sort((a, b) => b.name.localeCompare(a.name))
    out.push(...ofKind.slice(Math.max(1, keep)).map((f) => f.name))
  }
  return out
}

export function prune(keep: number, dir = backupDir()): string[] {
  const removed: string[] = []
  for (const name of namesToPrune(listFiles(dir), keep)) {
    try {
      fs.rmSync(path.join(dir, name), { force: true })
      removed.push(name)
    } catch {
      // Tried again next run.
    }
  }
  return removed
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    fs.createReadStream(file).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")))
  })
}
