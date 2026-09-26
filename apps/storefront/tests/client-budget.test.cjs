// Tests for the client JS budget gate (TRACKING.md section 11, B7): fake .next
// dirs under the OS temp dir, with sizes set through the injectable sizeOf, so
// every budget boundary is exercised without a real Next.js build.
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const zlib = require("node:zlib")

const SCRIPT = path.join(__dirname, "../scripts/check-client-budget.cjs")
const { measureBuild, compareBuilds, findMarkerChunks, BUDGETS, PAGE_KEYS } = require(SCRIPT)

const MARKER = "fl-runtime-v1"
// Each fake file states its size as "@size N"; files without one measure as real gzip.
const sizeOf = (buffer) => {
  const match = /@size (\d+)/.exec(buffer.toString("utf8"))
  return match ? Number(match[1]) : zlib.gzipSync(buffer, { level: 9 }).length
}

const ROOT = [
  "static/chunks/webpack-a1.js",
  "static/chunks/4bd1b696-a1.js",
  "static/chunks/1255-a1.js",
  "static/chunks/main-app-a1.js",
]

// Shaped like the real Next 15 manifests: every entry repeats rootMainFiles,
// "/layout" and several pages share chunks, and some entries carry CSS.
function baseSpec() {
  return {
    files: {
      "static/chunks/webpack-a1.js": 1881,
      "static/chunks/4bd1b696-a1.js": 54359,
      "static/chunks/1255-a1.js": 46535,
      "static/chunks/main-app-a1.js": 224,
      "static/chunks/2619-a1.js": 5000,
      "static/chunks/1356-a1.js": 3000,
      "static/chunks/7300-a1.js": 2000,
      "static/chunks/4723-a1.js": 1000,
      "static/chunks/app/layout-a1.js": 4964,
      "static/chunks/6070-a1.js": 800,
      "static/chunks/5661-a1.js": 9000,
      "static/chunks/1911-a1.js": 7000,
      "static/chunks/app/page-a1.js": 1200,
      "static/chunks/app/shop/page-a1.js": 1500,
      "static/chunks/app/collection/[slug]/page-a1.js": 900,
      "static/chunks/app/product/[slug]/page-a1.js": 20000,
      "static/chunks/app/checkout/page-a1.js": 6000,
      "static/css/layout-a1.css": 90000,
      "static/css/checkout-a1.css": 40000,
    },
    rootMainFiles: [...ROOT],
    pages: {
      "/layout": [...ROOT, "static/css/layout-a1.css", "static/chunks/2619-a1.js", "static/chunks/1356-a1.js",
        "static/chunks/7300-a1.js", "static/chunks/4723-a1.js", "static/chunks/app/layout-a1.js"],
      "/page": [...ROOT, "static/chunks/2619-a1.js", "static/chunks/4723-a1.js", "static/chunks/6070-a1.js",
        "static/chunks/app/page-a1.js"],
      "/shop/page": [...ROOT, "static/chunks/2619-a1.js", "static/chunks/5661-a1.js", "static/chunks/app/shop/page-a1.js"],
      "/collection/[slug]/page": [...ROOT, "static/chunks/1356-a1.js", "static/chunks/app/collection/[slug]/page-a1.js"],
      "/product/[slug]/page": [...ROOT, "static/chunks/2619-a1.js", "static/chunks/5661-a1.js",
        "static/chunks/app/product/[slug]/page-a1.js"],
      "/checkout/page": [...ROOT, "static/css/checkout-a1.css", "static/chunks/1911-a1.js",
        "static/chunks/app/checkout/page-a1.js"],
      "/order/[id]/page": [...ROOT, "static/chunks/app/order/[id]/page-a1.js"],
    },
  }
}

const OWN_CHUNK = {
  "/page": "static/chunks/app/page-a1.js",
  "/shop/page": "static/chunks/app/shop/page-a1.js",
  "/collection/[slug]/page": "static/chunks/app/collection/[slug]/page-a1.js",
  "/product/[slug]/page": "static/chunks/app/product/[slug]/page-a1.js",
  "/checkout/page": "static/chunks/app/checkout/page-a1.js",
}

function writeBuild(t, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-budget-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const next = path.join(dir, ".next")
  const files = { ...spec.files }
  // Manifest entries without an explicit size still need a file on disk.
  for (const list of [spec.rootMainFiles, ...Object.values(spec.pages)]) {
    for (const file of list) if (!(file in files)) files[file] = 100
  }
  for (const [file, value] of Object.entries(files)) {
    const { size, text = "" } = typeof value === "number" ? { size: value } : value
    const target = path.join(next, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, size === null ? text : `/* ${file} @size ${size} */\n${text}\n`)
  }
  fs.writeFileSync(path.join(next, "build-manifest.json"), JSON.stringify({
    polyfillFiles: ["static/chunks/polyfills-a1.js"], rootMainFiles: spec.rootMainFiles, pages: { "/_app": [] },
  }))
  fs.writeFileSync(path.join(next, "app-build-manifest.json"), JSON.stringify({ pages: spec.pages }))
  return next
}

function compare(t, base, head) {
  return compareBuilds(measureBuild(writeBuild(t, base), { sizeOf }), measureBuild(writeBuild(t, head), { sizeOf }))
}

function rowFor(result, measure) {
  return result.rows.find((row) => row.measure === measure || row.measure.startsWith(measure))
}

function grown(changes) {
  const spec = baseSpec()
  for (const [file, delta] of Object.entries(changes)) spec.files[file] += delta
  return spec
}

function runCli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("exports the budgets and page keys of TRACKING.md section 11", () => {
  assert.deepEqual(PAGE_KEYS, ["/page", "/shop/page", "/collection/[slug]/page", "/product/[slug]/page", "/checkout/page"])
  assert.equal(BUDGETS.framework, 0)
  assert.equal(BUDGETS.webpack, 64)
  assert.equal(BUDGETS.layout, 1200)
  assert.equal(BUDGETS.runtime, 6000)
  assert.deepEqual({ ...BUDGETS.pages }, {
    "/page": 32, "/shop/page": 32, "/collection/[slug]/page": 32, "/product/[slug]/page": 300, "/checkout/page": 800,
  })
})

test("measures framework, webpack, layout and page first loads from .js files only, each file once", (t) => {
  const build = measureBuild(writeBuild(t, baseSpec()), { sizeOf })
  assert.deepEqual(build.webpack, { files: ["static/chunks/webpack-a1.js"], gz: 1881 })
  assert.deepEqual(build.framework.files, ROOT.slice(1))
  assert.equal(build.framework.gz, 54359 + 46535 + 224)
  const layoutFiles = ["static/chunks/2619-a1.js", "static/chunks/1356-a1.js", "static/chunks/7300-a1.js",
    "static/chunks/4723-a1.js", "static/chunks/app/layout-a1.js"]
  assert.deepEqual(build.layout.files, layoutFiles, "rootMainFiles and .css leave the layout set")
  const layout = 5000 + 3000 + 2000 + 1000 + 4964
  assert.equal(build.layout.gz, layout)
  const shared = 1881 + 54359 + 46535 + 224 + layout
  // 2619, 4723 and 1356 sit in both the layout and a page: counted once.
  assert.equal(build.pages["/page"].gz, shared + 800 + 1200)
  assert.equal(new Set(build.pages["/page"].files).size, build.pages["/page"].files.length)
  assert.equal(build.pages["/shop/page"].gz, shared + 9000 + 1500)
  assert.equal(build.pages["/collection/[slug]/page"].gz, shared + 900)
  assert.equal(build.pages["/product/[slug]/page"].gz, shared + 9000 + 20000)
  assert.equal(build.pages["/checkout/page"].gz, shared + 7000 + 6000, "the checkout CSS is not counted")
  assert.ok(!Object.values(build.pages).some((page) => page.files.some((file) => file.endsWith(".css"))))
  assert.deepEqual(build.runtime, [])
  assert.deepEqual(build.warnings, [])
})

test("the default size is gzip level 9 of the file", (t) => {
  const spec = baseSpec()
  const text = "export const x = 1;\n".repeat(200)
  spec.files["static/chunks/webpack-a1.js"] = { size: null, text }
  const build = measureBuild(writeBuild(t, spec))
  assert.equal(build.webpack.gz, zlib.gzipSync(Buffer.from(text), { level: 9 }).length)
})

test("two identical builds pass with zero deltas", (t) => {
  const result = compare(t, baseSpec(), baseSpec())
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.warnings, [])
  for (const row of result.rows.filter((item) => item.delta !== null)) assert.equal(row.delta, 0, row.measure)
  assert.ok(result.rows.every((row) => row.ok))
})

test("framework chunks must stay exactly +0 B", (t) => {
  const same = compare(t, baseSpec(), baseSpec())
  assert.equal(rowFor(same, "framework").ok, true)
  const plusOne = compare(t, baseSpec(), grown({ "static/chunks/1255-a1.js": 1 }))
  assert.equal(rowFor(plusOne, "framework").ok, false)
  assert.equal(rowFor(plusOne, "framework").delta, 1)
  assert.equal(plusOne.failures.length, 1)
  assert.match(plusOne.failures[0], /framework chunks changed by \+1 B gz/)
  const minusOne = compare(t, baseSpec(), grown({ "static/chunks/main-app-a1.js": -1 }))
  assert.equal(rowFor(minusOne, "framework").ok, false, "any framework change needs a look")
})

test("the webpack runtime may grow by at most 64 B", (t) => {
  const at = compare(t, baseSpec(), grown({ "static/chunks/webpack-a1.js": 64 }))
  assert.deepEqual(at.failures, [], "pages absorb the webpack delta in their allowance")
  assert.equal(rowFor(at, "webpack runtime").delta, 64)
  const over = compare(t, baseSpec(), grown({ "static/chunks/webpack-a1.js": 65 }))
  assert.equal(over.failures.length, 1)
  assert.match(over.failures[0], /webpack runtime grew by \+65 B gz \(budget \+64 B\)/)
  assert.equal(rowFor(over, "webpack runtime").ok, false)
})

test("the layout set may grow by at most 1200 B", (t) => {
  const at = compare(t, baseSpec(), grown({ "static/chunks/app/layout-a1.js": 1200 }))
  assert.deepEqual(at.failures, [])
  assert.equal(rowFor(at, "/layout set").delta, 1200)
  assert.equal(rowFor(at, "/product/[slug]/page").delta, 1200)
  const over = compare(t, baseSpec(), grown({ "static/chunks/app/layout-a1.js": 1201 }))
  assert.equal(over.failures.length, 1)
  assert.match(over.failures[0], /"\/layout" set grew by \+1201 B gz \(budget \+1200 B\)/)
})

test("home, shop and collection first loads get 32 B over the webpack and layout deltas", (t) => {
  for (const key of ["/page", "/shop/page", "/collection/[slug]/page"]) {
    const changes = { "static/chunks/webpack-a1.js": 10, "static/chunks/7300-a1.js": 100 }
    const at = compare(t, baseSpec(), grown({ ...changes, [OWN_CHUNK[key]]: 32 }))
    assert.deepEqual(at.failures, [], key)
    assert.equal(rowFor(at, key).delta, 142)
    assert.equal(rowFor(at, key).limit, 142)
    const over = compare(t, baseSpec(), grown({ ...changes, [OWN_CHUNK[key]]: 33 }))
    assert.equal(over.failures.length, 1, key)
    assert.ok(over.failures[0].startsWith(`"${key}" first load grew by +143 B gz (budget +142 B`), over.failures[0])
  }
})

test("product gets 300 B and checkout 800 B over the webpack and layout deltas", (t) => {
  const changes = { "static/chunks/webpack-a1.js": 40, "static/chunks/app/layout-a1.js": 700 }
  const product = OWN_CHUNK["/product/[slug]/page"]
  const checkout = OWN_CHUNK["/checkout/page"]
  const at = compare(t, baseSpec(), grown({ ...changes, [product]: 300, [checkout]: 800 }))
  assert.deepEqual(at.failures, [])
  assert.equal(rowFor(at, "/product/[slug]/page").delta, 1040)
  assert.equal(rowFor(at, "/product/[slug]/page").limit, 1040)
  assert.equal(rowFor(at, "/checkout/page").delta, 1540)
  assert.equal(rowFor(at, "/checkout/page").limit, 1540)
  const over = compare(t, baseSpec(), grown({ ...changes, [product]: 301, [checkout]: 801 }))
  assert.equal(over.failures.length, 2)
  assert.match(over.failures[0], /"\/product\/\[slug\]\/page" first load grew by \+1041 B gz \(budget \+1040 B = webpack \+40 \+ layout \+700 \+ 300\)/)
  assert.match(over.failures[1], /"\/checkout\/page" first load grew by \+1541 B gz \(budget \+1540 B = webpack \+40 \+ layout \+700 \+ 800\)/)
  // A shrinking layout lowers the allowance too.
  const shrunk = compare(t, baseSpec(), grown({ "static/chunks/app/layout-a1.js": -500, [product]: 301 }))
  assert.equal(rowFor(shrunk, "/product/[slug]/page").limit, -200)
  assert.equal(rowFor(shrunk, "/product/[slug]/page").ok, false)
})

test("CSS is ignored everywhere", (t) => {
  const head = grown({ "static/css/layout-a1.css": 50000, "static/css/checkout-a1.css": 50000 })
  head.files["static/css/extra-a1.css"] = 70000
  head.pages["/layout"].push("static/css/extra-a1.css")
  head.pages["/product/[slug]/page"].push("static/css/extra-a1.css")
  const result = compare(t, baseSpec(), head)
  assert.deepEqual(result.failures, [])
  for (const row of result.rows.filter((item) => item.delta !== null)) assert.equal(row.delta, 0, row.measure)
})

test("a chunk that moves from a page into the layout is counted once", (t) => {
  const head = baseSpec()
  head.pages["/layout"].push("static/chunks/6070-a1.js")
  const result = compare(t, baseSpec(), head)
  assert.equal(rowFor(result, "/layout set").delta, 800)
  assert.equal(rowFor(result, "/page").delta, 0, "the home page already loaded it")
  assert.equal(rowFor(result, "/shop/page").delta, 800)
  assert.deepEqual(result.failures, [])
})

test("a missing page key is a warning and a skipped row, not a failure", (t) => {
  const head = baseSpec()
  delete head.pages["/shop/page"]
  const base = baseSpec()
  delete base.pages["/collection/[slug]/page"]
  const result = compare(t, base, head)
  assert.deepEqual(result.failures, [])
  assert.ok(result.warnings.includes("head: \"/shop/page\" is missing from app-build-manifest.json"))
  assert.ok(result.warnings.includes("base: \"/collection/[slug]/page\" is missing from app-build-manifest.json"))
  const shop = rowFor(result, "/shop/page")
  assert.equal(shop.skipped, true)
  assert.equal(shop.head, null)
  assert.equal(shop.note, "missing from the head build")
  assert.equal(rowFor(result, "/collection/[slug]/page").note, "missing from the base build")
  const noLayout = baseSpec()
  delete noLayout.pages["/layout"]
  const build = measureBuild(writeBuild(t, noLayout), { sizeOf })
  assert.deepEqual(build.layout, { files: [], gz: 0 })
  assert.ok(build.warnings.includes("\"/layout\" is missing from app-build-manifest.json"))
})

test("finds the marker chunk anywhere under static/chunks and enforces 6000 B gz", (t) => {
  const withRuntime = (size) => {
    const spec = baseSpec()
    spec.files["static/chunks/app/lazy/9876-a1.js"] = { size, text: `var v="${MARKER}"` }
    spec.files["static/css/9876-a1.css"] = { size: 1, text: MARKER }
    spec.files["static/chunks/9876-a1.js.map"] = { size: 1, text: MARKER }
    return spec
  }
  const next = writeBuild(t, withRuntime(6000))
  assert.deepEqual(findMarkerChunks(next, MARKER, { sizeOf }), [{ file: "static/chunks/app/lazy/9876-a1.js", gz: 6000 }])
  assert.deepEqual(findMarkerChunks(next, "absent-marker", { sizeOf }), [])
  const at = compare(t, baseSpec(), withRuntime(6000))
  assert.deepEqual(at.failures, [])
  const row = rowFor(at, "lazy runtime chunk")
  assert.equal(row.head, 6000)
  assert.equal(row.base, null)
  assert.equal(row.note, "static/chunks/app/lazy/9876-a1.js")
  const over = compare(t, baseSpec(), withRuntime(6001))
  assert.deepEqual(over.failures, ["lazy runtime chunk static/chunks/app/lazy/9876-a1.js is 6001 B gz (budget 6000 B)"])
  assert.equal(rowFor(over, "lazy runtime chunk").ok, false)
  const shrink = compare(t, withRuntime(5000), withRuntime(4000))
  assert.equal(rowFor(shrink, "lazy runtime chunk").delta, -1000)
})

test("no marker chunk is fine and two marker chunks fail with both files listed", (t) => {
  const none = compare(t, baseSpec(), baseSpec())
  assert.equal(rowFor(none, "lazy runtime chunk").ok, true)
  assert.equal(rowFor(none, "lazy runtime chunk").head, null)
  const two = baseSpec()
  two.files["static/chunks/111-a1.js"] = { size: 100, text: MARKER }
  two.files["static/chunks/222-a1.js"] = { size: 100, text: MARKER }
  const result = compare(t, baseSpec(), two)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0], /"fl-runtime-v1" is in 2 chunks \(static\/chunks\/111-a1\.js, static\/chunks\/222-a1\.js\)/)
  assert.equal(rowFor(result, "lazy runtime chunk").ok, false)
})

test("unreadable or malformed manifests throw", (t) => {
  const next = writeBuild(t, baseSpec())
  assert.throws(() => measureBuild(path.join(next, "missing")), /Cannot read .*build-manifest\.json/)
  fs.writeFileSync(path.join(next, "app-build-manifest.json"), "{")
  assert.throws(() => measureBuild(next, { sizeOf }), /is not valid JSON/)
  fs.writeFileSync(path.join(next, "app-build-manifest.json"), JSON.stringify({ pages: [] }))
  assert.throws(() => measureBuild(next, { sizeOf }), /has no pages map/)
  fs.writeFileSync(path.join(next, "build-manifest.json"), JSON.stringify({ pages: {} }))
  assert.throws(() => measureBuild(next, { sizeOf }), /has no rootMainFiles list/)
  const escape = baseSpec()
  const outside = writeBuild(t, escape)
  fs.writeFileSync(path.join(outside, "app-build-manifest.json"), JSON.stringify({ pages: { "/layout": ["../secret.js"] } }))
  assert.throws(() => measureBuild(outside, { sizeOf }), /points outside/)
})

test("CLI exits 2 on bad arguments or unreadable builds", (t) => {
  const next = writeBuild(t, baseSpec())
  for (const args of [[], ["--base", next], ["--head", next], ["--base"], ["--base", "--head", next],
    ["--base", next, "--head", next, "--extra"], ["--base", next, "--head", next, "stray"]]) {
    const result = runCli(args)
    assert.equal(result.status, 2, args.join(" "))
    assert.match(result.stderr, /Usage:/)
  }
  const missing = runCli(["--base", path.join(next, "nope"), "--head", next])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /Cannot read/)
  assert.equal(runCli(["--help"]).status, 0)
})

test("CLI prints the table and exits 0 for two identical builds, 1 on a budget failure", (t) => {
  const withText = () => {
    const spec = baseSpec()
    // Real gzip here: the CLI has no injectable sizeOf.
    for (const file of Object.keys(spec.files)) spec.files[file] = { size: null, text: `/* ${file} */ ${"x".repeat(50)}` }
    return spec
  }
  const base = writeBuild(t, withText())
  const same = runCli(["--base", base, "--head", writeBuild(t, withText())])
  assert.equal(same.status, 0, same.stderr)
  assert.match(same.stdout, /^measure\s+base\s+head\s+delta\s+limit\s+ok$/m)
  for (const measure of ["framework (rootMainFiles)", "webpack runtime", "/layout set", ...PAGE_KEYS]) {
    assert.ok(same.stdout.includes(measure), measure)
  }
  assert.match(same.stdout, /Within budget\./)
  const json = runCli(["--base", base, "--head", writeBuild(t, withText()), "--json"])
  assert.equal(json.status, 0)
  const report = JSON.parse(json.stdout)
  assert.deepEqual(report.failures, [])
  assert.equal(report.rows.length, 3 + PAGE_KEYS.length + 1)

  const heavier = withText()
  heavier.files["static/chunks/1255-a1.js"].text += crypto.randomBytes(256).toString("hex")
  const failed = runCli(["--base", base, "--head", writeBuild(t, heavier)])
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /Failures:\n {2}framework chunks changed by \+\d+ B gz/)
  assert.match(failed.stdout, /FAIL/)
})

test("the script needs only Node built-ins", () => {
  const source = fs.readFileSync(SCRIPT, "utf8")
  const required = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1])
  assert.ok(required.length > 0)
  for (const name of required) assert.match(name, /^node:/, name)
  assert.ok(!/\bimport\s*\(/.test(source))
})
