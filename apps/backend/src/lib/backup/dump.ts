import { spawn } from "node:child_process"

/**
 * pg_dump and the check that the dump reads back (BACKUP.md). The connection
 * comes from DATABASE_URL and is passed in PG* environment variables, never on
 * the command line, so the password does not appear in the process list.
 * pg_dump 17 matches the server (the backend image installs
 * postgresql-client-17); an older client refuses a newer server.
 */
export type RunResult = { code: number | null; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<RunResult>

const MAX_OUTPUT = 4 * 1024 * 1024

export const runCommand: Runner = (cmd, args, { env, timeoutMs }) => new Promise((resolve) => {
  let stdout = ""
  let stderr = ""
  let settled = false
  const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] })
  const timer = setTimeout(() => { child.kill("SIGKILL") }, timeoutMs)
  timer.unref?.()
  child.stdout.on("data", (chunk) => { if (stdout.length < MAX_OUTPUT) stdout += chunk })
  child.stderr.on("data", (chunk) => { if (stderr.length < MAX_OUTPUT) stderr += chunk })
  const finish = (code: number | null, extra = "") => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ code, stdout, stderr: stderr + extra })
  }
  child.on("error", (error) => finish(null, `\n${error.message}`))
  child.on("close", (code) => finish(code))
})

/** PG* variables for libpq from a postgres:// URL. Throws on a missing or malformed URL. */
export function pgEnv(databaseUrl: string | undefined, base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  const url = new URL(databaseUrl)
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("DATABASE_URL is not a postgres URL")
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""))
  if (!url.hostname || !database) throw new Error("DATABASE_URL has no host or database")
  const env: NodeJS.ProcessEnv = {
    PATH: base.PATH ?? process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "florayn-backup",
  }
  const sslmode = url.searchParams.get("sslmode")
  if (sslmode) env.PGSSLMODE = sslmode
  return env
}

/** Tables whose data is large, short-lived and rebuilt by the app (DEPLOY.md, Backups). */
export const EXCLUDED_DATA = ["tracking_hit", "tracking_event"]

export function dumpArgs(outFile: string): string[] {
  return [
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-privileges",
    ...EXCLUDED_DATA.map((table) => `--exclude-table-data=${table}`),
    `--file=${outFile}`,
  ]
}

/** A dump with fewer tables than this, or without orders and products, is treated as broken. */
export const MIN_TABLES = 30
const MUST_HAVE = ["order", "product"]

/** Counts the TABLE DATA entries in `pg_restore --list` output and checks the key tables are there. Pure. */
export function checkRestoreList(listing: string): { ok: true; tables: number } | { ok: false; tables: number; error: string } {
  const lines = listing.split(/\r?\n/).filter((line) => /\bTABLE DATA\b/.test(line))
  const names = new Set(lines.map((line) => /\bTABLE DATA \S+ (\S+)/.exec(line)?.[1]).filter(Boolean))
  const missing = MUST_HAVE.filter((name) => !names.has(name))
  if (lines.length < MIN_TABLES) return { ok: false, tables: lines.length, error: `the dump lists only ${lines.length} tables` }
  if (missing.length) return { ok: false, tables: lines.length, error: `the dump has no data for: ${missing.join(", ")}` }
  return { ok: true, tables: lines.length }
}

/** The last useful line of a tool's error output, without anything that looks like a URL or password. */
export function toolError(result: RunResult, tool: string): string {
  const line = result.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? `exit code ${result.code}`
  return `${tool}: ${line.replace(/postgres(ql)?:\/\/\S+/gi, "<database url>").replace(/password\S*/gi, "password…").slice(0, 300)}`
}

/** Dumps the database to `outFile` and verifies it reads back. Returns the table count. */
export async function dumpDatabase(outFile: string, opts: { databaseUrl?: string; run?: Runner; timeoutMs?: number } = {}): Promise<number> {
  const run = opts.run ?? runCommand
  const env = pgEnv(opts.databaseUrl ?? process.env.DATABASE_URL)
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000
  const dumped = await run("pg_dump", dumpArgs(outFile), { env, timeoutMs })
  if (dumped.code !== 0) throw new Error(toolError(dumped, "pg_dump"))
  const listed = await run("pg_restore", ["--list", outFile], { env: { PATH: env.PATH }, timeoutMs: 60_000 })
  if (listed.code !== 0) throw new Error(toolError(listed, "pg_restore"))
  const check = checkRestoreList(listed.stdout)
  if (!check.ok) throw new Error(check.error)
  return check.tables
}
