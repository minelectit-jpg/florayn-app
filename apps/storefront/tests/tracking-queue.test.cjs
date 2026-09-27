const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/queue.ts (TRACKING.md 5.1): the client queue every page ships.
// It must load without a window, record the raw address and the time at call
// time and never batch a Purchase, and it may import nothing but the
// ./paths check and ./contract types. lib/tracking/batch.ts (lazy chunks
// only) is where a queued event gets its id and its safe path on its way out.
const root = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
const compile = (file) => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const code = Object.fromEntries(["paths", "contract", "queue", "batch"].map((name) => [name, compile(`src/lib/tracking/${name}.ts`)]))
const plain = (value) => JSON.parse(JSON.stringify(value))
const names = (items) => plain(items.map((item) => item.n))
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Fresh queue and batch modules in their own realm; `globals` become its window, location, crypto… */
function loadAll(globals = {}) {
  const context = vm.createContext(Object.defineProperties({ URLSearchParams }, Object.getOwnPropertyDescriptors(globals)))
  const cache = {}
  const run = (name) => {
    if (cache[name]) return cache[name]
    const exports = (cache[name] = {})
    const require = (spec) => {
      if (!/^\.\/(paths|contract|queue)$/.test(spec)) throw new Error(`Unexpected import ${spec} in ${name}.ts`)
      return run(spec.slice(2))
    }
    vm.runInContext(`(function (exports, require) {${code[name]}\n})`, context, { filename: `${name}.ts` })(exports, require)
    return exports
  }
  return { queue: run("queue"), batch: run("batch") }
}
const load = (globals) => loadAll(globals).queue

/** A browser page at `url`; `now` drives Date.now() and `location` can be moved. */
function browser(url = "https://new.florayn.com/", extra = {}) {
  const at = new URL(url)
  const location = { pathname: at.pathname, search: at.search }
  const clock = { now: 1790467200000 }
  const window = {}
  const { queue, batch } = loadAll({ window, location, crypto: { randomUUID: () => crypto.randomUUID(), getRandomValues: (b) => crypto.getRandomValues(b) },
    Date: { now: () => clock.now }, ...extra })
  const go = (next) => {
    const to = new URL(next, at)
    location.pathname = to.pathname
    location.search = to.search
  }
  return { queue, batch, window, location, clock, go }
}

const block = { event_id: "fl-1234", value: 2860, currency: "BDT", num_items: 2,
  contents: [{ id: "variant_01K6EXAMPLEVARIANT01", quantity: 2, item_price: 1400 }],
  platforms: { meta: true, tiktok: false, google: false }, match: { meta: { external_id: "abc" } } }

test("importing the queue on the server throws nothing and does nothing", () => {
  const { queue, batch } = loadAll()
  queue.track("PageView", { first: true })
  queue.trackPurchase(block)
  assert.equal(batch.takeUnsent().length, 0)
  assert.equal(queue.fl().q.length, 0)
  assert.equal(queue.fl().cfg, null)
  assert.match(batch.newEventId(), UUID_V4)
})

test("track is a no-op on private paths", () => {
  for (const url of ["https://new.florayn.com/order/order_01ABC/?review=tok", "https://new.florayn.com/men/account/", "https://new.florayn.com/review/abc/"]) {
    const { queue, window } = browser(url)
    queue.track("PageView", { first: true })
    queue.track("AddToCart", { value: 1 })
    assert.equal(window.__fl?.q.length ?? 0, 0, url)
  }
})

test("an event records its address and time when it is tracked, and leaves with an id and only case/device/variant", () => {
  const { queue, batch, window, clock, go } = browser("https://new.florayn.com/product/x/?case=signature&fbclid=abc&review=tok&device=iPhone%2017&utm_source=fb")
  queue.track("ViewContent", { value: 1400 })
  clock.now += 5000
  go("/shop/?variant=variant_01ABCDEFGHIJ&gclid=zzz")
  queue.track("PageView")
  const [first, second] = window.__fl.q
  assert.equal(first.n, "ViewContent")
  assert.equal(first.p, "/product/x/?case=signature&fbclid=abc&review=tok&device=iPhone%2017&utm_source=fb", "the address at call time")
  assert.equal(first.t, 1790467200000)
  assert.deepEqual(plain(first.d), { value: 1400 })
  assert.equal(first.id, undefined, "the layout chunk makes no ids")
  assert.equal(second.p, "/shop/?variant=variant_01ABCDEFGHIJ&gclid=zzz")
  assert.equal(second.t, 1790467205000)

  go("/cart/")
  const sent = batch.takeUnsent()
  assert.equal(sent.length, 2)
  assert.ok(sent[0] === first && sent[1] === second, "the queued items themselves, prepared in place")
  assert.equal(first.p, "/product/x/?case=signature&device=iPhone+17")
  assert.match(first.id, UUID_V4)
  assert.equal(second.p, "/shop/?variant=variant_01ABCDEFGHIJ", "its own page, not the current one")
  assert.equal(second.t, 1790467205000)
  assert.equal(JSON.stringify({ ...second, s: undefined }), JSON.stringify({ n: "PageView", id: second.id, t: 1790467205000, p: "/shop/?variant=variant_01ABCDEFGHIJ" }), "no d when none was given")
  assert.notEqual(first.id, second.id)
  assert.doesNotMatch(JSON.stringify(window.__fl.q), /review|fbclid|gclid|utm_/, "no raw address is left in the queue")
})

test("prepare() is idempotent: it keeps a given or earlier id and a path already cut", () => {
  const { batch } = browser()
  const long = `/product/${"x".repeat(320)}/`
  const items = [
    { n: "InitiateCheckout", id: "ic-0123456789abcdef01234567", t: 1, p: "/checkout/?r=5" },
    { n: "PageView", t: 1, p: `${long}?case=signature` },
    { n: "PageView", t: 1, p: "/order/order_01ABC/" },
  ]
  const once = items.map((item) => ({ ...batch.prepare(item) }))
  const twice = items.map((item) => ({ ...batch.prepare(item) }))
  assert.deepEqual(twice, once)
  assert.equal(once[0].id, "ic-0123456789abcdef01234567")
  assert.equal(once[0].p, "/checkout/")
  assert.equal(once[1].p, long.slice(0, 300), "over 300 chars keeps only the pathname")
  assert.equal(once[2].p, "/order/order_01ABC/", "prepare only cuts; the endpoint rejects private paths")
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
  const existing = { q: [], landing: { search: "", ref: "", path: "/" }, cfg: null }
  const second = browser()
  second.window.__fl = existing
  assert.equal(second.queue.fl(), existing, "the stub's state is reused, never replaced")
})

test("event ids are lower-case uuid v4 with and without randomUUID", () => {
  const ids = (globals) => loadAll(globals).batch
  const withUuid = ids({ crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" } })
  assert.equal(withUuid.newEventId(), "11111111-2222-4333-8444-555555555555")
  const randomValues = ids({ crypto: { getRandomValues: (b) => crypto.getRandomValues(b) } })
  const noCrypto = ids()
  const allOnes = ids({ crypto: { getRandomValues: (b) => b.fill(255) } })
  assert.equal(allOnes.newEventId(), "ffffffff-ffff-4fff-bfff-ffffffffffff")
  const allZeros = ids({ crypto: { getRandomValues: (b) => b.fill(0) } })
  assert.equal(allZeros.newEventId(), "00000000-0000-4000-8000-000000000000")
  const seen = new Set()
  for (const batch of [randomValues, noCrypto]) {
    for (let i = 0; i < 500; i++) {
      const id = batch.newEventId()
      assert.match(id, UUID_V4)
      seen.add(id)
    }
  }
  assert.equal(seen.size, 1000)
})

test("trackPurchase pushes a handed-off Purchase and wakes the runtime synchronously", () => {
  const { queue, batch, window } = browser("https://new.florayn.com/checkout/?case=signature&r=1")
  const woke = []
  queue.fl().wake = () => woke.push(window.__fl.q.at(-1).n)
  queue.trackPurchase(block)
  assert.deepEqual(woke, ["Purchase"], "wake ran before trackPurchase returned")
  const item = window.__fl.q[0]
  assert.equal(item.n, "Purchase")
  assert.equal(item.id, "fl-1234")
  assert.equal(item.s, 1)
  assert.equal(item.p, "/checkout/?case=signature&r=1")
  assert.equal(item.d, block)
  batch.prepare(item)
  assert.equal(item.p, "/checkout/?case=signature", "cut like any other once the runtime has it")
  assert.equal(item.id, "fl-1234", "its fl- id stays")

  const quiet = browser("https://new.florayn.com/checkout/")
  quiet.queue.trackPurchase(block)
  assert.equal(quiet.window.__fl.q.length, 1, "no runtime yet: queued only")
  quiet.queue.fl().wake = () => { throw new Error("vendor failed") }
  assert.doesNotThrow(() => quiet.queue.trackPurchase({ ...block, event_id: "fl-1235" }))
})

test("takeUnsent hands off browser events only, marks them, and restoreUnsent puts them back", () => {
  const { queue, batch, window } = browser("https://new.florayn.com/product/x/")
  queue.track("PageView", { first: true })
  queue.track("ViewContent", { value: 1 })
  queue.trackPurchase(block)
  queue.track("AddToCart", { value: 2 })
  const firstTwo = batch.takeUnsent(2)
  assert.deepEqual(names(firstTwo), ["PageView", "ViewContent"])
  assert.ok(firstTwo.every((item) => item.s === 1))
  assert.equal(firstTwo[0], window.__fl.q[0], "the queued items themselves are marked")
  const rest = batch.takeUnsent()
  assert.deepEqual(names(rest), ["AddToCart"])
  assert.equal(batch.takeUnsent().length, 0)

  batch.restoreUnsent(rest)
  assert.equal(rest[0].s, undefined)
  assert.equal("s" in rest[0], false)
  const id = rest[0].id
  assert.deepEqual(names(batch.takeUnsent()), ["AddToCart"])
  assert.equal(rest[0].id, id, "a retried event keeps its id")
  batch.restoreUnsent(window.__fl.q)
  assert.equal(window.__fl.q[2].s, 1, "a Purchase stays handed off")
  assert.deepEqual(names(batch.takeUnsent()), ["PageView", "ViewContent", "AddToCart"])

  for (let i = 0; i < 30; i++) queue.track("PageView")
  assert.equal(batch.takeUnsent().length, 25, "25 per batch by default")
  assert.equal(batch.takeUnsent().length, 5)
})

test("the queue imports only the ./paths check and ./contract types, and it and paths.ts stay tiny", () => {
  const source = read("src/lib/tracking/queue.ts")
  const imports = [...source.matchAll(/^import\b[^\n]*$/gm)].map((match) => match[0])
  assert.deepEqual(imports, [
    `import type { BrowserEventName, IdResponse, PurchaseBlock } from "./contract"`,
    `import { isPrivatePath } from "./paths"`,
  ])
  assert.doesNotMatch(source, /\brequire\(|\bimport\(|from "(?!\.\/contract"|\.\/paths")/)
  assert.deepEqual([...code.queue.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]), ["./paths"], "the type import is erased")

  const paths = read("src/lib/tracking/paths.ts")
  assert.doesNotMatch(paths, /^\s*import\b|\brequire\(|\bimport\(/m, "paths.ts imports nothing")
  const bytes = Buffer.byteLength(source) + Buffer.byteLength(paths)
  assert.ok(bytes < 4096, `paths.ts + queue.ts are ${bytes} bytes of source`)
})

test("batch.ts imports only contract's safePath and the queue", () => {
  const source = read("src/lib/tracking/batch.ts")
  assert.deepEqual([...source.matchAll(/^import\b[^\n]*$/gm)].map((match) => match[0]), [
    `import { safePath } from "./contract"`,
    `import { fl, type QueueItem } from "./queue"`,
  ])
})

test("loading the queue and batch.ts touches no browser global (the queue runs in every page's layout chunk)", () => {
  const touched = []
  const globals = {}
  for (const name of ["window", "document", "location", "navigator", "crypto", "sessionStorage", "localStorage"]) {
    Object.defineProperty(globals, name, { enumerable: true, get() { touched.push(name); return {} } })
  }
  loadAll(globals)
  assert.deepEqual(touched, [])
})
