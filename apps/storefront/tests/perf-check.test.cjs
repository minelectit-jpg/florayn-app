const assert = require("node:assert/strict")
const http = require("node:http")
const test = require("node:test")
const zlib = require("node:zlib")
const {
  parseOptions, validateBase, validateRoute, measure, budgetFailures, runBenchmark,
} = require("../../../scripts/perf-check.cjs")

test("benchmark rejects live and foreign hosts, credentials, and cross-origin routes", async () => {
  for (const value of [
    "https://florayn.com", "https://www.florayn.com", "https://api.new.florayn.com",
    "https://new.florayn.com.example.test", "http://new.florayn.com",
    "https://user:password@new.florayn.com", "https://new.florayn.com/product/",
  ]) assert.throws(() => validateBase(value))
  assert.equal(validateBase("https://new.florayn.com"), "https://new.florayn.com")
  assert.equal(validateBase("http://127.0.0.1:9902"), "http://127.0.0.1:9902")
  for (const route of ["//florayn.com/", "/\\florayn.com/", "https://florayn.com/", "/#perf"]) {
    assert.throws(() => validateRoute(route, "https://new.florayn.com"))
  }
  await assert.rejects(parseOptions(["--base", "http://localhost:9902"]))
  const defaults = await parseOptions([])
  assert.equal(defaults.samples, 2)
  assert.equal(defaults.routes.length, 6)
  assert.ok(defaults.routes.includes("/collection/muse-marvel/"))
})

test("HTTP checks stay sequential, separate RSC, and report bytes without body or cookie data", { timeout: 15000 }, async (t) => {
  const counts = { document: 0, rsc: 0 }
  let active = 0, maxActive = 0, forbidden = 0
  const payload = "BODY_MUST_NOT_APPEAR_IN_REPORT".repeat(100)
  const compressed = zlib.gzipSync(payload)
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect/") {
      res.writeHead(302, { location: "/forbidden/" })
      return res.end()
    }
    if (req.url === "/forbidden/") forbidden += 1
    const mode = req.headers.rsc === "1" ? "rsc" : "document"
    counts[mode] += 1
    maxActive = Math.max(maxActive, ++active)
    setTimeout(() => {
      res.writeHead(200, {
        "content-type": mode === "rsc" ? "text/x-component" : "text/html; charset=utf-8",
        "content-encoding": "gzip",
        "cf-cache-status": counts[mode] === 1 ? "MISS" : "HIT",
        "x-nextjs-cache": "HIT",
        "set-cookie": "fixture=COOKIE_MUST_NOT_APPEAR_IN_REPORT",
      })
      res.end(compressed)
      active -= 1
    }, 10)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const options = await parseOptions(["--base", base, "--route", "/product/fixture/", "--delay-ms", "0", "--enforce"])
  const report = await runBenchmark(options)
  assert.equal(report.summary.requests, 4)
  assert.equal(report.summary.requestErrors, 0)
  assert.deepEqual(report.summary.budgetFailures, [])
  assert.deepEqual(counts, { document: 2, rsc: 2 })
  assert.equal(maxActive, 1)
  for (const result of report.results) {
    for (const sample of result.samples) {
      assert.equal(sample.decodedBytes, Buffer.byteLength(payload))
      assert.equal(sample.transferBytes, compressed.length)
      assert.ok(sample.ttfbMs >= 0 && sample.totalMs >= sample.ttfbMs)
      assert.equal(sample.nextCache, "HIT")
    }
  }
  assert.ok(!JSON.stringify(report).includes("MUST_NOT_APPEAR"))
  const redirect = await measure(base, "/redirect/", "document", 5)
  assert.equal(redirect.status, 302)
  assert.match(redirect.error, /redirects are not followed/)
  assert.equal(forbidden, 0)
})

test("budgets distinguish cold timing, verified warm timing, unknown cache, and body sizes", () => {
  const options = { warmTtfbMs: 1000, warmTotalMs: 1500, maxRscBytes: 400000, maxDocumentBytes: 900000 }
  const cold = { sample: 1, ttfbMs: 5000, totalMs: 6000, decodedBytes: 1000, warmCacheEvidence: false }
  const warm = { sample: 2, ttfbMs: 500, totalMs: 600, decodedBytes: 1000, warmCacheEvidence: true }
  const check = (samples) => budgetFailures([{ route: "/", mode: "rsc", samples }], options)
  assert.deepEqual(check([cold, warm]), [])
  assert.deepEqual(check([cold, { ...warm, warmCacheEvidence: false }]).map((item) => item.reason), ["warm-cache-not-verified"])
  assert.deepEqual(check([{ ...warm, ttfbMs: 1100, totalMs: 1700, decodedBytes: 410000 }]).map((item) => item.reason), [
    "decoded-byte-budget", "warm-http-ttfb-budget", "warm-http-total-budget",
  ])
})
