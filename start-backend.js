/**
 * PM2 entry file for the Medusa backend.
 *
 * Cloudways runs an Entry File through PM2, which wants a path to a JS file
 * rather than a shell command. `medusa build` emits a self-contained app in
 * apps/backend/.medusa/server - with its own package.json and its own start
 * script - so the thing that actually has to run lives two directories down
 * from here. This spawns it and gets out of the way.
 *
 * It does NOT install dependencies. .medusa/server ships without node_modules,
 * so `npm install --omit=dev` has to run there as part of the BUILD step; doing
 * it here would reinstall on every restart and stall the boot.
 */

const { spawn } = require("node:child_process")
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
