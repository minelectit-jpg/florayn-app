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

function harness({ roots = [], withObserver = true } = {}) {
  const readings = [], events = new Map(), frames = new Map()
  let now = 100, nextFrame = 0, mutation, lcp
  const location = { pathname: "/product/first/", origin: "https://fixture.test" }
  const document = {
    body: {},
    querySelectorAll: () => roots,
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
      getEntriesByType: (type) => type === "navigation" ? [{ responseStart: 50 }] : [{ startTime: 0, transferSize: 2048 }],
    },
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
    readings, location, roots, stop,
    mutate: () => mutation(),
    setTime: (value) => { now = value },
    lcp: (time) => lcp({ getEntries: () => [{ startTime: time }] }),
    click(pathname, overrides = {}) {
      const anchor = { pathname, origin: location.origin, target: "", hasAttribute: () => false, ...overrides.anchor }
      events.get("click")?.({ button: 0, target: { closest: () => anchor }, ...overrides })
    },
    async paint() {
      await Promise.resolve()
      for (let i = 0; i < 2; i += 1) {
        now += 16
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback())
        await Promise.resolve()
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
