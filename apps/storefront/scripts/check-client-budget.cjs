// Client JS budget gate (TRACKING.md section 11, review issue B7). CI builds the
// merge-base and the head in one job with the same fixture environment, and this
// compares the two builds. A committed baseline cannot work: content hashes, the
// platform and the webpack chunk map move the numbers between machines.
// Node built-ins only, so it needs no install of its own.
const fs = require("node:fs")
const path = require("node:path")
const zlib = require("node:zlib")

const PAGE_KEYS = ["/page", "/shop/page", "/collection/[slug]/page", "/product/[slug]/page", "/checkout/page"]
const RUNTIME_MARKER = "fl-runtime-v1"

// Gzip (level 9) bytes. Every page's first load contains the webpack runtime and
// the layout set, so a page allowance sits on top of those two deltas.
const BUDGETS = Object.freeze({
  framework: 0,
  webpack: 64,
  layout: 1200,
  pages: Object.freeze({
    "/page": 32,
    "/shop/page": 32,
    "/collection/[slug]/page": 32,
    "/product/[slug]/page": 300,
    "/checkout/page": 800,
  }),
  runtime: 6000,
})

const USAGE = `Usage: node apps/storefront/scripts/check-client-budget.cjs --base <base .next dir> --head <head .next dir> [--json]

Compares two storefront builds made with the same fixture environment
(TRACKING.md section 11): .js files only, gzip level 9, the layout set unioned
into each page's first load. Exit 0 within budget, 1 on a budget failure, 2 on
bad arguments or an unreadable build.
`

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length
}

function readJson(file) {
  let text
  try { text = fs.readFileSync(file, "utf8") } catch (error) {
    throw new Error(`Cannot read ${file} (${error.code || error.message})`)
  }
  try { return JSON.parse(text) } catch { throw new Error(`${file} is not valid JSON`) }
}

// Manifest paths are relative to .next, e.g. "static/chunks/app/layout-1a2b.js".
function jsFiles(list) {
  return Array.isArray(list) ? list.filter((file) => typeof file === "string" && file.endsWith(".js")) : []
}

function isWebpackRuntime(file) {
  return path.posix.basename(file).startsWith("webpack-")
}

function insideDir(dir, file) {
  const absolute = path.resolve(dir, file)
  const relative = path.relative(dir, absolute)
  if (!relative || relative.split(path.sep)[0] === ".." || path.isAbsolute(relative)) {
    throw new Error(`Manifest entry ${file} points outside ${dir}`)
  }
  return absolute
}

// Every .js file under static/chunks whose text contains the marker. The lazy
// tracking runtime carries "fl-runtime-v1", so it must be exactly one chunk.
function findMarkerChunks(nextDir, marker = RUNTIME_MARKER, { sizeOf = gzipSize } = {}) {
  const dir = path.resolve(nextDir)
  const found = []
  const walk = (current) => {
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch (error) {
      if (error.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const buffer = fs.readFileSync(full)
        if (!buffer.includes(marker)) continue
        const file = path.relative(dir, full).split(path.sep).join("/")
        found.push({ file, gz: sizeOf(buffer, file) })
      }
    }
  }
  walk(path.join(dir, "static", "chunks"))
  return found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

function measureBuild(nextDir, { sizeOf = gzipSize } = {}) {
  const dir = path.resolve(nextDir)
  const buildManifestPath = path.join(dir, "build-manifest.json")
  const appManifestPath = path.join(dir, "app-build-manifest.json")
  const buildManifest = readJson(buildManifestPath)
  const appManifest = readJson(appManifestPath)
  if (!Array.isArray(buildManifest?.rootMainFiles)) throw new Error(`${buildManifestPath} has no rootMainFiles list`)
  const pages = appManifest?.pages
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) throw new Error(`${appManifestPath} has no pages map`)

  const warnings = []
  const sizes = new Map()
  const sizeOfFile = (file) => {
    if (!sizes.has(file)) {
      const absolute = insideDir(dir, file)
      let buffer
      try { buffer = fs.readFileSync(absolute) } catch (error) {
        throw new Error(`Cannot read ${file} listed in ${dir} (${error.code || error.message})`)
      }
      sizes.set(file, sizeOf(buffer, file))
    }
    return sizes.get(file)
  }
  // A file listed by several sets (layout and page, say) is counted once.
  const group = (files) => {
    const unique = [...new Set(files)]
    return { files: unique, gz: unique.reduce((sum, file) => sum + sizeOfFile(file), 0) }
  }

  const root = jsFiles(buildManifest.rootMainFiles)
  const rootSet = new Set(root)
  if (!root.some(isWebpackRuntime)) warnings.push("rootMainFiles has no webpack-*.js runtime")
  if (!Object.hasOwn(pages, "/layout")) warnings.push("\"/layout\" is missing from app-build-manifest.json")
  const layout = jsFiles(pages["/layout"]).filter((file) => !rootSet.has(file))
  const firstLoad = {}
  for (const key of PAGE_KEYS) {
    if (!Object.hasOwn(pages, key)) {
      warnings.push(`"${key}" is missing from app-build-manifest.json`)
      firstLoad[key] = null
      continue
    }
    firstLoad[key] = group([...root, ...layout, ...jsFiles(pages[key])])
  }

  return {
    dir,
    framework: group(root.filter((file) => !isWebpackRuntime(file))),
    webpack: group(root.filter(isWebpackRuntime)),
    layout: group(layout),
    pages: firstLoad,
    runtime: findMarkerChunks(dir, RUNTIME_MARKER, { sizeOf }),
    warnings,
  }
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value)
}

function compareBuilds(base, head) {
  const rows = []
  const failures = []
  const warnings = [
    ...base.warnings.map((warning) => `base: ${warning}`),
    ...head.warnings.map((warning) => `head: ${warning}`),
  ]

  const frameworkDelta = head.framework.gz - base.framework.gz
  const frameworkOk = frameworkDelta === BUDGETS.framework
  rows.push({ measure: "framework (rootMainFiles)", base: base.framework.gz, head: head.framework.gz, delta: frameworkDelta, limit: BUDGETS.framework, rule: "= 0", ok: frameworkOk })
  if (!frameworkOk) failures.push(`framework chunks changed by ${signed(frameworkDelta)} B gz; they must stay exactly +0 B`)

  const webpackDelta = head.webpack.gz - base.webpack.gz
  const webpackOk = webpackDelta <= BUDGETS.webpack
  rows.push({ measure: "webpack runtime", base: base.webpack.gz, head: head.webpack.gz, delta: webpackDelta, limit: BUDGETS.webpack, rule: `<= ${BUDGETS.webpack}`, ok: webpackOk })
  if (!webpackOk) failures.push(`webpack runtime grew by ${signed(webpackDelta)} B gz (budget +${BUDGETS.webpack} B)`)

  const layoutDelta = head.layout.gz - base.layout.gz
  const layoutOk = layoutDelta <= BUDGETS.layout
  rows.push({ measure: "/layout set", base: base.layout.gz, head: head.layout.gz, delta: layoutDelta, limit: BUDGETS.layout, rule: `<= ${BUDGETS.layout}`, ok: layoutOk })
  if (!layoutOk) failures.push(`"/layout" set grew by ${signed(layoutDelta)} B gz (budget +${BUDGETS.layout} B)`)

  for (const key of PAGE_KEYS) {
    const limit = webpackDelta + layoutDelta + BUDGETS.pages[key]
    const before = base.pages[key]
    const after = head.pages[key]
    if (!before || !after) {
      const missing = !before && !after ? "both builds" : !before ? "the base build" : "the head build"
      rows.push({ measure: key, base: before?.gz ?? null, head: after?.gz ?? null, delta: null, limit, rule: `<= ${limit}`, ok: true, skipped: true, note: `missing from ${missing}` })
      continue
    }
    const delta = after.gz - before.gz
    const ok = delta <= limit
    rows.push({ measure: key, base: before.gz, head: after.gz, delta, limit, rule: `<= ${limit}`, ok })
    if (!ok) {
      failures.push(`"${key}" first load grew by ${signed(delta)} B gz (budget ${signed(limit)} B = webpack ${signed(webpackDelta)} + layout ${signed(layoutDelta)} + ${BUDGETS.pages[key]})`)
    }
  }

  // The runtime limit is absolute and applies to the head only.
  const total = (chunks) => (chunks.length ? chunks.reduce((sum, chunk) => sum + chunk.gz, 0) : null)
  const runtimeBase = total(base.runtime)
  const runtimeHead = total(head.runtime)
  const runtimeRow = {
    measure: `lazy runtime chunk (${RUNTIME_MARKER})`,
    base: runtimeBase,
    head: runtimeHead,
    delta: runtimeBase !== null && runtimeHead !== null ? runtimeHead - runtimeBase : null,
    limit: BUDGETS.runtime,
    rule: `<= ${BUDGETS.runtime} total`,
    ok: true,
  }
  if (head.runtime.length > 1) {
    runtimeRow.ok = false
    runtimeRow.note = head.runtime.map((chunk) => chunk.file).join(", ")
    failures.push(`"${RUNTIME_MARKER}" is in ${head.runtime.length} chunks (${runtimeRow.note}); the lazy runtime must be one chunk`)
  } else if (head.runtime.length === 1) {
    const [chunk] = head.runtime
    runtimeRow.note = chunk.file
    if (chunk.gz > BUDGETS.runtime) {
      runtimeRow.ok = false
      failures.push(`lazy runtime chunk ${chunk.file} is ${chunk.gz} B gz (budget ${BUDGETS.runtime} B)`)
    }
  } else {
    runtimeRow.note = "no chunk contains the marker"
  }
  rows.push(runtimeRow)

  return { rows, failures, warnings }
}

function formatReport(result, base, head) {
  const header = ["measure", "base", "head", "delta", "limit", "ok"]
  const cell = (value) => (value === null || value === undefined ? "-" : String(value))
  const body = result.rows.map((row) => [
    row.measure, cell(row.base), cell(row.head), row.delta === null ? "-" : signed(row.delta),
    row.rule, row.skipped ? "skip" : row.ok ? "ok" : "FAIL",
  ])
  const widths = header.map((_, index) => Math.max(...[header, ...body].map((cells) => cells[index].length)))
  const line = (cells) => cells.map((text, index) => (index === 0 ? text.padEnd(widths[index]) : text.padStart(widths[index]))).join("  ")
  const lines = [
    "Client JS budget: gzip level 9 bytes, .js only, merge-base vs head",
    `base ${base.dir}`,
    `head ${head.dir}`,
    "",
    line(header),
    line(widths.map((width) => "-".repeat(width))),
    ...body.map(line),
  ]
  const notes = result.rows.filter((row) => row.note)
  if (notes.length) lines.push("", "Notes:", ...notes.map((row) => `  ${row.measure}: ${row.note}`))
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `  ${warning}`))
  lines.push("", ...(result.failures.length
    ? ["Failures:", ...result.failures.map((failure) => `  ${failure}`)]
    : ["Within budget."]))
  return `${lines.join("\n")}\n`
}

function parseArgs(argv) {
  const options = { json: false, help: false, base: null, head: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") options.json = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--base" || arg === "--head") {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a directory`)
      options[arg.slice(2)] = value
      index += 1
    } else throw new Error(`Unknown argument ${arg}`)
  }
  if (!options.help && (!options.base || !options.head)) throw new Error("Both --base and --head are required")
  return options
}

function main(argv) {
  let options
  try { options = parseArgs(argv) } catch (error) {
    process.stderr.write(`check-client-budget: ${error.message}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }
  let base, head
  try {
    base = measureBuild(options.base)
    head = measureBuild(options.head)
  } catch (error) {
    process.stderr.write(`check-client-budget: ${error.message}\n`)
    return 2
  }
  const result = compareBuilds(base, head)
  process.stdout.write(options.json
    ? `${JSON.stringify({ base: base.dir, head: head.dir, ...result }, null, 2)}\n`
    : formatReport(result, base, head))
  return result.failures.length ? 1 : 0
}

module.exports = { measureBuild, compareBuilds, findMarkerChunks, BUDGETS, PAGE_KEYS }
if (require.main === module) process.exitCode = main(process.argv.slice(2))
