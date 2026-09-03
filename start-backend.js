/**
 * PM2 entry file for the Medusa backend.
 *
 * Cloudways runs an Entry File through PM2, which wants a path to a JS file
 * rather than a shell command. `medusa build` emits a self-contained app in
 * apps/backend/.medusa/server - with its own package.json and its own start
 * script - so the thing that actually has to run lives two directories down
 * from here. This runs migrations, then spawns it and gets out of the way.
 *
 * It does NOT install dependencies. .medusa/server ships without node_modules,
 * so `npm install --omit=dev` has to run there as part of the BUILD step; doing
 * it here would reinstall on every restart and stall the boot.
 */

const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const SERVER_DIR = path.join(__dirname, "apps", "backend", ".medusa", "server")

// Fail loudly and specifically, rather than letting spawn report ENOENT on a
// path nobody will recognise in a deploy log.
if (!fs.existsSync(path.join(SERVER_DIR, "package.json"))) {
  console.error(
    `[start-backend] No build found at ${SERVER_DIR}\n` +
      `Run \`npm --prefix apps/backend run build\` before starting.`
  )
  process.exit(1)
}

if (!fs.existsSync(path.join(SERVER_DIR, "node_modules"))) {
  console.error(
    `[start-backend] ${SERVER_DIR} has no node_modules.\n` +
      `The build step must end with: cd apps/backend/.medusa/server && npm install --omit=dev`
  )
  process.exit(1)
}

const isWindows = process.platform === "win32"

/*
 * Make sure the child actually gets its configuration.
 *
 * The bundle reads .env relative to its own cwd - @medusajs/cli calls
 * dotenv.config() with no path, and loadEnv() takes the bundle directory - so
 * a .env sitting at the application root is invisible to it. That is the
 * reported symptom: "http.jwtSecret not found" with JWT_SECRET plainly set in
 * the dashboard.
 *
 * process.env wins whenever it already carries a value, so a host that exports
 * real environment variables is untouched by this. The file is only a fallback
 * for a host that writes a .env at the app root instead. dotenv itself never
 * overwrites an existing process.env entry, so the precedence below matches
 * what the child would do on its own.
 */
const ENV_CANDIDATES = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "apps", "backend", ".env"),
]

// key -> which file supplied it, for anything this wrapper injected. Values
// already in the environment are absent from this map.
const ENV_SOURCE = new Map()

// Enough to boot. DATABASE_URL is not listed: Medusa defaults it, and a
// missing one fails loudly on its own rather than silently misconfiguring.
const REQUIRED_ENV = ["JWT_SECRET", "COOKIE_SECRET"]

function loadEnvFiles() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length === 0) {
    console.log("[start-backend] Config found in the environment.")
    return
  }

  console.log(
    `[start-backend] Not in the environment: ${missing.join(", ")}. ` +
      `Looking for a .env to fall back on...`
  )

  let dotenv
  try {
    dotenv = require(require.resolve("dotenv", { paths: [SERVER_DIR] }))
  } catch {
    console.error("[start-backend] dotenv is not installed; cannot read a .env file.")
    return
  }

  for (const file of ENV_CANDIDATES) {
    if (!fs.existsSync(file)) continue

    let parsed
    try {
      parsed = dotenv.parse(fs.readFileSync(file))
    } catch (error) {
      console.error(`[start-backend] Could not parse ${file}: ${error.message}`)
      continue
    }

    // Fill only what is absent, so a real environment variable always wins.
    const added = []
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
        added.push(key)
        ENV_SOURCE.set(key, file)
      }
    }
    console.log(
      `[start-backend] Read ${file} (${added.length} value${added.length === 1 ? "" : "s"} applied).`
    )

    if (REQUIRED_ENV.every((key) => process.env[key])) break
  }

  const stillMissing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (stillMissing.length) {
    console.error(
      `\n[start-backend] STILL MISSING: ${stillMissing.join(", ")}\n` +
        `Medusa will fall back to its built-in defaults, which are not safe in\n` +
        `production. Set them on the app, or put them in a .env at one of:\n` +
        ENV_CANDIDATES.map((f) => `  ${f}`).join("\n") +
        "\n"
    )
  }
}

loadEnvFiles()

/*
 * Say out loud which database is about to be used, and where that came from.
 *
 * medusa-config.ts reads exactly one variable - process.env.DATABASE_URL - and
 * builds nothing from parts, so a surprising hostname is always inside that
 * string. What is not obvious is who supplied it: the environment, a .env this
 * wrapper read, or a .env the bundle reads on its own. Printing the host with
 * its provenance turns "where is that name coming from" into something the
 * boot log answers by itself.
 *
 * The password is redacted. Everything else - user, host, port, database - is
 * what you need in order to compare against the dashboard.
 */
function describeDatabaseUrl(raw) {
  if (!raw) return "DATABASE_URL is NOT SET"

  let url
  try {
    url = new URL(raw)
  } catch {
    // Do not echo an unparseable value; it may still contain the password.
    return `DATABASE_URL is set but is not a parseable URL (${raw.length} chars)`
  }

  return [
    `host=${url.hostname || "(empty)"}`,
    `port=${url.port || "(default)"}`,
    `database=${url.pathname.replace(/^\//, "") || "(none)"}`,
    `user=${url.username || "(none)"}`,
    `password=${url.password ? "[redacted]" : "(none)"}`,
  ].join(" ")
}

function reportDatabaseConfig() {
  const raw = process.env.DATABASE_URL
  const origin = ENV_SOURCE.get("DATABASE_URL")

  console.log("[start-backend] Database configuration:")
  console.log(`[start-backend]   ${describeDatabaseUrl(raw)}`)
  console.log(
    `[start-backend]   supplied by: ${
      origin ? `this wrapper, from ${origin}` : raw ? "the environment" : "nothing"
    }`
  )

  /*
   * Names only, never values - several of these hold credentials. The point is
   * to reveal a variable nobody expected to be there, which is the usual
   * explanation for a hostname that appears from nowhere.
   */
  const related = Object.keys(process.env)
    .filter((key) => /(^|_)(DB|DATABASE|POSTGRES|PG|MYSQL|REDIS)([_0-9]|$)/i.test(key))
    .sort()
  console.log(
    `[start-backend]   other DB-ish variables visible: ${
      related.length ? related.join(", ") : "(none)"
    }`
  )

  /*
   * The bundle runs dotenv against its own directory, so these files can also
   * fill a DATABASE_URL that this wrapper never sees. NODE_ENV=production
   * pulls in .env.production alongside .env.
   */
  const bundleEnvFiles = [".env", `.env.${process.env.NODE_ENV || "development"}`]
    .map((name) => path.join(SERVER_DIR, name))
    .filter((file) => fs.existsSync(file))

  if (bundleEnvFiles.length) {
    console.log(
      `[start-backend]   NOTE: the server reads these on its own, and either\n` +
        `[start-backend]   can supply a DATABASE_URL independently of the above:\n` +
        bundleEnvFiles.map((f) => `[start-backend]     ${f}`).join("\n")
    )
  }
}

reportDatabaseConfig()

/*
 * Predeploy: migrate before serving.
 *
 * There is no SSH on this host, so a migration has no other route in - it has
 * to ride along with the boot. `db:migrate` is idempotent, so running it on
 * every restart is a no-op once the schema is current.
 *
 * A failure here is deliberately NOT fatal: the alternative is an app that
 * refuses to boot, and a running server is what makes the logs and the admin
 * reachable at all. The trade is real though - if this fails, the server comes
 * up against a schema that may be behind the code, and the symptom will be
 * 500s from routes rather than anything that looks like a migration problem.
 * Hence the banner: this must not scroll past unnoticed.
 */
/*
 * Bounded, because `db:migrate` does not fail on an unreachable database - it
 * retries the connection indefinitely. Unbounded, a wrong DATABASE_URL would
 * hang the boot rather than skipping, and "skip on failure" needs a failure
 * that actually arrives. Raise MIGRATION_TIMEOUT_MS if a real migration ever
 * needs longer than this.
 */
const MIGRATION_TIMEOUT_MS = Number(process.env.MIGRATION_TIMEOUT_MS ?? 300_000)

function migrate() {
  /*
   * Run the CLI's JS entry with this same node binary, rather than going
   * through `npx medusa` or a shell.
   *
   * Both of those put a process in between: spawnSync's timeout kills only its
   * direct child, and the real migration - a grandchild - survives holding the
   * inherited stdio, so spawnSync blocks long past its own deadline and the
   * timeout does nothing. One child means the timeout can actually land.
   */
  let cli
  try {
    cli = require.resolve("@medusajs/cli", { paths: [SERVER_DIR] })
  } catch (error) {
    warn(`Could not find the Medusa CLI in ${SERVER_DIR}: ${error.message}`)
    return
  }

  console.log(
    `[start-backend] Running migrations (up to ${Math.round(MIGRATION_TIMEOUT_MS / 1000)}s)...`
  )

  const result = spawnSync(process.execPath, [cli, "db:migrate"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
    env: process.env,
    timeout: MIGRATION_TIMEOUT_MS,
  })

  // A timeout arrives as result.error with code ETIMEDOUT, not as a status.
  if (result.error) {
    warn(
      result.error.code === "ETIMEDOUT"
        ? `Migrations timed out after ${MIGRATION_TIMEOUT_MS}ms. An ` +
            `unreachable database looks exactly like this, because ` +
            `db:migrate retries the connection rather than failing - so ` +
            `check DATABASE_URL first.`
        : `Migrations could not be run: ${result.error.message}`
    )
    return
  }
  if (result.status !== 0) {
    warn(
      result.signal
        ? `Migrations were killed by ${result.signal}.`
        : `Migrations exited ${result.status}.`
    )
    return
  }

  console.log("[start-backend] Migrations complete.")
}

function warn(message) {
  const line = "!".repeat(72)
  console.error(
    `\n${line}\n[start-backend] MIGRATIONS DID NOT RUN\n${message}\n` +
      `Starting the server anyway. The database schema may be behind the\n` +
      `code, which shows up as 500s from the API rather than as a migration\n` +
      `error. Check the lines above this banner for the cause.\n${line}\n`
  )
}

migrate()

/*
 * One-shot admin bootstrap, for a host with no SSH.
 *
 * Runs only when ADMIN_EMAIL and ADMIN_PASSWORD are both set, and only after
 * migrations, since it writes to the user table. It is safe on every restart:
 * `medusa user` is not idempotent - a second run exits 1 with "User with
 * email: ..., already exists." - so that specific failure is read as "already
 * done" and everything else is reported as a real problem.
 *
 * Like the migration step this is non-fatal. A server that boots is what makes
 * the admin reachable, and refusing to start because an account already exists
 * would be perverse.
 *
 * The password is never logged. Note that it IS passed as a command-line
 * argument, because that is the only interface the CLI offers, so it is
 * briefly visible to anyone who can list processes on the host. Once the admin
 * exists, clear ADMIN_PASSWORD from the app's environment.
 */
const ADMIN_TIMEOUT_MS = Number(process.env.ADMIN_TIMEOUT_MS ?? 180_000)

function createAdminUser() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    // Silent unless one is set without the other, which is a typo worth
    // pointing at rather than ignoring.
    if (email || password) {
      console.error(
        `[start-backend] ${email ? "ADMIN_EMAIL" : "ADMIN_PASSWORD"} is set but ` +
          `${email ? "ADMIN_PASSWORD" : "ADMIN_EMAIL"} is not; no admin user created.`
      )
    }
    return
  }

  let cli
  try {
    cli = require.resolve("@medusajs/cli", { paths: [SERVER_DIR] })
  } catch (error) {
    console.error(`[start-backend] Cannot create admin: ${error.message}`)
    return
  }

  console.log(`[start-backend] Ensuring admin user ${email} exists...`)

  /*
   * Piped rather than inherited, so the output can be classified before it is
   * shown. The CLI prints a full stack for a duplicate, which is alarming and
   * meaningless in the ordinary case where the account is simply already there.
   */
  const result = spawnSync(process.execPath, [cli, "user", "-e", email, "-p", password], {
    cwd: SERVER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    timeout: ADMIN_TIMEOUT_MS,
    encoding: "utf8",
  })

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`

  if (result.error) {
    console.error(
      `[start-backend] Admin user step failed: ${
        result.error.code === "ETIMEDOUT"
          ? `timed out after ${ADMIN_TIMEOUT_MS}ms`
          : result.error.message
      }`
    )
    return
  }

  if (result.status === 0) {
    console.log(`[start-backend] Admin user ${email} created.`)
    console.log(
      "[start-backend] Remove ADMIN_PASSWORD from the app environment now that it exists."
    )
    return
  }

  if (/already exists/i.test(output)) {
    console.log(`[start-backend] Admin user ${email} already exists; nothing to do.`)
    return
  }

  // Unclassified: show the child's own output, since it is the only clue.
  console.error(
    `[start-backend] Could not create admin user ${email} (exit ${result.status}).\n` +
      output.trim()
  )
}

createAdminUser()

/*
 * Windows needs shell: true, because since CVE-2024-27980 Node refuses to
 * spawn a .cmd file without one. Linux - which is what Cloudways runs - must
 * NOT have it: a shell layer would swallow the signals forwarded below, so
 * PM2 could no longer stop the server cleanly.
 */
const child = spawn(isWindows ? "npm.cmd" : "npm", ["run", "start"], {
  cwd: SERVER_DIR,
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
})

/*
 * PM2 signals this process, not the child. Without forwarding, a stop or
 * restart would kill the wrapper and leave Medusa holding the port, so the
 * next boot fails on EADDRINUSE.
 */
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on("error", (error) => {
  console.error(`[start-backend] Could not start: ${error.message}`)
  process.exit(1)
})

// Exit with whatever the child exited with, so PM2 sees the real outcome. A
// signalled death has no code; report it the way a shell would.
child.on("exit", (code, signal) => {
  process.exit(code === null ? 128 + (require("node:os").constants.signals[signal] ?? 0) : code)
})
