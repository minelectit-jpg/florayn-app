/**
 * Wire the R2 image URLs into the production catalogue, in place.
 *
 * Runs as `node <this file>` with no arguments, so it works from a Cloudways
 * Node cron on a host with no SSH. It writes product.thumbnail,
 * product.images[] and variant.metadata.images. It does NOT drop anything,
 * does not touch the publishable key, and does not restore data - it replaces
 * the seed's placeholder images with real ones and changes nothing else.
 *
 * THE TARGET DATABASE IS EXPLICIT, ON PURPOSE.
 *
 * A restore on this project once landed in a database the backend does not
 * read, which is why production ended up serving a seeded catalogue with
 * placeholder art. Discovery is the thing that went wrong, so WIRE_DATABASE_URL
 * is preferred over anything found lying around: set it to the exact string
 * from the backend's own boot log and there is no inference left to get wrong.
 *
 * Configuration, none of it baked into this file:
 *   WIRE_DATABASE_URL  the database to write to (falls back to DATABASE_URL)
 *   IMAGE_BASE_URL     the public image host
 *   WIRE_LIMIT         wire only the first N products; 0 or unset means all
 */

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const APP_ROOT = path.join(__dirname, "..")

/*
 * Cron stdout does not surface anywhere on this host, so a run that refuses to
 * start looks identical to a run that never happened. Everything printed here
 * is also appended to a file that the gated /diagnose route reads back, which
 * turns an invisible cron into something answerable from a browser.
 */
const LOG_CANDIDATES = [
  path.join(APP_ROOT, "wire-oneshot.log"),
  path.join(os.tmpdir(), "wire-oneshot.log"),
]

let logFile = null
for (const candidate of LOG_CANDIDATES) {
  try {
    fs.appendFileSync(candidate, "")
    logFile = candidate
    break
  } catch {
    // try the next one; a read-only app directory is normal on some hosts
  }
}

function say(line) {
  console.log(line)
  if (!logFile) return
  try {
    fs.appendFileSync(logFile, `${line}\n`)
  } catch {
    // never let logging break the run
  }
}

function fail(line) {
  console.error(line)
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${line}\n`)
    } catch {}
  }
  process.exit(1)
}
const SERVER_DIR = path.join(APP_ROOT, "apps", "backend", ".medusa", "server")
const MANIFEST = path.join(APP_ROOT, "apps", "backend", "data", "images-device-manifest.json")

const ENV_CANDIDATES = [
  path.join(APP_ROOT, ".env"),
  path.join(APP_ROOT, "apps", "backend", ".env"),
  path.join(process.cwd(), ".env"),
]

const WANTED = ["WIRE_DATABASE_URL", "DATABASE_URL", "IMAGE_BASE_URL", "WIRE_LIMIT"]

function loadEnvFiles() {
  const source = {}
  for (const key of WANTED) {
    if (process.env[key]) source[key] = "the environment"
  }
  for (const file of ENV_CANDIDATES) {
    if (!fs.existsSync(file)) continue
    let text
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m || !WANTED.includes(m[1]) || process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
      source[m[1]] = file
    }
  }
  return source
}

/** Host and database only. Never the password - this goes to a log. */
function describe(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} as ${u.username}`
  } catch {
    return "(unparseable)"
  }
}

const source = loadEnvFiles()

say("")
say(`[wire] ---- run started ${new Date().toISOString()} ----`)
say(`[wire] node ${process.version}`)
say(`[wire] app root ${APP_ROOT}`)
say(`[wire] log file ${logFile ?? "(none writable)"}`)
for (const file of ENV_CANDIDATES) {
  say(`[wire] .env ${fs.existsSync(file) ? "found  " : "absent "} ${file}`)
}

/*
 * Names only, never values. This single block is what tells us whether cron
 * inherited the app's environment at all - the usual reason a run does nothing
 * and leaves no trace.
 */
for (const key of WANTED) {
  say(
    `[wire] ${key}: ${
      process.env[key] ? `set (from ${source[key] ?? "the environment"})` : "NOT SET"
    }`
  )
}

/*
 * WIRE_DATABASE_URL wins outright. Medusa reads DATABASE_URL, so the chosen
 * value is written back into it for the child - that assignment is what makes
 * the override effective rather than decorative.
 */
const target = process.env.WIRE_DATABASE_URL
if (!target) {
  fail(
    "[wire] WIRE_DATABASE_URL is not set. Nothing was changed.\n" +
      "[wire] This is deliberate: it does NOT fall back to DATABASE_URL. A\n" +
      "[wire] discovered target is how a restore on this project wrote to a\n" +
      "[wire] database the backend does not read, and a wrong target here\n" +
      "[wire] would write 27,962 image URLs into the wrong catalogue.\n" +
      "[wire] Set it to the connection string from the backend's boot log."
  )
}
process.env.DATABASE_URL = target

say(`[wire] target ${describe(target)}`)

if (!process.env.IMAGE_BASE_URL) {
  fail("[wire] IMAGE_BASE_URL is not set. Nothing was changed.")
}
say(`[wire] image host ${process.env.IMAGE_BASE_URL}`)

if (!fs.existsSync(MANIFEST)) {
  fail(
    `[wire] Manifest missing at ${MANIFEST} - the app has probably not been ` +
      `redeployed since it was added. Nothing was changed.`
  )
}
// medusa build does not copy apps/backend/data into the bundle, so the child
// is told exactly where the manifest is rather than left to search for it.
process.env.IMAGE_MANIFEST_DEVICE = MANIFEST
say(`[wire] manifest ${MANIFEST}`)

const limit = Number(process.env.WIRE_LIMIT ?? 0)
say(
  limit > 0
    ? `[wire] WIRE_LIMIT=${limit} - a test batch, not the full catalogue.`
    : `[wire] WIRE_LIMIT unset - wiring all 525 products.`
)

const script = path.join(SERVER_DIR, "src", "scripts", "wire-images-device.js")
if (!fs.existsSync(script)) {
  fail(`[wire] Built script missing at ${script}. Has the backend been built?`)
}

let cli
try {
  cli = require.resolve("@medusajs/cli", { paths: [SERVER_DIR] })
} catch (error) {
  fail(`[wire] Cannot find the Medusa CLI: ${error.message}`)
}

say(`[wire] running medusa exec ./src/scripts/wire-images-device.js`)

/*
 * Run the CLI's JS entry directly with this node binary. Going through npx or
 * a shell would put a process in between, and a timeout would then kill the
 * wrapper while the real work carried on holding the inherited stdio.
 */
const result = spawnSync(
  process.execPath,
  [cli, "exec", "./src/scripts/wire-images-device.js"],
  { cwd: SERVER_DIR, stdio: "inherit", env: process.env }
)

if (result.error) {
  fail(`[wire] could not start: ${result.error.message}`)
}

say(
  result.status === 0
    ? `[wire] finished OK. Verify with the Store API before running the rest.`
    : `[wire] exited ${result.status} - see the output above.`
)
process.exit(result.status === null ? 1 : result.status)
