const { spawn } = require("node:child_process")
const fs = require("node:fs/promises")
const path = require("node:path")

const DEFAULT_ROUTES = [
  "/",
  "/product/timeless-iphone-17-pro-max/?case=signature",
  "/product/legends-iphone-17-pro-max/?case=signature",
  "/product/gear-heads-iphone-17-pro-max/?case=signature",
  "/shop/iphone-17-pro-max/signature/",
  "/collection/muse-marvel/",
]

const HELP = `Sequential, read-only HTTP checks; these are not browser or LCP measurements.
Requires curl 7.83+ (curl.exe on Windows). Response bodies are counted and discarded.

Usage: npm run perf:check -- [options]
  --base URL                    Default https://new.florayn.com; only this host
                                or explicit localhost/127.0.0.1/[::1] is allowed.
  --route /path/                Repeat to replace the default six routes.
  --routes routes.json          JSON array of relative route strings.
  --modes document,rsc          Separate request types (default both).
  --samples N                   Samples per route and mode (default 2, max 5).
  --delay-ms N                  Delay between requests (default 500).
  --timeout-seconds N           Per-request timeout (default 20).
  --output report.json          Also save the metadata report to this file.
  --enforce                     Exit nonzero on HTTP/type errors or budget failures.
  --warm-ttfb-ms N              Warm HTTP TTFB budget (default 1000).
  --warm-total-ms N             Warm HTTP response budget (default 1500).
  --max-rsc-bytes N             Decoded RSC body budget (default 400000).
  --max-document-bytes N        Decoded HTML body budget (default 900000).
  --help                       Show this message without making requests.

Timing budgets use samples after the first, with CF HIT or Next HIT evidence.
Without warm evidence, enforcement reports an inconclusive check as a failure.
Redirects are reported and never followed. No credentials or .env files are read.
`

function validateBase(value) {
  const url = new URL(value)
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.hostname !== "new.florayn.com" && !local) {
    throw new Error("Only new.florayn.com or an explicitly selected localhost fixture is allowed")
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (!local && (url.protocol !== "https:" || url.port)) ||
      !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Base must be an origin without credentials, a path, query or fragment; new.florayn.com requires HTTPS")
  }
  return url.origin
}

function validateRoute(value, base) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Routes must be relative paths beginning with one slash")
  }
  const url = new URL(value, base)
  if (url.origin !== base || url.username || url.password || url.hash) {
    throw new Error("Routes must stay on the selected origin and cannot contain fragments or credentials")
  }
  return `${url.pathname}${url.search}`
}

async function parseOptions(argv) {
  const options = {
    base: "https://new.florayn.com", routes: [], modes: ["document", "rsc"], samples: 2,
    delayMs: 500, timeoutSeconds: 20, output: null, enforce: false,
    warmTtfbMs: 1000, warmTotalMs: 1500, maxRscBytes: 400000, maxDocumentBytes: 900000,
  }
  const numbers = {
    "--samples": ["samples", 2, 5], "--delay-ms": ["delayMs", 0, 60000],
    "--timeout-seconds": ["timeoutSeconds", 1, 120],
    "--warm-ttfb-ms": ["warmTtfbMs", 1, 120000], "--warm-total-ms": ["warmTotalMs", 1, 120000],
    "--max-rsc-bytes": ["maxRscBytes", 1, 10000000], "--max-document-bytes": ["maxDocumentBytes", 1, 10000000],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === "--help") return { help: true }
    if (flag === "--enforce") { options.enforce = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    if (numbers[flag]) {
      const [key, min, max] = numbers[flag]
      const number = Number(value)
      if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${flag} must be an integer from ${min} to ${max}`)
      options[key] = number
    } else if (flag === "--base") options.base = value
    else if (flag === "--route") options.routes.push(value)
    else if (flag === "--routes") {
      const routes = JSON.parse(await fs.readFile(value, "utf8"))
      if (!Array.isArray(routes)) throw new Error("The routes file must contain a JSON array")
      options.routes.push(...routes)
    } else if (flag === "--modes") options.modes = value.split(",")
    else if (flag === "--output") options.output = value
    else throw new Error(`Unknown option ${flag}`)
  }
  options.base = validateBase(options.base)
  if (!options.routes.length) {
    if (new URL(options.base).hostname !== "new.florayn.com") {
      throw new Error("Pass --route or --routes explicitly for a local fixture")
    }
    options.routes = DEFAULT_ROUTES
  }
  if (!options.modes.length || options.modes.some((mode) => !["document", "rsc"].includes(mode))) {
    throw new Error("Modes must be document, rsc, or document,rsc")
  }
  options.modes = [...new Set(options.modes)]
  options.routes = [...new Set(options.routes.map((route) => validateRoute(route, options.base)))]
  return options
}

function measure(base, route, mode, timeoutSeconds) {
  // Revalidate at the request boundary, including callers importing this helper.
  base = validateBase(base)
  route = validateRoute(route, base)
  const marker = "\nFLORAYN_PERF:"
  const headersMarker = "\nFLORAYN_HEADERS:"
  const args = [
    "--disable", "--silent", "--show-error", "--compressed", "--request", "GET",
    "--proto", "=http,https", "--max-time", String(timeoutSeconds),
    "--connect-timeout", String(Math.min(10, timeoutSeconds)), "--max-filesize", "10000000",
    "--url", `${base}${route}`,
    "--write-out", `%{stderr}${marker}%{json}${headersMarker}%{header_json}\n`,
    "--header", mode === "rsc" ? "Accept: */*" : "Accept: text/html",
    "--header", mode === "rsc" ? "Sec-Fetch-Dest: empty" : "Sec-Fetch-Dest: document",
  ]
  if (mode === "rsc") args.push("--header", "RSC: 1")
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", args, {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    })
    let decodedBytes = 0, metadata = "", spawnError = false
    child.stdout.on("data", (chunk) => { decodedBytes += chunk.length })
    child.stderr.on("data", (chunk) => { metadata += chunk.toString() })
    child.on("error", () => { spawnError = true })
    child.on("close", (code) => {
      if (spawnError) return resolve({ error: "curl could not be started; install curl 7.83 or newer", decodedBytes })
      try {
        const sections = metadata.split(marker).at(-1).split(headersMarker)
        const stats = JSON.parse(sections[0])
        const headers = JSON.parse(sections[1])
        const header = (name) => headers[name]?.[0] ?? null
        const cfCache = header("cf-cache-status")
        const nextCache = header("x-nextjs-cache")
        const contentType = header("content-type")
        const sample = {
          status: stats.http_code,
          ttfbMs: Math.round(stats.time_starttransfer * 1000),
          totalMs: Math.round(stats.time_total * 1000),
          decodedBytes,
          transferBytes: stats.size_download,
          cfCache, nextCache, age: header("age"), contentType,
          warmCacheEvidence: cfCache === "HIT" || nextCache === "HIT",
        }
        if (code !== 0) sample.error = `curl exited with code ${code}`
        else if (sample.status !== 200) sample.error = `HTTP ${sample.status}; redirects are not followed`
        else if (!contentType?.toLowerCase().includes(mode === "rsc" ? "text/x-component" : "text/html")) {
          sample.error = `Unexpected content type for ${mode}`
        }
        resolve(sample)
      } catch {
        resolve({ error: `Missing curl measurement metadata (exit ${code}); curl 7.83+ is required`, decodedBytes })
      }
    })
  })
}

function budgetFailures(results, options) {
  const failures = []
  for (const result of results) {
    const byteLimit = result.mode === "rsc" ? options.maxRscBytes : options.maxDocumentBytes
    for (const sample of result.samples) {
      const context = { route: result.route, mode: result.mode, sample: sample.sample }
      if (sample.error) failures.push({ ...context, reason: sample.error })
      if (sample.decodedBytes > byteLimit) failures.push({ ...context, reason: "decoded-byte-budget", actual: sample.decodedBytes, limit: byteLimit })
      if (sample.sample === 1 || sample.error) continue
      if (!sample.warmCacheEvidence) {
        failures.push({ ...context, reason: "warm-cache-not-verified" })
        continue
      }
      if (sample.ttfbMs > options.warmTtfbMs) failures.push({ ...context, reason: "warm-http-ttfb-budget", actual: sample.ttfbMs, limit: options.warmTtfbMs })
      if (sample.totalMs > options.warmTotalMs) failures.push({ ...context, reason: "warm-http-total-budget", actual: sample.totalMs, limit: options.warmTotalMs })
    }
  }
  return failures
}

async function runBenchmark(options) {
  const results = []
  let first = true
  for (const route of options.routes) {
    for (const mode of options.modes) {
      const samples = []
      for (let sample = 1; sample <= options.samples; sample += 1) {
        if (!first && options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
        first = false
        samples.push({ sample, ...await measure(options.base, route, mode, options.timeoutSeconds) })
      }
      results.push({ route, mode, samples })
    }
  }
  const failures = budgetFailures(results, options)
  return {
    generatedAt: new Date().toISOString(),
    measurement: "HTTP only. TTFB and response completion do not measure browser rendering or LCP.",
    base: options.base,
    budgets: {
      warmTtfbMs: options.warmTtfbMs, warmTotalMs: options.warmTotalMs,
      maxRscBytes: options.maxRscBytes, maxDocumentBytes: options.maxDocumentBytes,
    },
    results,
    summary: {
      requests: results.reduce((sum, result) => sum + result.samples.length, 0),
      requestErrors: results.flatMap((result) => result.samples).filter((sample) => sample.error).length,
      enforced: options.enforce,
      budgetFailures: failures,
    },
  }
}

async function main() {
  const options = await parseOptions(process.argv.slice(2))
  if (options.help) return process.stdout.write(HELP)
  const report = await runBenchmark(options)
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) {
    await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
    await fs.writeFile(options.output, json)
  }
  process.stdout.write(json)
  if (report.summary.requestErrors || (options.enforce && report.summary.budgetFailures.length)) process.exitCode = 1
}

module.exports = { parseOptions, validateBase, validateRoute, measure, budgetFailures, runBenchmark }
if (require.main === module) main().catch((error) => {
  process.stderr.write(`perf:check: ${error.message}\n`)
  process.exitCode = 2
})
