const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/lib/shop-image-loading.ts")
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function fixture({ count = 16, complete = false, withObserver = true } = {}) {
  const observers = []
  const timers = new Map()
  let timerId = 0
  const events = new Map()
  const cards = Array.from({ length: count }, () => ({
    image: { complete },
    classList: { contains: (name) => name === "fl-card" },
    querySelector() { return this.image },
  }))
  const grid = {
    children: cards,
    addEventListener(name, callback, capture) { assert.equal(capture, true); events.set(name, callback) },
    removeEventListener(name, callback, capture) {
      assert.equal(capture, true)
      if (events.get(name) === callback) events.delete(name)
    },
  }
  class Observer {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.observed = new Set()
      observers.push(this)
    }
    observe(element) { this.observed.add(element) }
    unobserve(element) { this.observed.delete(element) }
    disconnect() { this.observed.clear(); this.disconnected = true }
  }
  const exports = {}
  vm.runInNewContext(source, {
    exports,
    IntersectionObserver: withObserver ? Observer : undefined,
    setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId },
    clearTimeout(id) { timers.delete(id) },
  }, { filename })
  const admitted = []
  let releases = 0
  const start = () => exports.watchShopImages(grid, (index) => admitted.push(index), () => releases++)
  return {
    start, cards, observers, timers, events, admitted,
    get releases() { return releases },
    settle(index, kind = "load") {
      cards[index].image.complete = true
      events.get(kind)?.({ target: cards[index].image })
    },
  }
}

test("only visible later rows are admitted while the first eight images are pending", () => {
  const f = fixture()
  f.start()
  assert.equal(f.observers.length, 1)
  const observer = f.observers[0]
  assert.equal(observer.options.rootMargin, "100px 0px")
  assert.equal(observer.observed.size, 8)
  assert.equal(observer.observed.has(f.cards[0]), false)
  observer.callback([{ target: f.cards[10], isIntersecting: false }])
  assert.deepEqual(f.admitted, [])
  observer.callback([{ target: f.cards[10], isIntersecting: true }])
  assert.deepEqual(f.admitted, [10], "scrolling past slow images must reveal the requested card")
  assert.equal(observer.observed.has(f.cards[10]), false)
  assert.equal(f.releases, 0)
  for (let i = 0; i < 7; i++) f.settle(i)
  assert.equal(f.releases, 0)
  f.settle(7)
  assert.equal(f.releases, 1)
  assert.equal(observer.disconnected, true)
  assert.equal(f.events.size, 0)
  assert.equal(f.timers.size, 0)
})

test("cached images, missing-image fallbacks and fewer than eight cards release immediately", () => {
  for (const count of [0, 3, 8, 16]) {
    const f = fixture({ count, complete: true })
    if (count) f.cards[0].image = null
    f.start()
    assert.equal(f.releases, 1, `already complete first images release a ${count}-card page`)
    assert.equal(f.observers.length, 0)
    assert.equal(f.timers.size, 0)
    assert.equal(f.events.size, 0)
  }
})

test("a failed critical image settles the batch and a stalled request has a four-second escape", () => {
  const failed = fixture()
  failed.start()
  for (let i = 0; i < 7; i++) failed.settle(i)
  failed.settle(7, "error")
  assert.equal(failed.releases, 1, "one broken image must not hold every other row")

  const stalled = fixture()
  stalled.start()
  const timer = [...stalled.timers.values()][0]
  assert.equal(timer.ms, 4000)
  timer.callback()
  assert.equal(stalled.releases, 1)
  assert.equal(stalled.events.size, 0)
  assert.equal(stalled.observers[0].disconnected, true)
  timer.callback()
  assert.equal(stalled.releases, 1, "a repeated callback cannot release twice")
})

test("route/sort cleanup rejects stale callbacks and the next batch waits for its own images", () => {
  const old = fixture()
  const cleanup = old.start()
  const oldObserver = old.observers[0]
  const oldTimer = [...old.timers.values()][0]
  const oldLoad = old.events.get("load")
  cleanup()
  assert.equal(old.events.size, 0)
  assert.equal(old.timers.size, 0)
  assert.equal(oldObserver.disconnected, true)
  oldObserver.callback([{ target: old.cards[10], isIntersecting: true }])
  oldTimer.callback()
  oldLoad({ target: old.cards[0].image })
  assert.deepEqual(old.admitted, [])
  assert.equal(old.releases, 0)

  const current = fixture({ count: 10 })
  current.start()
  for (let i = 0; i < 8; i++) current.settle(i)
  assert.equal(current.releases, 1)
  assert.equal(old.releases, 0)
})

test("browsers without IntersectionObserver fail open to native lazy loading", () => {
  const f = fixture({ withObserver: false })
  f.start()
  assert.equal(f.releases, 1)
  assert.equal(f.events.size, 0)
  assert.equal(f.timers.size, 0)
})

test("the hook resets admission before a changed route or image batch can commit", () => {
  const hookFilename = path.join(__dirname, "../src/components/use-shop-image-loading.ts")
  const hookSource = ts.transpileModule(fs.readFileSync(hookFilename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  let state
  let effectKey
  let pendingEffect
  let cleanup
  const batches = []
  const grid = { current: {} }
  const exports = {}
  vm.runInNewContext(hookSource, {
    exports,
    require(name) {
      if (name === "react") return {
        useRef: () => grid,
        useState(initial) {
          if (!state) state = initial()
          return [state, (next) => { state = typeof next === "function" ? next(state) : next }]
        },
        useEffect(effect, [key]) {
          if (effectKey === key) return
          effectKey = key
          pendingEffect = effect
        },
      }
      if (name === "@/lib/shop-image-loading") return {
        SHOP_PRIORITY_IMAGES: 8,
        watchShopImages(element, admit, release) {
          assert.equal(element, grid.current)
          const batch = { admit, release, stopped: false }
          batches.push(batch)
          return () => { batch.stopped = true }
        },
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename: hookFilename })
  const render = (key) => exports.useShopImageLoading(key)
  const commit = () => {
    if (!pendingEffect) return
    cleanup?.()
    cleanup = pendingEffect()
    pendingEffect = undefined
  }

  let view = render("first-route:images-a")
  assert.equal(view.deferred(7), false)
  assert.equal(view.deferred(8), true)
  commit()
  batches[0].admit(11)
  view = render("first-route:images-a")
  assert.equal(view.deferred(11), false)
  assert.equal(view.deferred(10), true)
  batches[0].release()
  assert.equal(render("first-route:images-a").deferred(10), false)

  // Test before effect cleanup: stale released state must not mount all of the
  // new batch, and an in-flight callback from the old observer cannot unlock it.
  view = render("same-route:new-sort-or-images-b")
  assert.equal(view.deferred(8), true)
  batches[0].admit(10)
  batches[0].release()
  assert.equal(render("same-route:new-sort-or-images-b").deferred(10), true)
  commit()
  assert.equal(batches[0].stopped, true)
  assert.equal(batches.length, 2)
  render("same-route:new-sort-or-images-b")
  commit()
  assert.equal(batches.length, 2, "unchanged batches do not recreate observers")
  batches[1].release()
  assert.equal(render("same-route:new-sort-or-images-b").deferred(8), false)
  cleanup()
  assert.equal(batches[1].stopped, true)
})
