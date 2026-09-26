const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/queue.ts (TRACKING.md 5.1): the client queue every page ships.
// It must load without a window, record paths at call time and never batch a
// Purchase, and it may import nothing but ./paths values and ./contract types.
const root = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
const compile = (file) => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const pathsCode = compile("src/lib/tracking/paths.ts")
const queueCode = compile("src/lib/tracking/queue.ts")
const plain = (value) => JSON.parse(JSON.stringify(value))
const names = (items) => plain(items.map((item) => item.n))
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A fresh queue module in its own realm; `globals` become its window, location, crypto… */
function load(globals = {}) {
  const context = vm.createContext(Object.defineProperties({ URLSearchParams }, Object.getOwnPropertyDescriptors(globals)))
  const run = (code, filename) => {
    const exports = {}
    const require = (name) => {
      if (name === "./paths" && filename === "queue.ts") return paths
      throw new Error(`Unexpected import ${name}`)
    }
    vm.runInContext(`(function (exports, require) {${code}\n})`, context, { filename })(exports, require)
    return exports
  }
  const paths = run(pathsCode, "paths.ts")
  return run(queueCode, "queue.ts")
}

/** A browser page at `url`; `now` drives Date.now() and `location` can be moved. */
function browser(url = "https://new.florayn.com/", extra = {}) {
  const at = new URL(url)
  const location = { pathname: at.pathname, search: at.search }
  const clock = { now: 1790467200000 }
  const window = {}
  const queue = load({ window, location, crypto: { randomUUID: () => crypto.randomUUID(), getRandomValues: (b) => crypto.getRandomValues(b) },
    Date: { now: () => clock.now }, ...extra })
  const go = (next) => {
    const to = new URL(next, at)
    location.pathname = to.pathname
    location.search = to.search
  }
  return { queue, window, location, clock, go }
}

const block = { event_id: "fl-1234", value: 2860, currency: "BDT", num_items: 2,
  contents: [{ id: "variant_01K6EXAMPLEVARIANT01", quantity: 2, item_price: 1400 }],
  platforms: { meta: true, tiktok: false, google: false }, match: { meta: { external_id: "abc" } } }

test("importing the queue on the server throws nothing and does nothing", () => {
  const queue = load()
  queue.track("PageView", { first: true })
  queue.trackPurchase(block)
  assert.equal(queue.takeUnsent().length, 0)
  assert.equal(queue.fl().q.length, 0)
  assert.equal(queue.fl().cfg, null)
  assert.match(queue.newEventId(), UUID_V4)
})

test("track is a no-op on private paths", () => {
  for (const url of ["https://new.florayn.com/order/order_01ABC/?review=tok", "https://new.florayn.com/men/account/", "https://new.florayn.com/review/abc/"]) {
    const { queue, window } = browser(url)
    queue.track("PageView", { first: true })
    queue.track("AddToCart", { value: 1 })
    assert.equal(window.__fl?.q.length ?? 0, 0, url)
  }
})

test("an event records its path and time when it is tracked, with only case/device/variant", () => {
  const { queue, window, clock, go } = browser("https://new.florayn.com/product/x/?case=signature&fbclid=abc&review=tok&device=iPhone%2017&utm_source=fb")
  queue.track("ViewContent", { value: 1400 })
  clock.now += 5000
  go("/shop/?variant=variant_01ABCDEFGHIJ&gclid=zzz")
  queue.track("PageView")
  const [first, second] = window.__fl.q
  assert.equal(first.n, "ViewContent")
  assert.equal(first.p, "/product/x/?case=signature&device=iPhone+17")
  assert.equal(first.t, 1790467200000)
  assert.deepEqual(plain(first.d), { value: 1400 })
  assert.match(first.id, UUID_V4)
  assert.equal(second.p, "/shop/?variant=variant_01ABCDEFGHIJ")
  assert.equal(second.t, 1790467205000)
  assert.equal(JSON.stringify(second), JSON.stringify({ n: "PageView", id: second.id, t: 1790467205000, p: "/shop/?variant=variant_01ABCDEFGHIJ" }), "no d when none was given")
  assert.notEqual(first.id, second.id)
  assert.equal(first.s, undefined)
})

test("track keeps a given id (InitiateCheckout's ic- id)", () => {
  const { queue, window } = browser("https://new.florayn.com/checkout/")
  queue.track("InitiateCheckout", { value: 2800 }, "ic-0123456789abcdef01234567")
  assert.equal(window.__fl.q[0].id, "ic-0123456789abcdef01234567")
  assert.equal(window.__fl.q[0].p, "/checkout/")
})

test("fl() shares one state through window.__fl", () => {
  const { queue, window } = browser()
  const state = queue.fl()
  assert.equal(window.__fl, state)
  assert.equal(queue.fl(), state)
  assert.equal(state.landing, null)
  const existing = { q: [], landing: { q: {}, ref: null, path: "/" }, cfg: null }
  const second = browser()
  second.window.__fl = existing
  assert.equal(second.queue.fl(), existing, "the stub's state is reused, never replaced")
})

test("event ids are lower-case uuid v4 with and without randomUUID", () => {
  const withUuid = load({ crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" } })
  assert.equal(withUuid.newEventId(), "11111111-2222-4333-8444-555555555555")
  const randomValues = load({ crypto: { getRandomValues: (b) => crypto.getRandomValues(b) } })
  const noCrypto = load()
  const allOnes = load({ crypto: { getRandomValues: (b) => b.fill(255) } })
  assert.equal(allOnes.newEventId(), "ffffffff-ffff-4fff-bfff-ffffffffffff")
  const allZeros = load({ crypto: { getRandomValues: (b) => b.fill(0) } })
  assert.equal(allZeros.newEventId(), "00000000-0000-4000-8000-000000000000")
  const seen = new Set()
  for (const queue of [randomValues, noCrypto]) {
    for (let i = 0; i < 500; i++) {
      const id = queue.newEventId()
      assert.match(id, UUID_V4)
      seen.add(id)
    }
  }
  assert.equal(seen.size, 1000)
})

test("trackPurchase pushes a handed-off Purchase and wakes the runtime synchronously", () => {
  const { queue, window } = browser("https://new.florayn.com/checkout/?case=signature&r=1")
  const woke = []
  queue.fl().wake = () => woke.push(window.__fl.q.at(-1).n)
  queue.trackPurchase(block)
  assert.deepEqual(woke, ["Purchase"], "wake ran before trackPurchase returned")
  const item = window.__fl.q[0]
  assert.equal(item.n, "Purchase")
  assert.equal(item.id, "fl-1234")
  assert.equal(item.s, 1)
  assert.equal(item.p, "/checkout/?case=signature")
  assert.equal(item.d, block)

  const quiet = browser("https://new.florayn.com/checkout/")
  quiet.queue.trackPurchase(block)
  assert.equal(quiet.window.__fl.q.length, 1, "no runtime yet: queued only")
  quiet.queue.fl().wake = () => { throw new Error("vendor failed") }
  assert.doesNotThrow(() => quiet.queue.trackPurchase({ ...block, event_id: "fl-1235" }))
})

test("takeUnsent hands off browser events only, marks them, and restoreUnsent puts them back", () => {
  const { queue, window } = browser("https://new.florayn.com/product/x/")
  queue.track("PageView", { first: true })
  queue.track("ViewContent", { value: 1 })
  queue.trackPurchase(block)
  queue.track("AddToCart", { value: 2 })
  const firstTwo = queue.takeUnsent(2)
  assert.deepEqual(names(firstTwo), ["PageView", "ViewContent"])
  assert.ok(firstTwo.every((item) => item.s === 1))
  assert.equal(firstTwo[0], window.__fl.q[0], "the queued items themselves are marked")
  const rest = queue.takeUnsent()
  assert.deepEqual(names(rest), ["AddToCart"])
  assert.equal(queue.takeUnsent().length, 0)

  queue.restoreUnsent(rest)
  assert.equal(rest[0].s, undefined)
  assert.equal("s" in rest[0], false)
  assert.deepEqual(names(queue.takeUnsent()), ["AddToCart"])
  queue.restoreUnsent(window.__fl.q)
  assert.equal(window.__fl.q[2].s, 1, "a Purchase stays handed off")
  assert.deepEqual(names(queue.takeUnsent()), ["PageView", "ViewContent", "AddToCart"])

  for (let i = 0; i < 30; i++) queue.track("PageView")
  assert.equal(queue.takeUnsent().length, 25, "25 per batch by default")
  assert.equal(queue.takeUnsent().length, 5)
})

test("the queue imports only ./paths values and ./contract types, and stays tiny", () => {
  const source = read("src/lib/tracking/queue.ts")
  const imports = [...source.matchAll(/^import\b[^\n]*$/gm)].map((match) => match[0])
  assert.deepEqual(imports, [
    `import type { BrowserEventName, IdResponse, LandingSnapshot, PurchaseBlock } from "./contract"`,
    `import { isPrivatePath, safePath } from "./paths"`,
  ])
  assert.doesNotMatch(source, /\brequire\(|\bimport\(|from "(?!\.\/contract"|\.\/paths")/)
  assert.deepEqual([...queueCode.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]), ["./paths"], "the type import is erased")

  const paths = read("src/lib/tracking/paths.ts")
  assert.doesNotMatch(paths, /^\s*import\b|\brequire\(|\bimport\(/m, "paths.ts imports nothing")
  const bytes = Buffer.byteLength(source) + Buffer.byteLength(paths)
  assert.ok(bytes < 4096, `paths.ts + queue.ts are ${bytes} bytes of source`)
})

test("loading the queue touches no browser global (it runs in every page's layout chunk)", () => {
  const touched = []
  const globals = {}
  for (const name of ["window", "document", "location", "navigator", "crypto", "sessionStorage", "localStorage"]) {
    Object.defineProperty(globals, name, { enumerable: true, get() { touched.push(name); return {} } })
  }
  load(globals)
  assert.deepEqual(touched, [])
})
