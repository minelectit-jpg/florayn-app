/**
 * One-shot production restore, runnable as `node <this file>` with no
 * arguments and no shell.
 *
 * Cloudways cron offers a fixed set of program types - Node, cURL, NPM and so
 * on - each running one program with one argument, so `curl ... && node ...`
 * is not expressible. This does both halves itself: downloads the SQL dump
 * with the built-in fetch, then hands it to restore-from-sql.js, which is the
 * already-tested restore.
 *
 * CONFIGURATION COMES FROM THE ENVIRONMENT, NOT FROM THIS FILE.
 *
 * It would be more convenient to paste the URL and the connection string in
 * here. This repository is public, so that would publish the production
 * database password and hand anyone a readable copy of the whole dump - which
 * carries every order, customer and admin password hash. Both values are read
 * at runtime instead, from the real environment or from a .env file on the
 * server, and neither is ever printed.
 *
 *   DATABASE_URL     the production connection string
 *   RESTORE_SQL_URL  a presigned GET url for florayn.sql
 *
 * Set RESTORE_SQL_URL in the app's Environment Variables panel, run this once,
 * then delete it again.
 *
 * IT DROPS EVERYTHING. The restore it delegates to runs DROP SCHEMA public
 * CASCADE first. If either value above is missing this exits before opening a
 * database connection, so a misconfigured run costs nothing.
 */

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const APP_ROOT = path.join(__dirname, "..")

/* Where a .env might be, most specific last so later files win nothing -
 * the first file to supply a key wins, and a real environment variable beats
 * every file. */
const ENV_CANDIDATES = [
  path.join(APP_ROOT, ".env"),
  path.join(APP_ROOT, "apps", "backend", ".env"),
  path.join(process.cwd(), ".env"),
]

const NEEDED = ["DATABASE_URL", "RESTORE_SQL_URL"]

/** Minimal .env parsing - no dependency, and this may run before any install. */
function readEnvFile(file) {
  const out = {}
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

function loadConfig() {
  const source = {}
  for (const key of NEEDED) {
    if (process.env[key]) source[key] = "the environment"
  }

  for (const file of ENV_CANDIDATES) {
    if (!fs.existsSync(file)) continue
    let parsed
    try {
      parsed = readEnvFile(file)
    } catch (error) {
      console.error(`[oneshot] could not read ${file}: ${error.message}`)
      continue
    }
    for (const key of NEEDED) {
      if (!process.env[key] && parsed[key]) {
        process.env[key] = parsed[key]
        source[key] = file
      }
    }
  }
  return source
}

/** Host and database only. Never the password - this goes to a cron log. */
function describeDb(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} as ${u.username}`
  } catch {
    return "(unparseable)"
  }
}

/** Origin and path only. The query string of a presigned url IS the credential. */
function describeUrl(url) {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname} (query hidden)`
  } catch {
    return "(unparseable)"
  }
}

async function main() {
  console.log(`[oneshot] node ${process.version}`)
  console.log(`[oneshot] script   ${__filename}`)
  console.log(`[oneshot] app root ${APP_ROOT}`)
  console.log(`[oneshot] cwd      ${process.cwd()}`)

  for (const file of ENV_CANDIDATES) {
    console.log(`[oneshot] .env ${fs.existsSync(file) ? "found  " : "absent "} ${file}`)
  }

  const source = loadConfig()
  const missing = NEEDED.filter((key) => !process.env[key])

  for (const key of NEEDED) {
    console.log(
      `[oneshot] ${key}: ${process.env[key] ? `from ${source[key]}` : "NOT FOUND"}`
    )
  }

  if (missing.length) {
    console.error(
      `\n[oneshot] Missing ${missing.join(" and ")}. Nothing was changed.\n` +
        `Set them on the app (Environment Variables), or put them in one of the\n` +
        `.env paths listed above, then run this again.`
    )
    process.exit(1)
  }

  console.log(`[oneshot] database ${describeDb(process.env.DATABASE_URL)}`)
  console.log(`[oneshot] source   ${describeUrl(process.env.RESTORE_SQL_URL)}`)

  const target = path.join(os.tmpdir(), "florayn.sql")
  console.log(`[oneshot] downloading to ${target} ...`)

  const started = Date.now()
  const res = await fetch(process.env.RESTORE_SQL_URL, { redirect: "follow" })
  if (!res.ok) {
    // A presigned url that has expired shows up here as 403.
    console.error(
      `[oneshot] download failed: HTTP ${res.status} ${res.statusText}. ` +
        `Nothing was changed.` +
        (res.status === 403 ? " A 403 usually means the presigned url expired." : "")
    )
    process.exit(1)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(target, bytes)
  console.log(
    `[oneshot] downloaded ${(bytes.length / 1e6).toFixed(1)} MB in ` +
      `${Math.round((Date.now() - started) / 1000)}s`
  )

  if (bytes.length < 1_000_000) {
    console.error(
      `[oneshot] that is far too small for this dump - refusing to restore it. ` +
        `Nothing was changed.`
    )
    process.exit(1)
  }

  /*
   * Delegate to the tested restore rather than reimplementing it. Running it
   * as a child keeps that script exactly as it was verified, stack and all.
   */
  const restore = path.join(__dirname, "restore-from-sql.js")
  if (!fs.existsSync(restore)) {
    console.error(`[oneshot] missing ${restore}. Nothing was changed.`)
    process.exit(1)
  }

  console.log(`[oneshot] handing over to restore-from-sql.js\n`)
  const result = spawnSync(
    process.execPath,
    [restore, "--yes-drop-and-restore", target, process.env.DATABASE_URL],
    { stdio: "inherit" }
  )

  if (result.error) {
    console.error(`[oneshot] could not start the restore: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status === null ? 1 : result.status)
}

main().catch((error) => {
  console.error(`[oneshot] FAILED: ${error.message}`)
  process.exit(1)
})
