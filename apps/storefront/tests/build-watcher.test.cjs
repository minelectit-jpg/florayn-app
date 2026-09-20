const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/components/build-watcher.tsx")
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function harness({ pathname = "/shop/", buildId = "build_old", alreadyFor = null } = {}) {
  const effects = [], requests = [], events = [], storageWrites = []
  const windowEvents = new Map(), documentEvents = new Map(), timers = new Map()
  let reloaded = 0
  const window = {
    location: { pathname, reload() { reloaded++ } },
    sessionStorage: {
      getItem() { return alreadyFor },
      setItem(key, value) { storageWrites.push({ key, value }); alreadyFor = value },
    },
    dispatchEvent(event) { events.push(event.type) },
    addEventListener(name, callback) { windowEvents.set(name, callback) },
    removeEventListener(name, callback) { if (windowEvents.get(name) === callback) windowEvents.delete(name) },
    setInterval(callback, ms) { timers.set(1, { callback, ms }); return 1 },
    clearInterval(id) { timers.delete(id) },
  }
  const document = {
    hidden: false,
    addEventListener(name, callback) { documentEvents.set(name, callback) },
    removeEventListener(name, callback) { if (documentEvents.get(name) === callback) documentEvents.delete(name) },
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, window, document,
    CustomEvent: class { constructor(type) { this.type = type } },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    require(name) {
      if (name === "react") return { useRef: (current) => ({ current }), useEffect: (effect) => effects.push(effect) }
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  exports.default({ buildId })
  const cleanup = effects[0]()
  return { window, document, requests, events, storageWrites, windowEvents, documentEvents, timers, cleanup,
    get reloads() { return reloaded },
    async respond(index = 0, id = "build_new") {
      requests[index].resolve({ ok: true, json: async () => ({ id }) })
      await new Promise(setImmediate)
    },
  }
}

test("new builds on checkout notify the form without reload or consuming its session marker", async () => {
  for (const pathname of ["/checkout", "/checkout/"]) {
    const h = harness({ pathname })
    assert.equal(h.requests[0].url, "/api/build-id/")
    assert.equal(h.requests[0].options.cache, "no-store")
    await h.respond()
    assert.deepEqual(h.events, ["florayn:checkout-update"])
    assert.equal(h.reloads, 0)
    assert.deepEqual(h.storageWrites, [])
    h.windowEvents.get("focus")()
    await h.respond(1)
    assert.equal(h.events.length, 2, "a later mount can receive the checkout update too")
    h.cleanup()
  }
})

test("normal routes retain one reload per server build, including after leaving checkout", async () => {
  const h = harness({ pathname: "/checkout/" })
  await h.respond()
  h.window.location.pathname = "/cart/"
  h.windowEvents.get("focus")()
  await h.respond(1)
  assert.equal(h.reloads, 1)
  assert.deepEqual(h.storageWrites, [{ key: "fl-buildwatch-reloaded-for", value: "build_new" }])
  h.windowEvents.get("focus")()
  assert.equal(h.requests.length, 2, "once reloading, no duplicate check is launched")
  h.cleanup()
  const remount = harness({ pathname: "/shop/", alreadyFor: "build_new" })
  await remount.respond()
  assert.equal(remount.reloads, 0)
  assert.deepEqual(remount.events, [])
  remount.cleanup()
})

test("cleanup removes triggers and ignores a build response arriving after unmount", async () => {
  for (const pathname of ["/checkout/", "/product/example/"]) {
    const h = harness({ pathname })
    assert.equal(h.timers.get(1).ms, 60000)
    h.cleanup()
    assert.equal(h.windowEvents.size, 0)
    assert.equal(h.documentEvents.size, 0)
    assert.equal(h.timers.size, 0)
    await h.respond()
    assert.equal(h.reloads, 0)
    assert.deepEqual(h.events, [])
    assert.deepEqual(h.storageWrites, [])
  }
})

test("same-build checks and hidden tabs do not disturb checkout", async () => {
  const h = harness({ pathname: "/checkout/" })
  await h.respond(0, "build_old")
  assert.deepEqual(h.events, [])
  h.document.hidden = true
  h.windowEvents.get("focus")()
  h.documentEvents.get("visibilitychange")()
  assert.equal(h.requests.length, 1)
  h.document.hidden = false
  h.windowEvents.get("pageshow")({ persisted: true })
  await h.respond(1)
  assert.deepEqual(h.events, ["florayn:checkout-update"])
  assert.equal(h.reloads, 0)
  h.cleanup()
})
