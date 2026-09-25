const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/jobs/warm-storefront.ts")
const transpile = (file) => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const compiled = transpile(filename)
const PASS_BUDGET_MS = 18 * 60 * 1000
// The job's own imports: module names are stubbed, pure helpers load for real.
const MODULE_STUBS = { "../modules/catalog": { CATALOG_MODULE: "catalog" }, "../modules/content": { CONTENT_MODULE: "content" } }
function relative(from, name) {
  if (Object.hasOwn(MODULE_STUBS, name)) return MODULE_STUBS[name]
  const file = `${path.resolve(path.dirname(from), name)}.ts`
  const module = { exports: {} }
  vm.runInNewContext(transpile(file), {
    exports: module.exports, module, process: { env: {} },
    require: (next) => (next.startsWith(".") ? relative(file, next) : (() => { throw new Error(`Unexpected dependency: ${next}`) })()),
  }, { filename: file })
  return module.exports
}

/** A Women menu (Phone Case, Earbuds) as the header v2 script leaves it, and the catalog behind it. */
const MENU = {
  sections: [
    { id: "ms1", menu: "primary", kind: "devices", position: 0, is_visible: true, config: { families: ["iphone", "samsung"], case_type: "signature" } },
    { id: "ms2", menu: "primary", kind: "devices", position: 1, is_visible: true, placement: "drawer", config: { families: ["airpods"], case_type: "signature-earbuds" } },
    { id: "ms3", menu: "primary", kind: "links", position: 2, is_visible: true, config: null },
  ],
  devices: [
    { slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", family: "iphone", is_active: true },
    { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", is_active: true },
    { slug: "samsung-s26-ultra", name: "Samsung S26 Ultra", family: "samsung", is_active: true },
    { slug: "airpods-pro-3", name: "AirPods Pro 3", family: "airpods", is_active: true },
  ],
  caseTypes: [
    { slug: "signature", devices: [{ family: "iphone" }, { family: "samsung" }] },
    { slug: "signature-earbuds", devices: [{ family: "airpods" }] },
  ],
}

function harness({ products = [], request, listProducts, menu = { sections: [], devices: [], caseTypes: [] }, listMenuSections } = {}) {
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
      if (key === "content") return { listMenuSections: listMenuSections ?? (async () => menu.sections) }
      if (key === "catalog") return {
        listDevices: async (filter) => menu.devices.filter((d) => !filter?.is_active || d.is_active),
        listCaseTypes: async () => menu.caseTypes,
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
      if (name.startsWith(".")) return relative(filename, name)
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return { run: () => exports.default(container), exports, clock, requests, delays, logs, maximumActive: () => maximumActive, listCalls: () => listCalls }
}
const paths = (warmer) => warmer.requests.map((entry) => entry.url.slice("https://new.florayn.com".length))
// "/", 3 Women and 3 Men shop pages, the search index and the two search pages.
const FIXED = 10

test("warm requests remain sequential and spaced after body completion, with existing document URLs", async () => {
  const warmer = harness({
    products: [{ handle: "example-phone", metadata: { form: "phone" } }, { handle: "example-airpods", metadata: { form: "airpods" } }],
    request: async ({ clock }) => {
      clock.advance(20)
      return { body: async () => { clock.advance(5) } }
    },
  })
  await warmer.run()
  // 7 home/shop pages (Women and Men), the search index and 2 search pages,
  // 2 Women + 1 Men phone page, 5 AirPods pages.
  assert.equal(warmer.requests.length, 18)
  assert.equal(warmer.maximumActive(), 1)
  for (let i = 1; i < warmer.requests.length; i++) {
    assert.equal(warmer.requests[i].start - warmer.requests[i - 1].end, 250)
  }
  for (const entry of warmer.requests) {
    assert.equal(new URL(entry.url).hostname, "new.florayn.com")
    assert.equal(entry.options.redirect, "manual")
    assert.equal(entry.options.signal.timeoutMs, 10_000)
    if (entry.url.endsWith("/search-index.json")) continue
    assert.equal(entry.options.headers["Sec-Fetch-Dest"], "document")
    assert.equal(entry.options.headers["Sec-Fetch-Mode"], "navigate")
  }
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/product/example-phone-iphone-17-pro-max/?case=signature")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/product/example-airpods-airpods-pro/?case=signature-earbuds")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/men/")))
  assert.ok(warmer.requests.some((entry) => entry.url.endsWith("/men/product/example-phone-iphone-17-pro-max/?case=signature")))
  assert.ok(!warmer.requests.some((entry) => entry.url.includes("/men/product/example-airpods")), "AirPods stay on the Women warm list only")
  assert.match(warmer.logs.at(-1), /processed=18\/18 remaining=0/)
})

test("the search index and pages are warmed, the index the way the page's fetch() asks for it", async () => {
  const warmer = harness()
  await warmer.run()
  assert.deepEqual(paths(warmer).slice(7, FIXED), ["/search-index.json", "/search/", "/men/search/"])
  const index = warmer.requests.find((entry) => entry.url === "https://new.florayn.com/search-index.json")
  assert.equal(index.options.headers["Sec-Fetch-Dest"], "empty", "not a document, so the HTML cache rule never applies")
  assert.equal(index.options.headers["Sec-Fetch-Mode"], "cors")
  assert.equal(index.options.headers.Accept, "application/json")
  for (const page of ["/search/", "/men/search/"]) {
    assert.equal(warmer.requests.find((entry) => entry.url.endsWith(page)).options.headers["Sec-Fetch-Dest"], "document")
  }
})

test("every model page the menu opens is warmed in both modes, newest first, without duplicates", async () => {
  const warmer = harness({ menu: MENU, products: [{ handle: "example-phone", metadata: { form: "phone" } }] })
  await warmer.run()
  const list = paths(warmer)
  assert.equal(new Set(list).size, list.length, "no page is warmed twice")
  assert.deepEqual(list.slice(FIXED, FIXED + 3), [
    "/shop/samsung-s26-ultra/signature/",
    "/men/shop/iphone-16-pro-max/signature/",
    "/men/shop/samsung-s26-ultra/signature/",
  ], "menu pages follow the fixed ones, those already on the list left out")
  assert.ok(list.slice(FIXED + 3).every((p) => p.includes("/product/")))
  for (const page of [
    "/shop/iphone-17-pro-max/signature/", "/men/shop/iphone-17-pro-max/signature/",
    "/shop/airpods-pro-3/signature-earbuds/", "/men/shop/airpods-pro-3/signature-earbuds/",
    "/shop/iphone-16-pro-max/signature/", "/men/shop/iphone-16-pro-max/signature/",
    "/shop/samsung-s26-ultra/signature/", "/men/shop/samsung-s26-ultra/signature/",
  ]) {
    assert.equal(list.filter((p) => p === page).length, 1, page)
  }
  // 10 fixed pages + 3 new menu pages (the other 5 are fixed ones) + 3 product pages.
  assert.equal(list.length, 16)
  assert.ok(list.includes("/search-index.json"))
  assert.match(warmer.logs.at(-1), /processed=16\/16 remaining=0/)
})

test("menu model targets: newest first, the Men menu's own sections under /men, and a case type only where it fits", () => {
  const { menuModelTargets } = harness().exports
  assert.deepEqual([...menuModelTargets(MENU.sections, MENU.devices, MENU.caseTypes)], [
    "/shop/iphone-17-pro-max/signature/",
    "/shop/iphone-16-pro-max/signature/",
    "/shop/samsung-s26-ultra/signature/",
    "/shop/airpods-pro-3/signature-earbuds/",
    "/men/shop/iphone-17-pro-max/signature/",
    "/men/shop/iphone-16-pro-max/signature/",
    "/men/shop/samsung-s26-ultra/signature/",
    "/men/shop/airpods-pro-3/signature-earbuds/",
  ], "an empty Men menu borrows the Women one")

  const sections = [
    ...MENU.sections,
    // The Men menu: its own devices section; a hidden one is ignored.
    { id: "m1", menu: "primary-men", kind: "devices", position: 0, is_visible: true, config: { families: ["airpods", "iphone"], case_type: "signature-earbuds" } },
    { id: "m2", menu: "primary-men", kind: "devices", position: 1, is_visible: false, config: { families: ["samsung"], case_type: "signature" } },
  ]
  const devices = [...MENU.devices, { slug: "iphone-11", name: "iPhone 11", family: "iphone", is_active: false }]
  assert.deepEqual([...menuModelTargets(sections, devices, MENU.caseTypes)].filter((p) => p.startsWith("/men/")), [
    "/men/shop/iphone-17-pro-max/",
    "/men/shop/iphone-16-pro-max/",
    "/men/shop/airpods-pro-3/signature-earbuds/",
  ], "Signature Earbuds never opens on an iPhone; inactive devices and hidden sections are skipped")
  assert.deepEqual([...menuModelTargets([{ menu: "primary", kind: "devices", position: 0, is_visible: true, config: { families: ["iphone"], case_type: null } }], MENU.devices, [])], [
    "/shop/iphone-17-pro-max/", "/shop/iphone-16-pro-max/", "/men/shop/iphone-17-pro-max/", "/men/shop/iphone-16-pro-max/",
  ], "no case type: the device's own shop page")
  assert.deepEqual([...menuModelTargets([], MENU.devices, MENU.caseTypes)], [])
})

test("a menu read failure only skips the menu pages", async () => {
  const warmer = harness({ menu: MENU, listMenuSections: async () => { throw new Error("content unavailable") } })
  await warmer.run()
  assert.equal(warmer.requests.length, FIXED)
  assert.ok(warmer.logs.some((message) => message.includes("menu models skipped: content unavailable")))
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
  assert.equal(warmer.requests.length, FIXED + 3)
  assert.equal(warmer.maximumActive(), 1)
  assert.equal(warmer.requests[0].end, 10_000)
  assert.match(warmer.logs.at(-1), /processed=13\/13 remaining=0/)
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
  // The fixed pages, then per design two Women phone pages and one Men phone page.
  const total = FIXED + 1000 * 3
  assert.ok(firstCount < total)
  assert.match(warmer.logs.at(-1), new RegExp(`processed=${firstCount}/${total} remaining=${total - firstCount}`))
  const nextProductIndex = Math.floor((firstCount - FIXED) / 3)
  const nextPath = [
    `/product/design-${nextProductIndex}-iphone-17-pro-max/`,
    `/product/design-${nextProductIndex}-iphone-16-pro-max/`,
    `/men/product/design-${nextProductIndex}-iphone-17-pro-max/`,
  ][(firstCount - FIXED) % 3]
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
  assert.match(warmer.logs.at(-1), /processed=2\/10 remaining=8/)
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
  assert.equal(warmer.requests.length, FIXED)
  assert.equal(warmer.listCalls(), 2)
})
