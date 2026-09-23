const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/jobs/warm-storefront.ts")
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const PASS_BUDGET_MS = 18 * 60 * 1000

function harness({ products = [], request, listProducts } = {}) {
  let now = 0
  let active = 0
  let maximumActive = 0
  let listCalls = 0
  const requests = []
  const delays = []
  const logs = []
  const exports = {}
  const clock = { now: () => now, advance: (ms) => { now += ms } }
  const container = {
    resolve(key) {
      if (key === "logger") return { info: (message) => logs.push(message) }
      if (key === "product") return {
        listProducts: async (...args) => {
          listCalls++
          return listProducts ? listProducts(...args) : products
        },
      }
      throw new Error(`Unexpected service: ${key}`)
    },
  }
  vm.runInNewContext(compiled, {
    exports,
    Date: { now: () => now },
    process: { env: {} },
    AbortSignal: { timeout: (ms) => ({ timeoutMs: ms }) },
    fetch: async (url, options) => {
      const entry = { url, options, start: now, end: undefined }
      requests.push(entry)
      active++
      maximumActive = Math.max(maximumActive, active)
      let response
      try {
        response = request ? await request({ url, options, index: requests.length - 1, clock }) : {}
      } catch (error) {
        entry.end = now
        active--
        throw error
      }
      return {
        status: response.status ?? 200,
        headers: { get: () => response.cacheStatus ?? "HIT" },
        arrayBuffer: async () => {
          try {
            if (response.body) await response.body()
            return new ArrayBuffer(0)
          } finally {
            entry.end = now
            active--
          }
        },
      }
    },
    require(name) {
      if (name === "@medusajs/framework/utils") return { Modules: { PRODUCT: "product" } }
      if (name === "node:timers/promises") return {
        setTimeout: async (ms) => { delays.push(ms); now += ms },
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return { run: () => exports.default(container), clock, requests, delays, logs, maximumActive: () => maximumActive, listCalls: () => listCalls }
}

test("warm requests remain sequential and spaced after body completion, with existing document URLs", async () => {
  const warmer = harness({
    products: [{ handle: "example-phone", metadata: { form: "phone" } }, { handle: "example-airpods", metadata: { form: "airpods" } }],
    request: async ({ clock }) => {
      clock.advance(20)
      return { body: async () => { clock.advance(5) } }
    },
  })
  await warmer.run()
  // 7 home/shop pages (Women and Men), 2 Women + 1 Men phone page, 5 AirPods pages.
  assert.equal(warmer.requests.length, 15)
  assert.equal(warmer.maximumActive(), 1)
  for (let i = 1; i < warmer.requests.length; i++) {
    assert.equal(warmer.requests[i].start - warmer.requests[i - 1].end, 250)
  }
  for (const entry of warmer.requests) {
    assert.equal(new URL(entry.url).hostname, "new.florayn.com")
    assert.equal(entry.options.headers["Sec-Fetch-Dest"], "document")
    assert.equal(entry.options.headers["Sec-Fetch-Mode"], "navigate")
    assert.equal(entry.options.redirect, "manual")
    assert.equal(entry.options.signal.timeoutMs, 10_000)
  }
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/product/example-phone-iphone-17-pro-max/?case=signature")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/product/example-airpods-airpods-pro/?case=signature-earbuds")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/men/")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/men/product/example-phone-iphone-17-pro-max/?case=signature")))
  assert.ok(!warmer.requests.some((entry) => entry.url.includes("/men/product/example-airpods")), "AirPods stay on the Women warm list only")
  assert.match(warmer.logs.at(-1), /processed=15\/15 remaining=0/)
})

test("a timeout, HTTP error and body failure do not prevent later URLs from warming", async () => {
  const warmer = harness({
    products: [{ handle: "example-phone", metadata: { form: "phone" } }],
    request: async ({ index, options, clock }) => {
      if (index === 0) {
        clock.advance(options.signal.timeoutMs)
        throw new Error("aborted after timeout")
      }
      if (index === 1) return { status: 503 }
      if (index === 2) return { body: async () => { throw new Error("body aborted") } }
      return {}
    },
  })
  await warmer.run()
  assert.equal(warmer.requests.length, 10)
  assert.equal(warmer.maximumActive(), 1)
  assert.equal(warmer.requests[0].end, 10_000)
  assert.match(warmer.logs.at(-1), /processed=10\/10 remaining=0/)
  assert.match(warmer.logs.at(-1), /bad=3/)
})

test("a second invocation skips an active pass instead of creating another request stream", async () => {
  let release
  let entered
  const gate = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  const warmer = harness({ request: async ({ index }) => {
    if (index === 0) { entered(); await gate }
    return {}
  } })
  const first = warmer.run()
  await started
  await warmer.run()
  assert.equal(warmer.requests.length, 1)
  assert.equal(warmer.listCalls(), 1)
  assert.ok(warmer.logs.some((message) => message.includes("previous pass is still active")))
  release()
  await first
  await warmer.run()
  assert.equal(warmer.listCalls(), 2, "the guard must be released after completion")
})

test("budget exhaustion resumes at the next URL and eventually reaches the catalog tail", async () => {
  const products = Array.from({ length: 1000 }, (_, i) => ({ handle: `design-${i}`, metadata: { form: "phone" } }))
  const warmer = harness({ products, request: async ({ options, clock }) => {
    const duration = Math.min(1000, options.signal.timeoutMs)
    clock.advance(duration)
    if (duration < 1000) throw new Error("pass deadline")
    return {}
  } })
  await warmer.run()
  assert.ok(warmer.clock.now() <= PASS_BUDGET_MS)
  const firstCount = warmer.requests.length
  // 7 fixed pages, then per design two Women phone pages and one Men phone page.
  const total = 7 + 1000 * 3
  assert.ok(firstCount < total)
  assert.match(warmer.logs.at(-1), new RegExp(`processed=${firstCount}/${total} remaining=${total - firstCount}`))
  const nextProductIndex = Math.floor((firstCount - 7) / 3)
  const nextPath = [
    `/product/design-${nextProductIndex}-iphone-17-pro-max/`,
    `/product/design-${nextProductIndex}-iphone-16-pro-max/`,
    `/men/product/design-${nextProductIndex}-iphone-17-pro-max/`,
  ][(firstCount - 7) % 3]
  await warmer.run()
  assert.equal(warmer.requests[firstCount].url, `https://new.florayn.com${nextPath}?case=signature`)
  // With the Men pages the catalogue needs a fourth pass to reach its tail.
  await warmer.run()
  await warmer.run()
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/men/product/design-999-iphone-17-pro-max/?case=signature")))
  assert.equal(warmer.maximumActive(), 1)
  assert.ok(warmer.clock.now() <= 4 * PASS_BUDGET_MS)
})

test("a request near the pass deadline gets a shortened abort timeout", async () => {
  let calls = 0
  const warmer = harness({ request: async ({ options, clock }) => {
    calls++
    if (calls === 1) clock.advance(PASS_BUDGET_MS - 750)
    else {
      assert.equal(options.signal.timeoutMs, 500)
      clock.advance(options.signal.timeoutMs)
      throw new Error("deadline")
    }
    return {}
  } })
  await warmer.run()
  assert.equal(warmer.requests.length, 2)
  assert.equal(warmer.clock.now(), PASS_BUDGET_MS)
  assert.match(warmer.logs.at(-1), /processed=2\/7 remaining=5/)
})

test("a catalog-read failure releases the overlap guard", async () => {
  let fail = true
  const warmer = harness({ listProducts: async () => {
    if (fail) throw new Error("catalog unavailable")
    return []
  } })
  await assert.rejects(warmer.run(), /catalog unavailable/)
  fail = false
  await warmer.run()
  assert.equal(warmer.requests.length, 7)
  assert.equal(warmer.listCalls(), 2)
})
