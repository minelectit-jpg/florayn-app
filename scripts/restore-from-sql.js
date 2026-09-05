/**
 * Replay a plain-SQL dump into a database, using the `pg` client bundled with
 * the built server. Nothing else is required - no psql, no pg_restore.
 *
 * This exists because Cloudways Velocity is a Node runtime with no PostgreSQL
 * client binaries and no SSH, so a one-shot cron job invoking `node` is the
 * only way to get a catalogue into the production database. The dump it reads
 * must be made with --inserts: the default plain format uses COPY ... FROM
 * stdin, which is a protocol-level operation the pg client cannot replay.
 *
 * IT DROPS EVERYTHING FIRST. `DROP SCHEMA public CASCADE` destroys every table
 * in the target database. That is the intent - it is what makes a restore work
 * over a half-seeded database - but it means an accidental run against the
 * wrong URL is unrecoverable. Hence the required confirmation flag.
 *
 * Usage:
 *   node scripts/restore-from-sql.js --yes-drop-and-restore <sql-file> [db-url]
 *
 * The database URL may be given as the last argument or as DATABASE_URL.
 */

const fs = require("node:fs")
const path = require("node:path")

const CONFIRM = "--yes-drop-and-restore"
const args = process.argv.slice(2)

if (!args.includes(CONFIRM)) {
  console.error(
    `refusing to run without ${CONFIRM}\n` +
      `This DROPS every table in the target database before restoring.\n` +
      `Usage: node scripts/restore-from-sql.js ${CONFIRM} <sql-file> [db-url]`
  )
  process.exit(1)
}

const rest = args.filter((a) => a !== CONFIRM)
const sqlFile = rest[0]
const dbUrl = rest[1] ?? process.env.DATABASE_URL

if (!sqlFile || !dbUrl) {
  console.error(`Usage: node scripts/restore-from-sql.js ${CONFIRM} <sql-file> [db-url]`)
  process.exit(1)
}

if (!fs.existsSync(sqlFile)) {
  console.error(`No such file: ${sqlFile}`)
  process.exit(1)
}

/*
 * `pg` lives in the built server's node_modules, not at the repository root,
 * so resolve it from there. Falling back to a bare require covers running this
 * from a checkout where dependencies are hoisted instead.
 */
const SERVER_DIR = path.join(__dirname, "..", "apps", "backend", ".medusa", "server")

let Client
try {
  ;({ Client } = require(require.resolve("pg", { paths: [SERVER_DIR, __dirname] })))
} catch (error) {
  console.error(
    `Could not load the pg client: ${error.message}\n` +
      `Looked in ${SERVER_DIR}. Has the backend been built and installed?`
  )
  process.exit(1)
}

/** Host and database only - never the password, since this prints to a log. */
function describe(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} as ${u.username}`
  } catch {
    return "(unparseable DATABASE_URL)"
  }
}

/*
 * pg_dump 17.6 wraps its output in \restrict and \unrestrict. Those are psql
 * meta-commands, not SQL - psql consumes them itself and never sends them to
 * the server - so replaying the file verbatim fails immediately with
 * `syntax error at or near "\"`. Strip the two exact lines, and nothing else:
 * anchoring to the full line keeps this away from backslashes inside data.
 */
function stripPsqlMetaCommands(sql) {
  const lines = sql.split("\n")
  let removed = 0
  const kept = lines.filter((line) => {
    if (/^\\(un)?restrict\s+\S+\s*\r?$/.test(line)) {
      removed++
      return false
    }
    return true
  })
  return { sql: kept.join("\n"), removed }
}

async function main() {
  const raw = fs.readFileSync(sqlFile, "utf8")
  const { sql, removed } = stripPsqlMetaCommands(raw)
  console.log(
    `[restore] ${sqlFile} (${(sql.length / 1e6).toFixed(1)} MB) -> ${describe(dbUrl)}`
  )
  if (removed) {
    console.log(`[restore] Stripped ${removed} psql meta-command line(s).`)
  }

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    console.log("[restore] Dropping and recreating schema public...")
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")

    /*
     * The whole file goes in one simple-query message. Postgres accepts
     * multiple statements that way and wraps them in a single implicit
     * transaction, so a failure anywhere rolls the entire restore back rather
     * than leaving another half-populated database.
     *
     * The alternative - splitting on semicolons - would have to understand
     * quoted strings, dollar-quoted bodies and comments to be correct, and
     * getting that subtly wrong corrupts data silently. Not splitting cannot
     * be subtly wrong.
     */
    console.log(`[restore] Executing (this is one transaction; it takes a while)...`)
    const started = Date.now()
    await client.query(sql)
    console.log(`[restore] Executed in ${Math.round((Date.now() - started) / 1000)}s.`)

    /*
     * The dump sets search_path to '' for safety and that setting outlives it
     * on this connection, so the counts must name the schema. Resetting as
     * well keeps anything added below from tripping over the same thing.
     */
    await client.query("SET search_path TO public")
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM public.product) AS products,
              (SELECT count(*) FROM public.product_variant) AS variants,
              (SELECT count(*) FROM public.design) AS designs`
    )
    const { products, variants, designs } = rows[0]
    console.log(`[restore] designs=${designs} products=${products} variants=${variants}`)

    const ok = Number(products) === 525 && Number(variants) === 13041
    console.log(
      ok
        ? "[restore] OK - counts match the expected 525 / 13041."
        : `[restore] WARNING - expected 525 products and 13041 variants.`
    )
    process.exitCode = ok ? 0 : 2
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`[restore] FAILED: ${error.message}`)
  if (error.position) console.error(`[restore] at character ${error.position}`)
  process.exit(1)
})
