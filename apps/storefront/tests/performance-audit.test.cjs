const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const compiled = ts.transpileModule(fs.readFileSync(
  path.join(__dirname, "../src/lib/performance-audit.ts"), "utf8"
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function image(decode = () => Promise.resolve()) {
  return { complete: true, naturalWidth: 540, currentSrc: "hero.webp", src: "hero.webp", decode }
}

function root(pathname, img = image(), hydrated = "true") {
  return {
    dataset: { productPath: pathname, productHydrated: hydrated },
    isConnected: true,
    img,
    querySelector() { return this.img },
  }
}

function shop(pathname, images = Array.from({ length: 8 }, () => image()), columns = 4) {
  return {
    dataset: { shopPath: pathname },
    isConnected: true,
    columns,
    children: images.map((img) => ({
      img,
      matches: (selector) => selector === ".fl-card",
      querySelector() { return this.img },
    })),
  }
}

function harness({ roots = [], shops = [], withObserver = true, pathname = "/product/first/", resources } = {}) {
  const readings = [], events = new Map(), frames = new Map()
  let now = 100, nextFrame = 0, mutation, lcp
  const location = { pathname, origin: "https://fixture.test" }
  const document = {
    body: {},
    querySelectorAll: (selector) => selector === "[data-shop-path]" ? shops : roots,
    querySelector: () => ({}),
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
  }
  const loaded = { exports: {} }
  const context = {
    module: loaded, exports: loaded.exports,
    window: { location, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener },
    document,
    performance: {
      now: () => now,
      getEntriesByType: (type) => type === "navigation" ? [{ responseStart: 50 }] : resources ?? [{ startTime: 0, transferSize: 2048 }],
    },
    getComputedStyle: (grid) => ({ gridTemplateColumns: Array.from({ length: grid.columns }, () => "200px").join(" ") }),
    PerformanceObserver: withObserver ? class {
      constructor(callback) { lcp = callback }
      observe(options) { assert.equal(options.buffered, true) }
      disconnect() {}
    } : undefined,
    MutationObserver: class {
      constructor(callback) { mutation = callback }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id) => frames.delete(id),
  }
  vm.runInNewContext(compiled, context)
  const stop = loaded.exports.startPerformanceAudit((reading) => readings.push(JSON.parse(JSON.stringify(reading))))
  return {
    readings, location, roots, shops, stop,
    mutate: () => mutation(),
    load: () => events.get("load")?.(),
    resize: () => events.get("resize")?.(),
    setTime: (value) => { now = value },
    lcp: (time) => lcp({ getEntries: () => [{ startTime: time }] }),
    click(pathname, overrides = {}) {
      const anchor = { pathname, origin: location.origin, target: "", hasAttribute: () => false, ...overrides.anchor }
      events.get("click")?.({ button: 0, target: { closest: () => anchor }, ...overrides })
    },
    async paint() {
      for (let i = 0; i < 4; i += 1) await Promise.resolve()
      for (let i = 0; i < 2; i += 1) {
        now += 16
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback())
        for (let j = 0; j < 4; j += 1) await Promise.resolve()
      }
    },
  }
}

test("an already-loaded SSR hero waits for hydration and reports an observed upper bound", async () => {
  const product = root("/product/first/", image(), "false")
  const h = harness({ roots: [product] })
  await h.paint()
  assert.equal(h.readings.at(-1).productReadyMs, undefined)
  product.dataset.productHydrated = "true"
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).ttfbMs, 50)
  assert.equal(h.readings.at(-1).productReadyMs, 164)
  h.stop()
})

test("changing the URL does not make the previous product root ready for the new route", async () => {
  const product = root("/product/first/")
  const h = harness({ roots: [product] })
  await h.paint()
  h.click("/product/second/")
  h.location.pathname = "/product/second/"
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).productReadyMs, undefined)
  product.dataset.productPath = "/product/second/"
  product.dataset.productHydrated = "false"
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).productReadyMs, undefined)
  product.dataset.productHydrated = "true"
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).path, "/product/second/")
  assert.equal(h.readings.at(-1).productReadyMs, 96)
  h.stop()
})

test("a pending previous-image decode cannot complete a later navigation", async () => {
  const decoding = deferred()
  const product = root("/product/first/", image(() => decoding.promise))
  const h = harness({ roots: [product] })
  h.click("/product/second/")
  h.location.pathname = "/product/second/"
  decoding.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).productReadyMs, undefined)
  h.roots.splice(0, 1, root("/product/second/"))
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).path, "/product/second/")
  assert.equal(h.readings.at(-1).productReadyMs, 64)
  h.stop()
})

test("a changed hero source must decode again before readiness", async () => {
  const first = deferred(), second = deferred()
  let decodes = 0
  const img = image(() => ++decodes === 1 ? first.promise : second.promise)
  const h = harness({ roots: [root("/product/first/", img)] })
  img.currentSrc = "changed-case.webp"
  first.resolve()
  await h.paint()
  assert.equal(decodes, 2)
  assert.equal(h.readings.at(-1).productReadyMs, undefined)
  second.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).productReadyMs, 164)
  h.stop()
})

test("buffered LCP belongs only to the original document", () => {
  const h = harness()
  h.lcp(600)
  assert.equal(h.readings.at(-1).lcpMs, 600)
  h.click("/product/second/")
  h.lcp(900)
  assert.deepEqual(h.readings.at(-1), { path: "/product/second/", kind: "navigation" })
  h.stop()
})

test("modified, external and download clicks do not start measurements", () => {
  const h = harness({ withObserver: false })
  h.click("/product/second/", { ctrlKey: true })
  h.click("/product/second/", { anchor: { origin: "https://external.test" } })
  h.click("/product/second/", { anchor: { hasAttribute: () => true } })
  h.click("/product/first/")
  assert.equal(h.readings.length, 1)
  h.stop()
})

test("unmount stops pending image completions", async () => {
  const decoding = deferred()
  const h = harness({ roots: [root("/product/first/", image(() => decoding.promise))] })
  h.stop()
  decoding.resolve()
  await h.paint()
  assert.equal(h.readings.length, 1)
})

test("mobile shop readiness waits for four images and does not wait for the third row", async () => {
  const grid = shop("/shop/iphone-17-pro/signature/", undefined, 2)
  grid.children[4].img.complete = false
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  await h.paint()
  const reading = h.readings.at(-1)
  assert.equal(reading.shopImageCount, 4)
  assert.equal(reading.shopImagesLoaded, 4)
  assert.equal(reading.shopImagesReadyMs, 132)
  assert.equal(reading.productReadyMs, undefined)
  h.stop()
})

test("desktop first-two-row readiness waits for all eight current primary images", async () => {
  const grid = shop("/shop/iphone-17-pro/signature/")
  grid.children[7].img.complete = false
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  await h.paint()
  assert.equal(h.readings.at(-1).shopImageCount, 8)
  assert.equal(h.readings.at(-1).shopImagesLoaded, 7)
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  grid.children[7].img.complete = true
  h.load()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, 164)
  h.stop()
})

test("a missing shop image cannot be replaced in the count by a later row", async () => {
  const grid = shop("/shop/iphone-17-pro/signature/", Array.from({ length: 12 }, () => image()))
  grid.children[0].img = null
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  await h.paint()
  assert.equal(h.readings.at(-1).shopImageCount, 8)
  assert.equal(h.readings.at(-1).shopImagesLoaded, 7)
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  grid.children[0].img = image()
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, 164)
  h.stop()
})

test("failed loads and failed decodes do not report shop readiness", async () => {
  const grid = shop("/shop/iphone-17-pro/signature/")
  grid.children[2].img.naturalWidth = 0
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  grid.children[2].img = image(() => Promise.reject(new Error("bad image")))
  h.load()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  grid.children[2].img = image()
  h.load()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, 196)
  h.stop()
})

test("a retained old shop grid cannot complete the next shop route", async () => {
  const decode = deferred()
  const grid = shop("/shop/iphone-17-pro/signature/")
  grid.children[0].img = image(() => decode.promise)
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  h.click("/shop/iphone-17-pro-max/signature/")
  h.location.pathname = "/shop/iphone-17-pro-max/signature/"
  h.mutate()
  decode.resolve()
  await h.paint()
  assert.deepEqual(h.readings.at(-1), { path: h.location.pathname, kind: "navigation" })
  grid.dataset.shopPath = h.location.pathname
  h.mutate()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, 64)
  h.stop()
})

test("replaced shop image and source must decode before two-frame readiness", async () => {
  const first = deferred(), replacement = deferred(), changed = deferred()
  const grid = shop("/shop/iphone-17-pro/signature/")
  grid.children[0].img = image(() => first.promise)
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  let decodes = 0
  grid.children[0].img = image(() => ++decodes === 1 ? replacement.promise : changed.promise)
  first.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  grid.children[0].img.currentSrc = "different-case.webp"
  replacement.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
  assert.equal(decodes, 2)
  changed.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, 196)
  h.stop()
})

test("a pending shop measurement follows a resize from four to three columns", async () => {
  const decode = deferred()
  const grid = shop("/shop/iphone-17-pro/signature/")
  grid.children[0].img = image(() => decode.promise)
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath })
  grid.columns = 3
  h.resize()
  decode.resolve()
  await h.paint()
  // The first decode retries with six selected images after the layout changes.
  await h.paint()
  assert.equal(h.readings.at(-1).shopImageCount, 6)
  assert.equal(typeof h.readings.at(-1).shopImagesReadyMs, "number")
  h.stop()
})

test("image resource summaries expose numbers without source URLs", async () => {
  const grid = shop("/shop/iphone-17-pro/signature/", [image(), image()])
  const h = harness({ shops: [grid], pathname: grid.dataset.shopPath, resources: [
    { name: "hero.webp", startTime: 12.3, responseEnd: 135.7, transferSize: 8192, duration: 123.4 },
    { name: "other.webp", startTime: 0, responseEnd: 999, transferSize: 16384, duration: 999 },
  ] })
  await h.paint()
  const reading = h.readings.at(-1)
  assert.equal(reading.shopImageCount, 2)
  assert.equal(reading.shopImageResourceCount, 1)
  assert.equal(reading.shopImageTransferKB, 8)
  assert.equal(reading.shopImageMaxResponseMs, 123)
  assert.equal(reading.shopImageFirstRequestMs, 12)
  assert.equal(reading.shopImageLastResponseMs, 136)
  assert.equal(reading.shopAllImageResourceCount, 1)
  assert.equal(reading.shopAllImageTransferKB, 8)
  assert.equal(reading.resourceKB, 24)
  assert.equal(JSON.stringify(reading).includes("webp"), false)
  h.stop()
})

test("shop resource snapshots separate two-row timings from all rendered card images after navigation", async () => {
  const grid = shop("/shop/second/", Array.from({ length: 9 }, () => image()))
  grid.children[1].img.currentSrc = "second.webp"
  grid.children[8].img.currentSrc = "later-row.webp"
  // A deferred placeholder is not an image, nor a reason to read a noscript URL.
  grid.children.push({ matches: () => true, querySelector: () => null })
  const h = harness({ resources: [
    { name: "hero.webp", startTime: 99, responseEnd: 112, transferSize: 32768, duration: 13 },
    { name: "hero.webp", startTime: 120, responseEnd: 190, transferSize: 2048, duration: 70 },
    { name: "second.webp", startTime: 130, responseEnd: 215.8, transferSize: 4096, duration: 85.8 },
    { name: "later-row.webp", startTime: 115, responseEnd: 225, transferSize: 8192, duration: 110 },
    { name: "unrelated.webp", startTime: 110, responseEnd: 800, transferSize: 65536, duration: 690 },
  ] })
  h.click("/shop/second/")
  h.location.pathname = "/shop/second/"
  h.shops.push(grid)
  h.setTime(230)
  h.mutate()
  await h.paint()
  const reading = h.readings.at(-1)
  assert.equal(reading.kind, "navigation")
  assert.equal(reading.shopImageCount, 8)
  assert.equal(reading.shopImageResourceCount, 2)
  assert.equal(reading.shopImageTransferKB, 6)
  assert.equal(reading.shopImageFirstRequestMs, 20)
  assert.equal(reading.shopImageLastResponseMs, 116)
  assert.equal(reading.shopAllImageResourceCount, 3)
  assert.equal(reading.shopAllImageTransferKB, 14)
  assert.equal(JSON.stringify(reading).includes("webp"), false)
  h.stop()
})

test("missing timing entries report zero exposed resources without an invented request time", async () => {
  const grid = shop("/shop/")
  const h = harness({ shops: [grid], pathname: "/shop/", resources: [] })
  await h.paint()
  const reading = h.readings.at(-1)
  assert.equal(reading.shopImagesReadyMs, 132)
  assert.equal(reading.shopImageResourceCount, 0)
  assert.equal(reading.shopImageTransferKB, 0)
  assert.equal(reading.shopAllImageResourceCount, 0)
  assert.equal(reading.shopAllImageTransferKB, 0)
  assert.equal(reading.shopImageFirstRequestMs, undefined)
  assert.equal(reading.shopImageLastResponseMs, undefined)
  h.stop()
})

test("an empty shop, unresolved layout or stopped decode cannot report readiness", async () => {
  for (const grid of [shop("/shop/", []), shop("/shop/", undefined, 0)]) {
    const h = harness({ shops: [grid], pathname: "/shop/" })
    await h.paint()
    assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
    h.stop()
  }
  const decode = deferred()
  const grid = shop("/shop/")
  grid.children[0].img = image(() => decode.promise)
  const h = harness({ shops: [grid], pathname: "/shop/" })
  h.stop()
  decode.resolve()
  await h.paint()
  assert.equal(h.readings.at(-1).shopImagesReadyMs, undefined)
})
