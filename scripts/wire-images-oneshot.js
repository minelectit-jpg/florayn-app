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
const path = require("node:path")

const APP_ROOT = path.join(__dirname, "..")
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

console.log(`[wire] node ${process.version}`)
console.log(`[wire] app root ${APP_ROOT}`)
for (const file of ENV_CANDIDATES) {
  console.log(`[wire] .env ${fs.existsSync(file) ? "found  " : "absent "} ${file}`)
}

/*
 * WIRE_DATABASE_URL wins outright. Medusa reads DATABASE_URL, so the chosen
 * value is written back into it for the child - that assignment is what makes
 * the override effective rather than decorative.
 */
const target = process.env.WIRE_DATABASE_URL || process.env.DATABASE_URL
if (!target) {
  console.error(
    "[wire] No database. Set WIRE_DATABASE_URL to the connection string from " +
      "the backend's boot log. Nothing was changed."
  )
  process.exit(1)
}
process.env.DATABASE_URL = target

console.log(
  `[wire] target ${describe(target)} (from ${
    process.env.WIRE_DATABASE_URL ? source.WIRE_DATABASE_URL ?? "the environment" : source.DATABASE_URL ?? "the environment"
  })`
)

if (!process.env.IMAGE_BASE_URL) {
  console.error("[wire] IMAGE_BASE_URL is not set. Nothing was changed.")
  process.exit(1)
}
console.log(`[wire] image host ${process.env.IMAGE_BASE_URL}`)

if (!fs.existsSync(MANIFEST)) {
  console.error(
    `[wire] Manifest missing at ${MANIFEST}\n` +
      `It ships in the repository, so this usually means the app has not been ` +
      `redeployed since it was added. Nothing was changed.`
  )
  process.exit(1)
}
// medusa build does not copy apps/backend/data into the bundle, so the child
// is told exactly where the manifest is rather than left to search for it.
process.env.IMAGE_MANIFEST_DEVICE = MANIFEST
console.log(`[wire] manifest ${MANIFEST}`)

const limit = Number(process.env.WIRE_LIMIT ?? 0)
console.log(
  limit > 0
    ? `[wire] WIRE_LIMIT=${limit} - a test batch, not the full catalogue.`
    : `[wire] WIRE_LIMIT unset - wiring all 525 products.`
)

const script = path.join(SERVER_DIR, "src", "scripts", "wire-images-device.js")
if (!fs.existsSync(script)) {
  console.error(`[wire] Built script missing at ${script}. Has the backend been built?`)
  process.exit(1)
}

let cli
try {
  cli = require.resolve("@medusajs/cli", { paths: [SERVER_DIR] })
} catch (error) {
  console.error(`[wire] Cannot find the Medusa CLI: ${error.message}`)
  process.exit(1)
}

console.log(`[wire] running medusa exec ./src/scripts/wire-images-device.js\n`)

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
  console.error(`[wire] could not start: ${result.error.message}`)
  process.exit(1)
}

console.log(
  result.status === 0
    ? `\n[wire] finished. Verify with the Store API before running the rest.`
    : `\n[wire] exited ${result.status} - check the output above.`
)
process.exit(result.status === null ? 1 : result.status)
