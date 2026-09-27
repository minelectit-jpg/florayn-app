const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/runtime.ts and pixels/*.ts (TRACKING.md 5.2 and 5.5): the lazy
// tracking runtime, run in a fake browser (a vm realm whose global is the
// window) with the real queue and paths. Vendor scripts never load here: the
// test plays each vendor's part by hand (its onload, and what its SDK then
// does with the stub's queued calls), so every call a vendor would see is
// recorded with the moment it was made.
const root = path.join(__dirname, "..")
const src = path.join(root, "src")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
const TRACKING = "src/lib/tracking"
const compiled = new Map()
function compile(file) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(read(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText)
  }
  return compiled.get(file)
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** Loads lib/tracking files into `context`, resolving their relative imports; nothing else may be imported. */
function loader(context) {
  vm.createContext(context)
  const cache = new Map()
  return function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const require = (name) => {
      if (!name.startsWith(".")) throw new Error(`${file} imports ${name}`)
      const target = path.posix.join(path.posix.dirname(file), name) + ".ts"
      if (!fs.existsSync(path.join(root, target))) throw new Error(`${file} imports ${name}, which does not exist`)
      return load(target)
    }
    vm.runInContext(`(function (exports, require, module) {${compile(file)}\n})`, context, { filename: file })(module.exports, require, module)
    return module.exports
  }
}

const IDS = { meta: "2247389409441720", tiktok: "C9TESTPIXEL0000000AB", google: "AW-18147096523", label: "0p0wCKu2w70cEMvvms1D" }
const VARIANT = "variant_01K6EXAMPLEVARIANT01"

function cfgWith(extra = {}) {
  return {
    v: 1, on: true, env: "test", ext: "e".repeat(64), sid: "s1.1790467200.0a1b2c3d", src: "direct", staff: false, optout: false,
    share: false, consent_version: 1, landing: { url: "https://new.florayn.com/", click: null, src: "direct" },
    meta: { id: IDS.meta, load: true }, tiktok: null, google: null, ...extra,
  }
}

function purchaseBlock(extra = {}) {
  return {
    event_id: "fl-1234", value: 2860, currency: "BDT", num_items: 2,
    contents: [{ id: VARIANT, quantity: 2, item_price: 1400 }],
    platforms: { meta: true, tiktok: true, google: true },
    match: {
      meta: { external_id: "ext-hash", ph: "ph-hash", fn: "fn-hash" },
      tiktok: { external_id: "ext-hash", phone_number: "ph-hash" },
      google: { sha256_phone_number: "ph-hash", address: { sha256_first_name: "fn-hash", country: "BD" } },
    },
    ...extra,
  }
}

/**
 * A browser tab at `url`. `log` is the ordered story: address bar rewrites,
 * script tags, batches and vendor calls, each as [kind, ...details].
 */
function page(url = "https://new.florayn.com/", { storage = "ok" } = {}) {
  let current = new URL(url)
  const log = []
  const scripts = []
  const fetches = []
  const timers = []
  let clock = 0
  let timerSeq = 0
  const store = new Map()
  const location = {
    get pathname() { return current.pathname },
    get search() { return current.search },
    get hash() { return current.hash },
    get href() { return current.href },
    get host() { return current.host },
  }
  const context = {
    URL, URLSearchParams, console, Date,
    location,
    history: {
      state: { __NA: true, tree: "next-app-router" },
      replaceState(state, _unused, next) {
        log.push(["replace", next, state === context.history.state])
        current = new URL(next, current)
      },
    },
    document: {
      createElement: (tag) => ({ tag }),
      head: {
        appendChild(element) {
          element.seen = { disablePushState: context.fbq?.disablePushState, fbqQueue: context.fbq ? plain(context.fbq.queue) : null }
          scripts.push(element)
          log.push(["script", element.src])
        },
      },
    },
    fetch: (target, init) => {
      const call = { target, init, body: JSON.parse(init.body) }
      fetches.push(call)
      log.push(["fetch", target])
      return typeof context.__respond === "function" ? context.__respond(call) : Promise.resolve({ status: 204, ok: true })
    },
    setTimeout: (fn, ms, ...args) => {
      const timer = { id: ++timerSeq, at: clock + (Number(ms) || 0), fn, args }
      timers.push(timer)
      return timer.id
    },
    clearTimeout: (id) => {
      const at = timers.findIndex((timer) => timer.id === id)
      if (at >= 0) timers.splice(at, 1)
    },
    crypto: { randomUUID: () => crypto.randomUUID() },
  }
  if (storage === "ok") {
    context.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }
  } else if (storage === "methods throw") {
    context.sessionStorage = { getItem() { throw new Error("SecurityError") }, setItem() { throw new Error("QuotaExceededError") } }
  } else {
    Object.defineProperty(context, "sessionStorage", { get() { throw new Error("SecurityError: storage is blocked") } })
  }
  context.window = context
  const load = loader(context)
  const queue = load(`${TRACKING}/queue.ts`)
  const runtime = load(`${TRACKING}/runtime.ts`)

  /** Move the address bar (a client navigation) without waking anything. */
  const go = (next) => {
    current = new URL(next, current)
  }
  /** What the stub does on a pathname change: navigate, record the PageView, wake the runtime. */
  const visit = (next) => {
    go(next)
    queue.track("PageView", { first: false })
    queue.fl().wake?.()
  }
  /** Run the timers due within `ms`, in order, letting promises settle after each. */
  const advance = async (ms = 0) => {
    const until = clock + ms
    await flush()
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      if (!timers.length || timers[0].at > until) break
      const timer = timers.shift()
      clock = Math.max(clock, timer.at)
      timer.fn(...timer.args)
      await flush()
    }
    clock = until
  }
  const script = (part) => scripts.find((element) => element.src.includes(part))

  /** fbevents.js arrives: it takes over callMethod and replays the stub's queue. */
  const metaCalls = []
  const loadMeta = async () => {
    const element = script("connect.facebook.net")
    assert.ok(element, "fbevents.js was added")
    const fbq = context.fbq
    const before = plain(fbq.queue)
    fbq.callMethod = (...args) => {
      metaCalls.push(args)
      log.push(["fbq", ...args])
    }
    element.onload()
    await flush()
    return before
  }

  /** events.js arrives, then the SDK it fetches: queued calls replay and ready() callbacks run. */
  const tiktokCalls = []
  const loadTikTok = async ({ ready = true } = {}) => {
    const element = script("analytics.tiktok.com")
    assert.ok(element, "events.js was added")
    element.onload()
    await flush()
    const stubQueue = [...context.ttq]
    if (!ready) return stubQueue
    const ttq = context.ttq
    for (const method of ["page", "track", "identify"]) {
      ttq[method] = (...args) => {
        tiktokCalls.push([method, ...args])
        log.push(["ttq", method, ...args])
      }
    }
    for (const [method, ...args] of stubQueue) {
      if (method === "ready") args[0]()
      else ttq[method](...args)
    }
    await flush()
    return stubQueue
  }

  /** gtag.js arrives; every dataLayer entry is an Arguments object. */
  const googleSeen = { before: null }
  const loadGoogle = async () => {
    const element = script("googletagmanager.com")
    assert.ok(element, "gtag.js was added")
    googleSeen.before = context.dataLayer.length
    element.onload()
    await flush()
  }
  const dataLayer = () => (context.dataLayer ?? []).map((entry) => {
    assert.equal(Object.prototype.toString.call(entry), "[object Arguments]", "gtag pushes Arguments objects")
    return Array.from(entry)
  })

  return {
    context, log, scripts, fetches, timers, store, queue, runtime, location, go, visit, advance, script,
    metaCalls, loadMeta, tiktokCalls, loadTikTok, loadGoogle, googleSeen, dataLayer,
    fl: () => queue.fl(),
    names: (calls) => calls.map((call) => call.slice(0, 2).join(" ")),
  }
}

/** A tab where the stub has already recorded the first PageView and the id answer is in. */
async function started(url, cfg = cfgWith(), options) {
  const tab = page(url, options)
  tab.queue.track("PageView", { first: true })
  tab.fl().cfg = cfg
  await tab.runtime.start()
  return tab
}

test("the runtime version marker is fl-runtime-v1 and lives only in runtime.ts", () => {
  const tab = page()
  assert.equal(tab.runtime.RUNTIME_VERSION, "fl-runtime-v1")
  const carriers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("fl-runtime-v1")) {
        carriers.push(path.relative(src, full).split(path.sep).join("/"))
      }
    }
  }
  walk(src)
  assert.deepEqual(carriers, ["lib/tracking/runtime.ts"])
})

test("start waits for the id answer and stops unless tracking is on and not opted out", async () => {
  for (const cfg of [cfgWith({ on: false, meta: null }), cfgWith({ optout: true }), null]) {
    const tab = page("https://new.florayn.com/")
    tab.queue.track("PageView", { first: true })
    tab.fl().cfgPromise = Promise.resolve(cfg)
    await tab.runtime.start()
    for (let i = 0; i < 12; i++) tab.queue.track("PageView")
    await tab.advance(5000)
    assert.deepEqual(tab.log, [], JSON.stringify(cfg?.on))
    assert.equal(tab.fl().wake, undefined)
  }

  const tab = page("https://new.florayn.com/")
  tab.queue.track("PageView", { first: true })
  let answer
  tab.fl().cfgPromise = new Promise((resolve) => { answer = resolve })
  const starting = tab.runtime.start()
  await tab.advance(5000)
  assert.deepEqual(tab.log, [], "nothing before the answer")
  answer(cfgWith())
  await starting
  await tab.advance(0)
  assert.deepEqual(tab.names(tab.log), ["script https://connect.facebook.net/en_US/fbevents.js"])
  assert.equal(await tab.runtime.start(), undefined, "a second start does nothing")
  assert.equal(tab.scripts.length, 1)
})

test("review and r leave the address bar, keeping Next's history state, before any vendor script", async () => {
  const tab = await started("https://new.florayn.com/product/zebra/?review=tok123&case=signature&r=5#customer-reviews")
  assert.deepEqual(tab.log, [["replace", "/product/zebra/?case=signature#customer-reviews", true]], "at start, before anything else")
  const [pageView] = tab.fl().q
  assert.equal(pageView.p, "/product/zebra/?case=signature", "the stub's raw address is cut at start, before any vendor script")
  assert.match(pageView.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  await tab.advance(0)
  assert.deepEqual(tab.log.slice(0, 2), [
    ["replace", "/product/zebra/?case=signature#customer-reviews", true],
    ["script", "https://connect.facebook.net/en_US/fbevents.js"],
  ])
  assert.equal(tab.location.href, "https://new.florayn.com/product/zebra/?case=signature#customer-reviews")

  const clean = await started("https://new.florayn.com/product/zebra/?case=signature")
  await clean.advance(0)
  assert.equal(clean.log.filter(([kind]) => kind === "replace").length, 0, "nothing to scrub, no rewrite")
})

test("Meta: disablePushState before fbevents.js is added; autoConfig false and a bare init are the only calls before onload", async () => {
  const tab = await started("https://new.florayn.com/product/zebra/?case=signature")
  tab.queue.track("ViewContent", { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT", handle: "zebra", primary: true })
  await tab.advance(0)
  const element = tab.script("fbevents.js")
  assert.equal(element.src, "https://connect.facebook.net/en_US/fbevents.js")
  assert.equal(element.async, true)
  assert.equal(element.seen.disablePushState, true)
  assert.deepEqual(element.seen.fbqQueue, [["set", "autoConfig", false, IDS.meta], ["init", IDS.meta]])
  tab.queue.track("AddToCart", { items: [{ id: VARIANT, q: 2, price: 1400 }], value: 2800, currency: "BDT" })
  await tab.advance(100)
  assert.deepEqual(plain(tab.context.fbq.queue), [["set", "autoConfig", false, IDS.meta], ["init", IDS.meta]], "no vendor call before onload")

  const before = await tab.loadMeta()
  assert.deepEqual(before, [["set", "autoConfig", false, IDS.meta], ["init", IDS.meta]])
  const [pageView, view, add] = plain(tab.metaCalls)
  const [firstId, viewId, addId] = tab.fl().q.map((item) => item.id)
  assert.deepEqual(pageView, ["track", "PageView", {}, { eventID: firstId }])
  assert.deepEqual(view, ["track", "ViewContent", {
    content_type: "product", content_ids: [VARIANT], contents: [{ id: VARIANT, quantity: 1, item_price: 1400 }], value: 1400, currency: "BDT",
  }, { eventID: viewId }])
  assert.deepEqual(add[3], { eventID: addId })
  assert.equal(tab.metaCalls.length, 3)

  tab.queue.track("InitiateCheckout", { items: [{ id: VARIANT, q: 2, price: 1400 }], value: 2800, currency: "BDT", num_items: 2 }, "ic-0123456789abcdef01234567")
  await flush()
  assert.deepEqual(plain(tab.metaCalls.at(-1)), ["track", "InitiateCheckout", {
    content_type: "product", content_ids: [VARIANT], contents: [{ id: VARIANT, quantity: 2, item_price: 1400 }], value: 2800, currency: "BDT", num_items: 2,
  }, { eventID: "ic-0123456789abcdef01234567" }], "new events reach a ready vendor in the same task")

  tab.visit("/shop/")
  await flush()
  assert.equal(tab.metaCalls.length, 4, "a route-change PageView has no Meta browser copy")
})

test("a browser copy needs the event's own pathname on a public page at call time; the server copy still goes", async () => {
  const tab = await started("https://new.florayn.com/product/a/?case=signature")
  tab.queue.track("ViewContent", { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT" })
  await tab.advance(0)
  tab.go("/product/b/")
  tab.queue.track("ViewContent", { items: [{ id: VARIANT, q: 1, price: 1500 }], value: 1500, currency: "BDT" })
  await tab.loadMeta()
  assert.deepEqual(tab.names(tab.metaCalls), ["track ViewContent"], "only /product/b/'s event: /product/a/'s moved on")
  assert.equal(tab.metaCalls[0][2].value, 1500)

  tab.go("/order/order_01ABC/")
  tab.queue.track("ViewContent", { value: 1 }) // track() itself ignores private pages
  tab.fl().q.push({ n: "AddToCart", id: crypto.randomUUID(), t: Date.now(), p: "/order/order_01ABC/", d: { items: [], value: 1, currency: "BDT" } })
  tab.fl().wake()
  await flush()
  tab.go("/product/b/")
  tab.fl().wake()
  await flush()
  assert.equal(tab.metaCalls.length, 1, "an item passed while the page was private is dropped, not replayed later")

  await tab.advance(2000)
  const sent = tab.fetches.flatMap((call) => call.body.events.map((event) => event.p))
  assert.deepEqual(sent, ["/product/a/?case=signature", "/product/a/?case=signature", "/product/b/", "/order/order_01ABC/"],
    "every queued event still goes to /api/t/e/ (the endpoint rejects private paths)")
})

test("no vendor script is added on a private page; it waits for the next public pathname", async () => {
  const tab = page("https://new.florayn.com/account/")
  tab.fl().cfg = cfgWith({ tiktok: { id: IDS.tiktok, load: true } })
  await tab.runtime.start()
  await tab.advance(5000)
  assert.equal(tab.scripts.length, 0)

  tab.visit("/shop/")
  // Leaves for a private page before the injection timer runs: still nothing.
  tab.go("/order/order_01ABC/")
  await tab.advance(0)
  assert.equal(tab.scripts.length, 0)

  tab.visit("/")
  await tab.advance(0)
  assert.deepEqual(tab.scripts.map((element) => element.src), [
    "https://connect.facebook.net/en_US/fbevents.js",
    `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${IDS.tiktok}&lib=ttq`,
  ])
})

test("Purchase: Meta re-inits with external_id only while share is off, fires once per tab, and only if ready in time", async () => {
  const tab = await started("https://new.florayn.com/checkout/")
  await tab.advance(0)
  await tab.loadMeta()
  tab.queue.trackPurchase(purchaseBlock())
  const [init, purchase] = plain(tab.metaCalls.slice(1))
  assert.deepEqual(init, ["init", IDS.meta, { external_id: "ext-hash" }])
  assert.deepEqual(purchase, ["track", "Purchase", {
    content_type: "product", content_ids: [VARIANT], contents: [{ id: VARIANT, quantity: 2, item_price: 1400 }],
    value: 2860, currency: "BDT", num_items: 2, order_id: "fl-1234",
  }, { eventID: "fl-1234" }])
  assert.equal(tab.store.get("fl_p_fl-1234"), "meta")
  tab.queue.trackPurchase(purchaseBlock())
  assert.equal(tab.metaCalls.length, 3, "the same order again: no second browser Purchase")

  const shared = await started("https://new.florayn.com/checkout/", cfgWith({ share: true }))
  await shared.advance(0)
  await shared.loadMeta()
  shared.queue.trackPurchase(purchaseBlock())
  assert.deepEqual(plain(shared.metaCalls[1]), ["init", IDS.meta, { external_id: "ext-hash", ph: "ph-hash", fn: "fn-hash" }])

  const notForMeta = await started("https://new.florayn.com/checkout/")
  await notForMeta.advance(0)
  await notForMeta.loadMeta()
  notForMeta.queue.trackPurchase(purchaseBlock({ platforms: { meta: false, tiktok: false, google: false } }))
  assert.deepEqual(notForMeta.names(notForMeta.metaCalls), ["track PageView"])

  const late = await started("https://new.florayn.com/checkout/")
  await late.advance(0)
  late.queue.trackPurchase(purchaseBlock())
  await late.loadMeta()
  assert.deepEqual(late.names(late.metaCalls), ["track PageView"], "not ready at trackPurchase: never fired, even on /checkout/")
  assert.equal(late.fetches.length, 0)
})

test("TikTok: no automatic page(), nothing before events.js onload and the SDK's ready(), then page/track/identify", async () => {
  const cfg = cfgWith({ meta: null, tiktok: { id: IDS.tiktok, load: true } })
  const tab = await started("https://new.florayn.com/product/zebra/", cfg)
  tab.queue.track("ViewContent", { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT" })
  await tab.advance(0)
  assert.equal(tab.context.TiktokAnalyticsObject, "ttq")
  assert.equal(tab.context.ttq._i[IDS.tiktok]._u, "https://analytics.tiktok.com/i18n/pixel/events.js")
  assert.deepEqual(plain(tab.context.ttq._o[IDS.tiktok]), {})
  assert.equal(tab.context.ttq.length, 0, "no ttq.page() from the snippet")
  const stubQueue = await tab.loadTikTok({ ready: false })
  assert.deepEqual(stubQueue.map(([method]) => method), ["ready"], "onload alone is not ready: only ready() is asked")
  assert.equal(tab.tiktokCalls.length, 0)
})

test("TikTok after ready: ttq.page() per allowed PageView, events with event_id, Purchase with identify", async () => {
  const cfg = cfgWith({ meta: null, tiktok: { id: IDS.tiktok, load: true } })
  const tab = await started("https://new.florayn.com/checkout/", cfg)
  tab.queue.track("InitiateCheckout", { items: [{ id: VARIANT, q: 2, price: 1400 }], value: 2800, currency: "BDT", num_items: 2 }, "ic-0123456789abcdef01234567")
  await tab.advance(0)
  await tab.loadTikTok()
  assert.deepEqual(plain(tab.tiktokCalls), [
    ["page"],
    ["track", "InitiateCheckout", {
      content_type: "product", contents: [{ content_id: VARIANT, quantity: 2, price: 1400 }], value: 2800, currency: "BDT", num_items: 2,
    }, { event_id: "ic-0123456789abcdef01234567" }],
  ])
  tab.queue.trackPurchase(purchaseBlock())
  assert.deepEqual(plain(tab.tiktokCalls.slice(2)), [
    ["identify", { external_id: "ext-hash" }],
    ["track", "Purchase", {
      content_type: "product", contents: [{ content_id: VARIANT, quantity: 2, price: 1400 }], value: 2860, currency: "BDT",
      num_items: 2, order_id: "fl-1234",
    }, { event_id: "fl-1234" }],
  ])
  tab.visit("/shop/")
  await flush()
  assert.deepEqual(plain(tab.tiktokCalls.at(-1)), ["page"], "route-change PageViews go to TikTok")
})

test("Google: consent default denied while share is off, no page view, and a Purchase-only conversion on /checkout/", async () => {
  const cfg = cfgWith({ env: "live", meta: null, google: { id: IDS.google, label: IDS.label, load: true },
    landing: { url: "https://florayn.com/?gclid=Cj0KCQ", click: "gclid", src: "google_paid" } })
  const tab = await started("https://florayn.com/checkout/?utm_source=google", cfg)
  await tab.advance(0)
  const before = tab.dataLayer()
  assert.deepEqual(plain(before.map((entry) => entry[0])), ["consent", "js", "config"])
  assert.deepEqual(plain(before[0]), ["consent", "default", { ad_user_data: "denied" }])
  assert.ok(before[1][1] instanceof tab.context.Date || Object.prototype.toString.call(before[1][1]) === "[object Date]")
  assert.deepEqual(plain(before[2]), ["config", IDS.google, { send_page_view: false, page_location: "https://florayn.com/?gclid=Cj0KCQ" }])
  await tab.loadGoogle()
  tab.queue.track("InitiateCheckout", { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT" }, "ic-0123456789abcdef01234567")
  await flush()
  assert.equal(tab.dataLayer().length, 3, "no page view, no funnel events")
  tab.queue.trackPurchase(purchaseBlock())
  assert.deepEqual(plain(tab.dataLayer().slice(3)), [["event", "conversion", {
    send_to: `${IDS.google}/${IDS.label}`, value: 2860, currency: "BDT", transaction_id: "fl-1234", page_location: "https://florayn.com/checkout/",
  }]])

  const shared = await started("https://florayn.com/checkout/?gclid=Cj0KCQ", cfgWith({ ...cfg, share: true }))
  await shared.advance(0)
  const config = shared.dataLayer()
  assert.deepEqual(plain(config.map((entry) => entry[0])), ["js", "config"], "no consent default while share is on")
  assert.deepEqual(plain(config[1]), ["config", IDS.google, { send_page_view: false }], "the address bar still has the click id")
  await shared.loadGoogle()
  shared.queue.trackPurchase(purchaseBlock())
  assert.deepEqual(plain(shared.dataLayer().slice(2).map((entry) => entry.slice(0, 2))), [["set", "user_data"], ["event", "conversion"]])
  assert.deepEqual(plain(shared.dataLayer()[2][2]), purchaseBlock().match.google)
})

test("batches go to /api/t/e/ within 2 s or at once at 10, with rv, and never carry a Purchase", async () => {
  const tab = await started("https://new.florayn.com/checkout/", cfgWith({ meta: null }))
  tab.queue.track("InitiateCheckout", { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT" }, "ic-0123456789abcdef01234567")
  tab.queue.trackPurchase(purchaseBlock())
  await tab.advance(1999)
  assert.equal(tab.fetches.length, 0)
  await tab.advance(1)
  assert.equal(tab.fetches.length, 1)
  const [{ target, init, body }] = tab.fetches
  assert.equal(target, "/api/t/e/")
  assert.equal(init.method, "POST")
  assert.equal(init.keepalive, true)
  assert.equal(init.headers["content-type"], "application/json")
  assert.equal(body.v, 1)
  assert.equal(body.rv, "fl-runtime-v1")
  assert.equal(typeof body.sent_at, "number")
  assert.deepEqual(body.events.map((event) => event.n), ["PageView", "InitiateCheckout"])

  tab.go("/shop/")
  for (let i = 0; i < 9; i++) tab.queue.track("PageView")
  await flush()
  assert.equal(tab.fetches.length, 1, "9 wait for the timer")
  tab.queue.track("PageView")
  await flush()
  assert.equal(tab.fetches.length, 2, "the 10th sends at once")
  assert.equal(tab.fetches[1].body.events.length, 10)
  assert.ok(tab.fetches.every((call) => call.body.events.every((event) => event.n !== "Purchase")))
})

test("a failed batch puts its events back for the next one; a 4xx does not", async () => {
  const tab = await started("https://new.florayn.com/", cfgWith({ meta: null }))
  const answers = [() => Promise.reject(new TypeError("offline")), () => Promise.resolve({ status: 503, ok: false }), () => Promise.resolve({ status: 403, ok: false })]
  tab.context.__respond = () => (answers.shift() ?? (() => Promise.resolve({ status: 204, ok: true })))()
  await tab.advance(2000)
  assert.equal(tab.fetches.length, 1)
  assert.equal(tab.fl().q[0].s, undefined, "restored after a network error")
  tab.queue.track("PageView")
  await tab.advance(2000)
  assert.equal(tab.fetches[1].body.events.length, 2, "the restored event rides with the next")
  assert.equal(tab.fl().q[0].s, undefined, "restored after a 5xx")
  tab.queue.track("PageView")
  await tab.advance(2000)
  assert.equal(tab.fetches[2].body.events.length, 3)
  assert.ok(tab.fl().q.every((item) => item.s === 1), "a 4xx is final")
})

test("staff browsers load no vendor but still report to the dashboard", async () => {
  const cfg = cfgWith({ staff: true, tiktok: { id: IDS.tiktok, load: true }, google: { id: IDS.google, label: IDS.label, load: true } })
  const tab = await started("https://new.florayn.com/checkout/", cfg)
  tab.queue.trackPurchase(purchaseBlock())
  await tab.advance(5000)
  assert.equal(tab.scripts.length, 0)
  assert.equal(tab.context.fbq ?? tab.context.ttq ?? tab.context.dataLayer, undefined)
  assert.deepEqual(tab.fetches.map((call) => call.target), ["/api/t/e/"])
})

test("only vendors the id answer loads get a script (Meta needs meta.load, which requires AAM confirmed off)", async () => {
  const tab = await started("https://new.florayn.com/", cfgWith({ meta: { id: IDS.meta, load: false }, tiktok: { id: IDS.tiktok, load: false } }))
  await tab.advance(5000)
  assert.equal(tab.scripts.length, 0)
  assert.equal(tab.context.fbq, undefined)
})

test("the Purchase guard survives storage that throws, and vendor errors never escape", async () => {
  for (const storage of ["methods throw", "getter throws"]) {
    const tab = await started("https://new.florayn.com/checkout/", cfgWith(), { storage })
    await tab.advance(0)
    await tab.loadMeta()
    assert.doesNotThrow(() => tab.queue.trackPurchase(purchaseBlock()))
    assert.deepEqual(tab.names(tab.metaCalls), ["track PageView", "init 2247389409441720", "track Purchase"], storage)
  }

  const tab = await started("https://new.florayn.com/checkout/")
  await tab.advance(0)
  await tab.loadMeta()
  tab.context.fbq.callMethod = () => { throw new Error("fbevents failed") }
  assert.doesNotThrow(() => tab.queue.trackPurchase(purchaseBlock()))
  assert.doesNotThrow(() => tab.fl().wake())
})

test("a vendor script that fails to load leaves that vendor off without breaking the others", async () => {
  const tab = await started("https://new.florayn.com/", cfgWith({ tiktok: { id: IDS.tiktok, load: true } }))
  await tab.advance(0)
  tab.script("analytics.tiktok.com").onerror(new Error("blocked"))
  await tab.loadMeta()
  tab.visit("/shop/")
  await tab.advance(5000)
  assert.equal(tab.scripts.length, 2, "never retried")
  assert.deepEqual(tab.names(tab.metaCalls), ["track PageView"])
})

/** Every storefront source file and what it imports, resolved to src-relative paths. */
function sourceGraph() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(full)
    }
  }
  walk(src)
  const rel = (full) => path.relative(src, full).split(path.sep).join("/")
  const resolve = (from, spec) => {
    const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null
    if (!base) return null
    const hit = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    return hit ? rel(hit) : null
  }
  return files.map((full) => {
    const text = fs.readFileSync(full, "utf8")
    const imports = []
    for (const match of text.matchAll(/(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?"([^"]+)"/g)) {
      imports.push({ target: resolve(full, match[2]), dynamic: false, typeOnly: !!match[1] })
    }
    for (const match of text.matchAll(/\b(?:import|require)\(\s*"([^"]+)"\s*\)/g)) {
      imports.push({ target: resolve(full, match[1]), dynamic: true, typeOnly: false })
    }
    return { file: rel(full), imports: imports.filter((entry) => entry.target) }
  })
}

test("boot.ts is reachable only through the stub's import(), and runtime.ts and pixels/* only through boot's", () => {
  const lazy = (file) => file === "lib/tracking/boot.ts" || file === "lib/tracking/runtime.ts" || file.startsWith("lib/tracking/pixels/")
  const edges = []
  for (const { file, imports } of sourceGraph()) {
    for (const { target, dynamic, typeOnly } of imports) {
      if (lazy(target) && !typeOnly) edges.push(`${file} ${dynamic ? "import()" : "import"} ${target}`)
    }
  }
  assert.deepEqual(edges.filter((edge) => !/^lib\/tracking\/(runtime\.ts|pixels\/[a-z]+\.ts) import lib\/tracking\/pixels\//.test(edge)), [
    "components/tracking/tracker-stub.tsx import() lib/tracking/boot.ts",
    "lib/tracking/boot.ts import() lib/tracking/runtime.ts",
  ])
})

test("the eager path (the layout's stub and every component that tracks) reaches only queue.ts and paths.ts", () => {
  const graph = new Map(sourceGraph().map(({ file, imports }) => [file, imports]))
  // A "use server" module (lib/cart.ts) reaches the browser only as action references.
  const serverActions = (file) => /^\s*["']use server["']/.test(fs.readFileSync(path.join(src, file), "utf8"))
  for (const start of ["components/tracking/tracker-stub.tsx", "components/cart-provider.tsx", "components/checkout-form.tsx", "components/product-view.tsx"]) {
    const seen = new Set()
    const walk = (file) => {
      for (const { target, dynamic, typeOnly } of graph.get(file) ?? []) {
        if (dynamic || typeOnly || seen.has(target) || serverActions(target)) continue
        seen.add(target)
        walk(target)
      }
    }
    walk(start)
    const tracking = [...seen].filter((file) => file.startsWith("lib/tracking/")).sort()
    assert.deepEqual(tracking, ["lib/tracking/paths.ts", "lib/tracking/queue.ts"], start)
  }
})

test("no tracking client file touches a browser global when it loads", () => {
  const touched = []
  const context = { URL, URLSearchParams }
  for (const name of ["window", "document", "location", "navigator", "history", "fetch", "sessionStorage", "localStorage", "fbq", "ttq", "gtag", "dataLayer", "setTimeout"]) {
    Object.defineProperty(context, name, { enumerable: true, get() { touched.push(name); return undefined } })
  }
  const load = loader(context)
  for (const file of ["paths.ts", "queue.ts", "batch.ts", "contract.ts", "runtime.ts", "pixels/meta.ts", "pixels/tiktok.ts", "pixels/google.ts"]) {
    load(`${TRACKING}/${file}`)
  }
  assert.deepEqual(touched, [])
})
