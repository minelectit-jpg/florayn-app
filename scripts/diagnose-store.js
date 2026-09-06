/**
 * Read-only diagnosis of whichever database the app is actually configured
 * against. Runs as `node <this file>` with no arguments, so it works from a
 * Cloudways Node cron on a host with no SSH.
 *
 * THIS SCRIPT ONLY READS. Every statement is a SELECT. It exists to answer a
 * question no amount of guessing from outside could settle: the production
 * Store API rejects a publishable key that is demonstrably present, valid and
 * sales-channel-linked in the database that was restored - while serving the
 * products from that same restore. One of those two things is not talking to
 * the database we think it is, and this prints enough to say which.
 *
 * Publishable key tokens are printed in full: they are public by design and
 * ship inside every browser bundle. Secret keys are masked, and the database
 * password is never shown.
 */

const fs = require("node:fs")
const path = require("node:path")

const APP_ROOT = path.join(__dirname, "..")
const SERVER_DIR = path.join(APP_ROOT, "apps", "backend", ".medusa", "server")

const ENV_CANDIDATES = [
  path.join(APP_ROOT, ".env"),
  path.join(APP_ROOT, "apps", "backend", ".env"),
  path.join(process.cwd(), ".env"),
]

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return "the environment"
  for (const file of ENV_CANDIDATES) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/)
      if (m) {
        process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "")
        return file
      }
    }
  }
  return null
}

function describe(url) {
  try {
    const u = new URL(url)
    return `host=${u.hostname} port=${u.port || "5432"} database=${u.pathname.replace(/^\//, "")} user=${u.username}`
  } catch {
    return "(unparseable DATABASE_URL)"
  }
}

async function main() {
  const source = loadDatabaseUrl()
  console.log(`[diagnose] script ${__filename}`)
  for (const f of ENV_CANDIDATES) {
    console.log(`[diagnose] .env ${fs.existsSync(f) ? "found  " : "absent "} ${f}`)
  }
  console.log(`[diagnose] DATABASE_URL: ${source ? `from ${source}` : "NOT FOUND"}`)
  if (!source) process.exit(1)
  console.log(`[diagnose] ${describe(process.env.DATABASE_URL)}`)

  let Client
  try {
    ;({ Client } = require(require.resolve("pg", { paths: [SERVER_DIR, __dirname] })))
  } catch (error) {
    console.error(`[diagnose] cannot load pg: ${error.message}`)
    process.exit(1)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const show = async (label, sql) => {
    console.log(`\n--- ${label} ---`)
    try {
      const { rows } = await client.query(sql)
      if (!rows.length) console.log("(no rows)")
      for (const row of rows) console.log(JSON.stringify(row))
    } catch (error) {
      console.log(`query failed: ${error.message}`)
    }
  }

  try {
    // Which database this connection actually landed in, as the server sees
    // it - not as the connection string claims.
    await show(
      "connection",
      `SELECT current_database() AS db, current_user AS usr,
              inet_server_addr()::text AS server_addr, version() AS pg`
    )

    await show(
      "api keys",
      `SELECT id, type, title,
              CASE WHEN type = 'publishable' THEN token ELSE '[masked]' END AS token,
              revoked_at, deleted_at, created_at
         FROM api_key ORDER BY created_at`
    )

    await show(
      "key -> sales channel links",
      `SELECT publishable_key_id, sales_channel_id, deleted_at
         FROM publishable_api_key_sales_channel`
    )

    await show(
      "sales channels and product counts",
      `SELECT s.id, s.name, s.deleted_at, count(ps.product_id) AS products
         FROM sales_channel s
         LEFT JOIN product_sales_channel ps ON ps.sales_channel_id = s.id
        GROUP BY 1, 2, 3`
    )

    await show(
      "catalogue size",
      `SELECT (SELECT count(*) FROM design) AS designs,
              (SELECT count(*) FROM product) AS products,
              (SELECT count(*) FROM product_variant) AS variants,
              (SELECT count(*) FROM region) AS regions`
    )

    await show("admin users", `SELECT id, email, created_at FROM "user" ORDER BY created_at`)
  } finally {
    await client.end()
  }

  console.log(`\n[diagnose] done - nothing was modified.`)
}

main().catch((error) => {
  console.error(`[diagnose] FAILED: ${error.message}`)
  process.exit(1)
})
