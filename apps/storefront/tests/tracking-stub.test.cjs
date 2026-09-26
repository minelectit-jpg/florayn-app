const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const jsxRuntime = require("react/jsx-runtime")
const { renderToStaticMarkup } = require("react-dom/server")

// components/tracking/tracker-stub.tsx (TRACKING.md 5.1): the layout's tracker.
// It is driven here without React through its exported effect bodies, in a
// fake browser (a vm realm whose global is the window), with the real queue
// and paths modules and a stand-in for the lazy runtime.
const root = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
const compile = (file) => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  fileName: file,
}).outputText
const STUB = "src/components/tracking/tracker-stub.tsx"
const code = {
  paths: compile("src/lib/tracking/paths.ts"),
  queue: compile("src/lib/tracking/queue.ts"),
  stub: compile(STUB),
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** The stub, the queue and paths in `context` (made a vm realm here); `runtime` stands in for the lazy chunk. */
function loadStub(context, { runtime, retry = [] } = {}) {
  vm.createContext(context)
  const cache = {}
  const run = (name, source) => {
    const module = { exports: {} }
    vm.runInContext(`(function (exports, require, module) {${source}\n})`, context, { filename: name })(module.exports, require, module)
    return (cache[name] = module.exports)
  }
  function require(name) {
    if (name === "react") return React
    if (name === "react/jsx-runtime") return jsxRuntime
    if (name === "next/navigation") return { usePathname: () => context.__pathname ?? "/" }
    if (name === "@/components/header/load-on-intent") {
      return { retryImport: (load, reload) => { retry.push(reload); return load() } }
    }
    if (name === "@/lib/tracking/runtime") return runtime ?? { start: () => Promise.resolve() }
    if (name === "@/lib/tracking/paths" || name === "./paths") return cache.paths ?? run("paths", code.paths)
    if (name === "@/lib/tracking/queue") return cache.queue ?? run("queue", code.queue)
    throw new Error(`Unexpected import ${name}`)
  }
  const stub = run("stub", code.stub)
  return { stub, queue: cache.queue, paths: cache.paths }
}

/** Timers, idle callbacks and listeners that the test runs by hand. */
function browser(url = "https://new.florayn.com/", options = {}) {
  const { referrer = "", readyState = "complete", saveData = false, idle = true, beaconOk = true } = options
  const at = new URL(url)
  const location = { pathname: at.pathname, search: at.search, host: at.host }
  const log = { fetches: [], beacons: [], idles: [], timers: [], started: 0, retry: [] }
  const listeners = { window: new Map(), document: new Map() }
  const on = (target) => (type, fn) => {
    if (!listeners[target].has(type)) listeners[target].set(type, new Set())
    listeners[target].get(type).add(fn) // a Set: adding the same listener twice is a no-op, as in browsers
  }
  const off = (target) => (type, fn) => listeners[target].get(type)?.delete(fn)
  const answer = { current: null }
  const context = {
    URL, URLSearchParams, console,
    location,
    document: { referrer, readyState, visibilityState: "visible", addEventListener: on("document"), removeEventListener: off("document") },
    navigator: {
      connection: saveData ? { saveData: true } : undefined,
      sendBeacon: (target, body) => {
        log.beacons.push({ target, body })
        return beaconOk
      },
    },
    fetch: (target, init) => {
      log.fetches.push({ target, init })
      return typeof answer.current === "function" ? answer.current(target, init) : Promise.resolve({ json: () => Promise.resolve(answer.current) })
    },
    Blob: class Blob {
      constructor(parts, init) {
        this.parts = parts
        this.type = init?.type
      }
    },
    setTimeout: (fn, ms, ...args) => log.timers.push({ fn, ms, args }),
    addEventListener: on("window"),
    removeEventListener: off("window"),
    crypto: { randomUUID: () => crypto.randomUUID() },
  }
  if (idle) context.requestIdleCallback = (fn, opts) => log.idles.push({ fn, opts })
  context.window = context
  const runtime = { start: () => { log.started++; return Promise.resolve() } }
  const loaded = loadStub(context, { runtime, retry: log.retry })
  const go = (next) => {
    const to = new URL(next, `https://${location.host}${location.pathname}${location.search}`)
    location.pathname = to.pathname
    location.search = to.search
  }
  /** Navigate and run the stub's pathname effect, as usePathname() would. */
  const visit = (next) => {
    go(next)
    loaded.stub.onPath(location.pathname)
  }
  const runIdle = async () => {
    while (log.idles.length) log.idles.shift().fn()
    await flush()
  }
  const runTimers = async () => {
    while (log.timers.length) {
      const timer = log.timers.shift()
      timer.fn(...timer.args)
      await flush()
    }
  }
  const fire = (target, type) => {
    for (const fn of [...(listeners[target].get(type) ?? [])]) fn({ type })
  }
  return { ...loaded, context, location, log, listeners, answer, go, visit, runIdle, runTimers, fire, state: () => context.__fl }
}

const ON = (extra = {}) => ({
  v: 1, on: true, env: "test", ext: "e".repeat(64), sid: "s1.1790467200.0a1b2c3d", src: "direct", staff: false, optout: false,
  share: false, consent_version: 1, landing: { url: "https://new.florayn.com/", click: null, src: "direct" },
  meta: { id: "2247389409441720", load: true }, tiktok: null, google: null, ...extra,
})
const OFF = { v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false, optout: false, share: false,
  consent_version: 1, landing: null, meta: null, tiktok: null, google: null }

test("the stub renders null and loads without touching a browser global", () => {
  const touched = []
  const context = { URL, URLSearchParams }
  for (const name of ["window", "document", "location", "navigator", "fetch", "sessionStorage", "localStorage", "history", "requestIdleCallback", "addEventListener"]) {
    Object.defineProperty(context, name, { enumerable: true, get() { touched.push(name); return undefined } })
  }
  const { stub } = loadStub(context)
  assert.deepEqual(touched, [], "nothing at module load")
  assert.equal(renderToStaticMarkup(React.createElement(stub.default)), "")
  assert.equal(renderToStaticMarkup(React.createElement(React.StrictMode, null, React.createElement(stub.default))), "")
  assert.deepEqual(touched, [], "nothing while rendering on the server either")
})

test("one PageView per public pathname: the document's first has first true, StrictMode's second run adds nothing", () => {
  const page = browser("https://new.florayn.com/product/zebra/?case=signature&fbclid=abc&review=tok")
  page.stub.onPath("/product/zebra/")
  page.stub.onPath("/product/zebra/")
  assert.deepEqual(plain(page.state().q.map(({ n, p, d }) => ({ n, p, d }))), [
    { n: "PageView", p: "/product/zebra/?case=signature", d: { first: true } },
  ])
  page.go("/product/zebra/?case=signature&device=iPhone+17")
  page.stub.onPath("/product/zebra/")
  assert.equal(page.state().q.length, 1, "a query-only change is not a new page")
  page.visit("/shop/")
  page.visit("/shop/")
  page.visit("/product/zebra/")
  assert.deepEqual(plain(page.state().q.map(({ n, p, d }) => ({ n, p, d }))), [
    { n: "PageView", p: "/product/zebra/?case=signature", d: { first: true } },
    { n: "PageView", p: "/shop/", d: { first: false } },
    { n: "PageView", p: "/product/zebra/", d: { first: false } },
  ])
})

test("private pages record nothing and make no id call", async () => {
  for (const url of ["https://new.florayn.com/order/order_01ABC/?review=tok", "https://new.florayn.com/men/account/", "https://new.florayn.com/review/tok/"]) {
    const page = browser(url, { referrer: "https://www.facebook.com/" })
    page.stub.onPath(page.location.pathname)
    await page.runIdle()
    await page.runTimers()
    assert.equal(page.state()?.q.length ?? 0, 0, url)
    assert.equal(page.state()?.landing ?? null, null, url)
    assert.equal(page.log.fetches.length, 0, url)
  }
})

test("the id call waits for idle and sends the landing snapshot: allowlisted params and the referrer's origin only", async () => {
  const page = browser("https://new.florayn.com/product/zebra/?fbclid=abc&utm_source=fb&case=signature&review=tok&r=5", {
    referrer: "https://l.facebook.com/l.php?u=https%3A%2F%2Fnew.florayn.com%2F&h=secret",
  })
  page.answer.current = ON()
  page.stub.onPath("/product/zebra/")
  assert.equal(page.log.fetches.length, 0, "nothing before idle")
  assert.equal(page.log.idles.length, 1)
  assert.equal(page.log.idles[0].opts.timeout, 2000)
  await page.runIdle()
  assert.equal(page.log.fetches.length, 1)
  const [{ target, init }] = page.log.fetches
  assert.equal(target, "/api/t/id/")
  assert.deepEqual(plain({ ...init, body: undefined }), {
    method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" },
  })
  assert.deepEqual(JSON.parse(init.body), {
    v: 1, landing: { q: { fbclid: "abc", utm_source: "fb" }, ref: "https://l.facebook.com", path: "/product/zebra/" },
  })
  assert.deepEqual(plain(page.state().cfg), ON())
  assert.deepEqual(plain(await page.state().cfgPromise), ON())

  page.visit("/shop/")
  await page.runIdle()
  assert.equal(page.log.fetches.length, 1, "once per document")
  assert.equal(JSON.parse(init.body).landing.path, "/product/zebra/", "the first public path stays the landing")
})

test("without requestIdleCallback the id call goes in the next task; no referrer or a non-web one gives ref null", async () => {
  for (const referrer of ["", "android-app://com.google.android.gm/"]) {
    const page = browser("https://new.florayn.com/", { idle: false, referrer })
    page.answer.current = ON()
    page.stub.onPath("/")
    assert.equal(page.log.fetches.length, 0)
    assert.equal(page.log.timers.length, 1)
    assert.equal(page.log.timers[0].ms, undefined)
    page.log.timers.shift().fn()
    await flush()
    assert.equal(JSON.parse(page.log.fetches[0].init.body).landing.ref, null)
  }
})

test("an idle moment on a private page skips the id call until the next public pathname", async () => {
  const page = browser("https://new.florayn.com/?utm_campaign=sept")
  page.answer.current = ON()
  page.stub.onPath("/")
  page.visit("/account/")
  await page.runIdle()
  assert.equal(page.log.fetches.length, 0, "no id call from /account/")
  page.visit("/shop/")
  await page.runIdle()
  assert.equal(page.log.fetches.length, 1)
  assert.deepEqual(JSON.parse(page.log.fetches[0].init.body).landing, { q: { utm_campaign: "sept" }, ref: null, path: "/" })
})

test("a failed, refused or malformed id answer stores the inert answer and loads no runtime", async () => {
  const answers = [
    () => Promise.reject(new TypeError("offline")),
    () => Promise.resolve({ json: () => Promise.reject(new SyntaxError("204 has no body")) }),
    () => Promise.resolve({ json: () => Promise.resolve({ error: "forbidden" }) }),
    () => Promise.resolve({ json: () => Promise.resolve(null) }),
    OFF,
  ]
  for (const answer of answers) {
    const page = browser("https://new.florayn.com/", { readyState: "loading" })
    page.answer.current = answer
    page.stub.onPath("/")
    await page.runIdle()
    assert.deepEqual(plain(page.state().cfg), OFF)
    assert.deepEqual(plain(await page.state().cfgPromise), OFF)
    assert.equal(page.listeners.window.get("load")?.size ?? 0, 0, "no runtime scheduled")
    page.fire("window", "load")
    await page.runTimers()
    await page.runIdle()
    assert.equal(page.log.started, 0)
  }
})

test("pagehide and hidden beacon unsent events as text/plain JSON to /api/t/e/, only while tracking is on", async () => {
  const page = browser("https://new.florayn.com/product/zebra/")
  page.answer.current = ON()
  page.stub.onPath("/product/zebra/")
  page.fire("window", "pagehide")
  assert.equal(page.log.beacons.length, 0, "no answer yet: nothing leaves")
  await page.runIdle()
  page.queue.track("ViewContent", { value: 1400 })
  page.fire("window", "pagehide")
  assert.equal(page.log.beacons.length, 1)
  const [{ target, body }] = page.log.beacons
  assert.equal(target, "/api/t/e/")
  assert.equal(body.type, "text/plain")
  const batch = JSON.parse(body.parts.join(""))
  assert.equal(batch.v, 1)
  assert.equal(typeof batch.sent_at, "number")
  assert.deepEqual(batch.events.map((event) => event.n), ["PageView", "ViewContent"])
  assert.ok(page.state().q.every((item) => item.s === 1), "handed off")

  page.fire("document", "visibilitychange")
  page.context.document.visibilityState = "hidden"
  page.fire("document", "visibilitychange")
  assert.equal(page.log.beacons.length, 1, "nothing left to send")
  page.queue.track("AddToCart", { value: 1400 })
  page.fire("document", "visibilitychange")
  assert.equal(page.log.beacons.length, 2, "hidden sends the rest")

  page.visit("/shop/")
  page.visit("/cart/")
  assert.equal(page.listeners.window.get("pagehide").size, 1, "one listener however many pages")
  assert.equal(page.listeners.document.get("visibilitychange").size, 1)
})

test("a refused beacon keeps the events for the next send; an inert browser sends nothing", async () => {
  const refused = browser("https://new.florayn.com/", { beaconOk: false })
  refused.answer.current = ON()
  refused.stub.onPath("/")
  await refused.runIdle()
  refused.fire("window", "pagehide")
  assert.equal(refused.log.beacons.length, 1)
  assert.equal(refused.state().q[0].s, undefined, "restored")

  const inert = browser("https://new.florayn.com/")
  inert.answer.current = OFF
  inert.stub.onPath("/")
  await inert.runIdle()
  inert.fire("window", "pagehide")
  inert.context.document.visibilityState = "hidden"
  inert.fire("document", "visibilitychange")
  assert.equal(inert.log.beacons.length, 0)
  assert.equal(inert.state().q.length, 1, "kept, never sent")
})

test("a visitor from an ad click gets the runtime at load, with no wait and no idle", async () => {
  const page = browser("https://new.florayn.com/?fbclid=abc", { readyState: "loading" })
  page.answer.current = ON({ landing: { url: "https://new.florayn.com/?fbclid=abc", click: "fbclid", src: "meta" } })
  page.stub.onPath("/")
  await page.runIdle()
  assert.equal(page.log.started, 0, "not before load")
  assert.equal(page.log.timers.length + page.log.idles.length, 0)
  page.fire("window", "load")
  await flush()
  assert.equal(page.log.started, 1)
  assert.deepEqual(page.log.retry, [false], "through retryImport, never reloading the page")
})

test("/checkout/ gets the runtime at load + idle, with no 3 s wait", async () => {
  const page = browser("https://new.florayn.com/checkout/")
  page.answer.current = ON()
  page.stub.onPath("/checkout/")
  await page.runIdle()
  // The id answer landed after load (readyState complete): only an idle wait is left.
  assert.equal(page.log.started, 0)
  assert.equal(page.log.timers.length, 0, "no 3 s timer")
  assert.equal(page.log.idles.length, 1)
  await page.runIdle()
  assert.equal(page.log.started, 1)
})

test("other pages get the runtime at load + 3 s + idle", async () => {
  const page = browser("https://new.florayn.com/shop/", { readyState: "loading" })
  page.answer.current = ON()
  page.stub.onPath("/shop/")
  await page.runIdle()
  page.fire("window", "load")
  assert.equal(page.log.timers.length, 1)
  assert.equal(page.log.timers[0].ms, 3000)
  assert.equal(page.log.idles.length, 0)
  await page.runTimers()
  assert.equal(page.log.started, 0, "still waiting for idle")
  assert.equal(page.log.idles.length, 1)
  await page.runIdle()
  assert.equal(page.log.started, 1)
})

test("no runtime when tracking is off, the browser opted out, or Save-Data is on", async () => {
  const cases = [
    [{}, { on: false }],
    [{}, { on: false, optout: true }],
    [{}, { optout: true }],
    [{ saveData: true }, {}],
  ]
  for (const [options, extra] of cases) {
    const page = browser("https://new.florayn.com/?fbclid=abc", options)
    page.stub.scheduleRuntime(ON({ landing: { url: null, click: "fbclid", src: "meta" }, ...extra }))
    page.fire("window", "load")
    await page.runTimers()
    await page.runIdle()
    assert.equal(page.log.started, 0, JSON.stringify([options, extra]))
  }
})

test("every pathname change wakes the runtime, private ones too, and a failing wake never reaches the page", () => {
  const page = browser("https://new.florayn.com/")
  const woke = []
  page.stub.onPath("/")
  page.state().wake = () => woke.push(page.location.pathname)
  page.visit("/order/order_01ABC/")
  page.visit("/")
  page.visit("/")
  assert.deepEqual(woke, ["/order/order_01ABC/", "/"])
  page.state().wake = () => { throw new Error("vendor failed") }
  assert.doesNotThrow(() => page.visit("/shop/"))
  assert.equal(page.state().q.at(-1).p, "/shop/")
})

test("the stub keeps the layout rules: import() through retryImport, no next/dynamic, <Script> or useSearchParams", () => {
  const source = read(STUB)
  assert.match(source, /^"use client"\n/)
  assert.ok(source.includes(`retryImport(() => import("@/lib/tracking/runtime"), false)`))
  assert.doesNotMatch(source, /next\/dynamic|next\/script|<Script\b|useSearchParams|next\/headers|cookies\(|searchParams\b/)
  assert.doesNotMatch(source, /fl-runtime-v1/, "the runtime marker lives only in the lazy chunk")
  const imports = [...source.matchAll(/^import\b[^\n]*$/gm)].map((match) => match[0])
  assert.deepEqual(imports, [
    `import { usePathname } from "next/navigation"`,
    `import { useEffect } from "react"`,
    `import { retryImport } from "@/components/header/load-on-intent"`,
    `import type { IdResponse } from "@/lib/tracking/contract"`,
    `import { isPrivatePath, landingParams } from "@/lib/tracking/paths"`,
    `import { fl, restoreUnsent, takeUnsent, track } from "@/lib/tracking/queue"`,
  ], "only types from contract.ts; the lazy runtime only through import()")
  assert.deepEqual([...source.matchAll(/\bimport\(\s*"([^"]+)"/g)].map((match) => match[1]), ["@/lib/tracking/runtime"])
})

test("the layout mounts the stub right after PerformanceAuditLoader and still reads no cookies, headers or searchParams", () => {
  const layout = read("src/app/layout.tsx")
  assert.equal(layout.match(/^import TrackerStub from "@\/components\/tracking\/tracker-stub"$/gm)?.length, 1)
  assert.equal(layout.match(/TrackerStub/g).length, 2, "one import, one element")
  assert.match(layout, /<PerformanceAuditLoader \/>\n\s*<TrackerStub \/>\n\s*<CartProvider>/)
  assert.doesNotMatch(layout, /next\/headers|cookies\(|searchParams|useSearchParams/)
})
