const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// The storefront's commerce events (TRACKING.md 5.3, 5.4): ViewContent from
// ProductView, AddToCart from CartProvider, InitiateCheckout and the Purchase
// hand-off from CheckoutForm, and the consent line. The components run on a
// small hooks runtime (render, commit, StrictMode's second effect run,
// unmount) with lib/tracking/queue.ts recorded, and every recorded event is
// checked against the endpoint's own validateEvent.
const src = path.join(__dirname, "../src")
const read = (relative) => fs.readFileSync(path.join(src, relative), "utf8").replace(/\r\n/g, "\n")
const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate) }

function loadSource(relative, dependencies = {}, globals = {}) {
  const filename = path.join(src, relative)
  const code = ts.transpileModule(read(relative), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, URL, URLSearchParams, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (name.startsWith("@/components/")) return { __esModule: true, default: name }
      throw new Error(`Unexpected dependency ${name} in ${relative}`)
    },
  }, { filename })
  return exports
}

const variantMatrix = loadSource("lib/variant-matrix.ts")
const { pairKey } = variantMatrix
const contract = loadSource("lib/tracking/contract.ts", { "./paths": loadSource("lib/tracking/paths.ts") })

/** The recorded event as the endpoint would receive it from that page; null when validateEvent drops it. */
function asReceived(event, url) {
  const at = new URL(url, "https://new.florayn.com")
  const id = event.id ?? crypto.randomUUID()
  return contract.validateEvent({ n: event.name, id, t: 1790467200456, p: contract.safePath(at.pathname, at.search), d: event.data })
}

/**
 * Just enough React for one component: hooks keep their slots across renders,
 * effects run on commit in order with their cleanups, `strict` replays
 * StrictMode's unmount + remount of effects with the same state and refs.
 */
function hooksRuntime() {
  let current = null
  let cursor = 0
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const slot = () => [current, cursor++]
  const react = {
    createContext: (value) => ({ Provider: "Context.Provider", value }),
    useContext: () => { throw new Error("useContext is not used by these components") },
    useState(initial) {
      const [inst, i] = slot()
      if (!(i in inst.slots)) inst.slots[i] = typeof initial === "function" ? initial() : initial
      return [inst.slots[i], (next) => {
        inst.slots[i] = typeof next === "function" ? next(inst.slots[i]) : next
        inst.dirty = true
      }]
    },
    useRef(value) {
      const [inst, i] = slot()
      if (!(i in inst.slots)) inst.slots[i] = { current: value }
      return inst.slots[i]
    },
    useMemo(fn, deps) {
      const [inst, i] = slot()
      if (inst.slots[i] && same(inst.slots[i].deps, deps)) return inst.slots[i].value
      inst.slots[i] = { deps, value: fn() }
      return inst.slots[i].value
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect(fn, deps) {
      const [inst, i] = slot()
      const previous = inst.slots[i]
      if (previous && same(previous.deps, deps)) return
      if (!previous) inst.slots[i] = { deps: null, cleanup: undefined, fn }
      inst.pending.push({ i, fn, deps })
    },
  }

  function mount(Component, props, { strict = false } = {}) {
    const inst = { slots: [], pending: [], dirty: false, tree: null, effects: [] }
    const render = () => {
      current = inst
      cursor = 0
      inst.dirty = false
      inst.tree = Component(props)
      current = null
      return inst.tree
    }
    const runEffect = (i, fn, deps) => {
      inst.slots[i]?.cleanup?.()
      const cleanup = fn()
      inst.slots[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined, fn }
    }
    const flush = () => {
      const list = inst.pending
      inst.pending = []
      for (const { i, fn, deps } of list) runEffect(i, fn, deps)
    }
    const effectSlots = () => inst.slots.map((s, i) => [s, i]).filter(([s]) => s && typeof s === "object" && "cleanup" in s && "fn" in s)
    const settleRenders = () => {
      for (let guard = 0; inst.dirty && guard < 20; guard += 1) {
        render()
        flush()
      }
    }
    let committed = false
    render()
    const handle = {
      /** The element tree of the last render. */
      get tree() { return inst.tree },
      commit() {
        flush()
        if (strict && !committed) {
          for (const [s] of effectSlots()) { s.cleanup?.(); s.cleanup = undefined }
          for (const [s, i] of effectSlots()) runEffect(i, s.fn, s.deps)
        }
        committed = true
        settleRenders()
        return handle
      },
      /** Re-render after state changed outside a render (an event handler, a resolved promise). */
      update() {
        inst.dirty = true
        settleRenders()
        return handle
      },
      unmount() {
        for (const [s] of effectSlots()) s.cleanup?.()
      },
    }
    return handle
  }
  return { react, mount }
}

function walk(node, match, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, match, found)
  } else if (node && typeof node === "object") {
    if (match(node)) found.push(node)
    if (node.props) walk(node.props.children, match, found)
  }
  return found
}
const byType = (tree, type) => walk(tree, (node) => node.type === type)

function fakeTimers() {
  let now = 0
  let next = 0
  const timers = new Map()
  return {
    setTimeout(fn, ms = 0) { next += 1; timers.set(next, { fn, at: now + ms }); return next },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    },
    get size() { return timers.size },
  }
}

// ---------------------------------------------------------------- ProductView

const SOLD = { Signature: ["iPhone 16", "iPhone 17"], "Elite Clear": ["iPhone 16 Plus", "iPhone 16", "iPhone 17"] }
const PRICES = { Signature: 1400, "Elite Clear": 1600 }
const variantIdOf = (caseType, device) => `variant_${caseType}${device}`.replace(/[^A-Za-z0-9_]/g, "")

function productFixture({ handle = "zebra-stark", unpriced = [] } = {}) {
  const matrix = { caseTypes: Object.keys(SOLD), devices: ["iPhone 17", "iPhone 16 Plus", "iPhone 16"],
    devicesByCaseType: SOLD, caseTypesByDevice: {}, variantIdByPair: {} }
  const variants = []
  for (const [caseType, devices] of Object.entries(SOLD)) {
    for (const device of devices) {
      ;(matrix.caseTypesByDevice[device] ??= []).push(caseType)
      const id = variantIdOf(caseType, device)
      matrix.variantIdByPair[pairKey(caseType, device)] = id
      const priced = !unpriced.includes(id)
      variants.push({ id, title: `${caseType} / ${device}`, metadata: { images: [`https://images.invalid/${id}.webp`] },
        calculated_price: priced ? { calculated_amount: PRICES[caseType], currency_code: "bdt" } : null })
    }
  }
  return {
    pagePath: `/product/${handle}/`, matrix, variants, families: {}, stock: {}, fallbackImages: [],
    designName: "Zebra Stark", productHandle: handle, productTitle: "Zebra Stark", deviceName: null,
    initialCaseType: "Signature", initialDevice: "iPhone 17", designData: {}, buyBox: {}, tabs: null,
    caseTypeRecords: [{ slug: "signature", name: "Signature" }, { slug: "elite-clear", name: "Elite Clear" }],
  }
}

function productHarness(search = "") {
  const { react, mount } = hooksRuntime()
  const timers = fakeTimers()
  const events = []
  const window = { location: { search } }
  const { default: ProductView } = loadSource("components/product-view.tsx", {
    react,
    "@/lib/variant-matrix": variantMatrix,
    "@/lib/product-view-data": { expandProductViewDesigns: () => ({}) },
    "@/lib/product-forms": { featuresGroup: () => undefined },
    "@/lib/tracking/queue": { track: (name, data, id) => events.push({ name, data: plain(data), id }) },
  }, { window, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  const open = (props = productFixture(), options) => mount(ProductView, props, options)
  const box = (view) => byType(view.tree, "@/components/product-buy-box")[0].props
  return { open, box, events, timers, window }
}

const view = (caseType, device, primary = true, handle = "zebra-stark") => ({
  name: "ViewContent", id: undefined,
  data: { items: [{ id: variantIdOf(caseType, device), q: 1, price: PRICES[caseType] }], value: PRICES[caseType],
    currency: "BDT", handle, device, case_type: caseType, primary },
})

test("ViewContent goes out once, after hydration, for the page's pair with its variant id and price", () => {
  const h = productHarness()
  const page = h.open()
  assert.equal(h.events.length, 0, "nothing is tracked during render")
  page.commit()
  assert.deepEqual(h.events, [view("Signature", "iPhone 17")])
  const received = asReceived(h.events[0], "/product/zebra-stark/")
  assert.ok(received, "the endpoint's validateEvent keeps it")
  assert.deepEqual(plain(received.d), h.events[0].data)
  page.update()
  h.timers.advance(10_000)
  assert.equal(h.events.length, 1, "re-renders and time add nothing")
})

test("ViewContent follows the pair pickFromQuery settles on: ?case, ?device and ?variant", () => {
  for (const [search, caseType, device] of [
    ["?case=elite-clear", "Elite Clear", "iPhone 17"],
    ["?device=iphone-16&case=signature", "Signature", "iPhone 16"],
    ["?variant=variant_EliteCleariPhone16Plus", "Elite Clear", "iPhone 16 Plus"],
    ["?case=unknown-case", "Signature", "iPhone 17"],
  ]) {
    const h = productHarness(search)
    const page = h.open().commit()
    assert.deepEqual(h.events, [view(caseType, device)], search)
    assert.equal(h.box(page).selected.id, variantIdOf(caseType, device), "the page shows the same pair")
    h.timers.advance(10_000)
    assert.equal(h.events.length, 1, `${search}: the picked pair is not reported again as a switch`)
    assert.ok(asReceived(h.events[0], `/product/zebra-stark/${search}`), search)
  }
})

test("StrictMode's second effect run sends nothing more; every real mount (A -> B -> A) sends its own", () => {
  const h = productHarness()
  h.open(productFixture(), { strict: true }).commit()
  assert.equal(h.events.length, 1)

  const pages = []
  for (const handle of ["zebra-stark", "game-night", "zebra-stark"]) {
    const page = h.open(productFixture({ handle })).commit()
    page.unmount()
    pages.push(handle)
  }
  assert.deepEqual(h.events.slice(1).map((event) => event.data.handle), pages)
  assert.ok(h.events.every((event) => event.data.primary === true))
})

test("a variant switch sends one ViewContent once it has stayed picked for 1.5 s, primary false", () => {
  const h = productHarness()
  const page = h.open().commit()
  h.box(page).onSelectDevice("iPhone 16")
  page.update()
  h.timers.advance(1499)
  assert.equal(h.events.length, 1, "not before 1.5 s")
  h.timers.advance(1)
  assert.deepEqual(h.events.slice(1), [view("Signature", "iPhone 16", false)])
  assert.ok(asReceived(h.events[1], "/product/zebra-stark/"))
})

test("quick switches are debounced to the last one, and going back to the viewed variant sends nothing", () => {
  const h = productHarness()
  const page = h.open().commit()
  h.box(page).onSelectDevice("iPhone 16")
  page.update()
  h.timers.advance(1000)
  h.box(page).onSelectCaseType("Elite Clear")
  page.update()
  h.timers.advance(1000)
  assert.equal(h.events.length, 1)
  h.timers.advance(500)
  assert.deepEqual(h.events.slice(1), [view("Elite Clear", "iPhone 16", false)])

  h.box(page).onSelectCaseType("Signature")
  page.update()
  h.timers.advance(400)
  h.box(page).onSelectCaseType("Elite Clear")
  page.update()
  h.timers.advance(5000)
  assert.equal(h.events.length, 2, "back on the last viewed variant within 1.5 s: nothing new")
})

test("at most 3 variant-switch events per mount", () => {
  const h = productHarness()
  const page = h.open().commit()
  for (const device of ["iPhone 16", "iPhone 17", "iPhone 16", "iPhone 17", "iPhone 16"]) {
    h.box(page).onSelectDevice(device)
    page.update()
    h.timers.advance(2000)
  }
  assert.equal(h.events.length, 4)
  assert.deepEqual(h.events.map((event) => event.data.primary), [true, false, false, false])
})

test("no price, no ViewContent; switches wait for the primary event, and unmounting cancels a pending one", () => {
  const h = productHarness()
  const page = h.open(productFixture({ unpriced: [variantIdOf("Signature", "iPhone 17")] })).commit()
  assert.equal(h.events.length, 0)
  h.box(page).onSelectDevice("iPhone 16")
  page.update()
  h.timers.advance(5000)
  assert.equal(h.events.length, 0, "no switch event before a primary one")

  const other = h.open().commit()
  h.box(other).onSelectDevice("iPhone 16")
  other.update()
  other.unmount()
  h.timers.advance(5000)
  assert.equal(h.events.length, 1, "only the second page's primary event")
  assert.equal(h.timers.size, 0)
})

// ---------------------------------------------------------------- CartProvider

function cartHarness({ trackThrows = false } = {}) {
  const { react, mount } = hooksRuntime()
  const events = []
  const calls = { add: [], many: [] }
  const deferred = (list) => (...args) => new Promise((resolve, reject) => list.push({ args, resolve, reject }))
  const { default: CartProvider } = loadSource("components/cart-provider.tsx", {
    react,
    "@/lib/cart": {
      addToCart: deferred(calls.add),
      addManyToCart: deferred(calls.many),
      getCartSummary: async () => summary(),
    },
    "@/lib/tracking/queue": { track: (name, data, id) => {
      if (trackThrows) throw new Error("queue broke")
      events.push({ name, data: plain(data), id })
    } },
  })
  const provider = mount(CartProvider, { children: null })
  return { cart: provider.tree.props.value, events, calls }
}

const summary = (currencyCode = "bdt") => ({ itemCount: 1, subtotal: 1400, currencyCode, bundleDiscount: 0 })
const optimistic = (unitPrice) => ({ productTitle: "Zebra Stark", variantTitle: "Signature / iPhone 17", unitPrice, thumbnail: null })
const A = "variant_01ABCDEFGHJKLMN"
const B = "variant_01BCDEFGHJKLMNP"
const C = "variant_01CDEFGHJKLMNPQ"
const addedLine = (unitPrice, quantity) => ({ id: "line_1", productTitle: "Zebra Stark", variantTitle: "x", sku: null, quantity, unitPrice, thumbnail: null })

test("add() sends AddToCart once the server took the line, with the requested quantity and the server price", async () => {
  const h = cartHarness()
  const adding = h.cart.add(A, 2, optimistic(1300))
  await settle()
  assert.equal(h.events.length, 0, "nothing before the server answers")
  h.calls.add[0].resolve({ summary: summary(), added: addedLine(1400, 5), items: [] })
  await adding
  assert.deepEqual(h.events, [{ name: "AddToCart", id: undefined,
    data: { items: [{ id: A, q: 2, price: 1400 }], value: 2800, currency: "BDT" } }])
  assert.ok(asReceived(h.events[0], "/product/zebra-stark/"))
})

test("a slower add whose answer is stale still sends its AddToCart", async () => {
  const h = cartHarness()
  const first = h.cart.add(A, 1, optimistic(1400))
  const second = h.cart.add(B, 3, optimistic(900))
  h.calls.add[1].resolve({ summary: summary(), added: addedLine(950, 3), items: [] })
  await second
  h.calls.add[0].resolve({ summary: summary(), added: null, items: [] })
  await first
  assert.deepEqual(h.events.map((event) => event.data), [
    { items: [{ id: B, q: 3, price: 950 }], value: 2850, currency: "BDT" },
    { items: [{ id: A, q: 1, price: 1400 }], value: 1400, currency: "BDT" },
  ], "the stale add falls back to the optimistic price")
})

test("a failed add sends nothing and still fails; a broken queue never fails an add", async () => {
  const h = cartHarness()
  const adding = h.cart.add(A, 1, optimistic(1400))
  h.calls.add[0].reject(new Error("Variant is out of stock"))
  await assert.rejects(adding, /out of stock/)
  assert.equal(h.events.length, 0)

  const broken = cartHarness({ trackThrows: true })
  const ok = broken.cart.add(A, 1, optimistic(1400))
  broken.calls.add[0].resolve({ summary: summary(), added: addedLine(1400, 1), items: [] })
  await assert.doesNotReject(ok)
})

test("only BDT carts send AddToCart; a missing currency counts as the store's bdt", async () => {
  for (const [currency, expected] of [["usd", 0], ["BDT", 1], ["", 1]]) {
    const h = cartHarness()
    const adding = h.cart.add(A, 1, optimistic(1400))
    h.calls.add[0].resolve({ summary: summary(currency), added: null, items: [] })
    await adding
    assert.equal(h.events.length, expected, currency)
  }
})

test("addMany() sends the pack as asked for, prices from the bag's lines and the pack total as value", async () => {
  const h = cartHarness()
  const adding = h.cart.addMany([{ variantId: A, quantity: 2 }, { variantId: B }, { variantId: "" }], optimistic(3800))
  await settle()
  assert.equal(h.events.length, 0)
  h.calls.many[0].resolve({ summary: summary(), items: [
    { id: "line_a", title: "a", quantity: 5, unit_price: 1200, variant: { id: A, title: "a" } },
    { id: "line_c", title: "c", quantity: 1, unit_price: 700, variant: { id: C, title: "c" } },
  ] })
  await adding
  assert.deepEqual(h.events, [{ name: "AddToCart", id: undefined,
    data: { items: [{ id: A, q: 2, price: 1200 }, { id: B, q: 1, price: 0 }], value: 3800, currency: "BDT" } }])
  assert.ok(asReceived(h.events[0], "/product/zebra-stark/"))
})

test("addMany() sends nothing on failure, for a non-BDT bag, or with no variant to add", async () => {
  const failing = cartHarness()
  const adding = failing.cart.addMany([{ variantId: A }], optimistic(1400))
  failing.calls.many[0].reject(new Error("offline"))
  await assert.rejects(adding)
  assert.equal(failing.events.length, 0)

  for (const [items, currency] of [[[{ variantId: A }], "usd"], [[{ variantId: "" }], "bdt"], [[], "bdt"]]) {
    const h = cartHarness()
    const call = h.cart.addMany(items, optimistic(1400))
    h.calls.many[0].resolve({ summary: summary(currency), items: [] })
    await call
    assert.equal(h.events.length, 0, JSON.stringify({ items, currency }))
  }
})

// ---------------------------------------------------------------- CheckoutForm

const IC_ID = "ic-0123456789abcdef01234567"
const V1 = "variant_01ABCDEFGHJKLMN"
const V2 = "variant_01BCDEFGHJKLMNP"

function line(id, variantId, quantity, unitPrice) {
  return { id, title: "Zebra Stark", variant_title: "Signature / iPhone 17", quantity, unit_price: unitPrice,
    subtotal: unitPrice * quantity, thumbnail: null, variant_id: variantId }
}

function purchaseBlock() {
  return { event_id: "fl-1234", value: 3160, currency: "BDT", num_items: 3,
    contents: [{ id: V1, quantity: 2, item_price: 1400 }], platforms: { meta: true, tiktok: false, google: false },
    match: { meta: { external_id: "e".repeat(64) } } }
}

function checkoutHarness({ props = {}, result, strict = false } = {}) {
  const { react, mount } = hooksRuntime()
  const log = []
  const events = []
  const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : String(name)) })
  const quote = (district) => ({ version: "a".repeat(64), currency_code: "bdt", subtotal: 3300, discount_total: 200,
    bundle_discount: 200, shipping_total: 60, shipping_subtotal: 60, tax_total: 0, total: 3160, free_shipping: false,
    shipping_option_id: "so_1", shipping_label: "Inside Dhaka", district, item_count: 3, payment_method: "cash_on_delivery", items: [] })
  const window = { addEventListener() {}, removeEventListener() {}, location: { pathname: "/checkout/", search: "" } }
  const { default: CheckoutForm } = loadSource("components/checkout-form.tsx", {
    react,
    "next/link": { __esModule: true, default: "Link" },
    "next/navigation": { useRouter: () => ({ push: (url) => log.push(`push ${url}`) }) },
    "lucide-react": icons,
    "@/components/cart-provider": { useCart: () => ({ applySummary: () => log.push("applySummary") }) },
    "@/components/ui/button": { Button: "Button", Spinner: "Spinner" },
    "@/lib/cart": {
      quoteCheckout: async (district) => ({ ok: true, quote: quote(district) }),
      submitOrder: async (input) => { log.push("submitOrder"); return typeof result === "function" ? result(input) : result },
    },
    "@/lib/checkout-form-data": loadSource("lib/checkout-form-data.ts"),
    "@/lib/money": { formatPrice: (amount) => `Tk ${amount}` },
    "@/lib/tracking/queue": {
      track: (name, data, id) => events.push({ name, data: plain(data), id }),
      trackPurchase: (block) => log.push(`trackPurchase ${block.event_id}`),
    },
  }, { window, requestAnimationFrame: (fn) => fn() })
  const form = mount(CheckoutForm, {
    districts: { districts: ["Dhaka", "Gazipur"], count: 2, inside_dhaka: ["Dhaka"], shipping: { inside_dhaka: 60, outside_dhaka: 120 } },
    items: [line("line_1", V1, 2, 1400), line("line_2", null, 1, 500)],
    subtotal: 3300, bundleDiscount: 200, currencyCode: "bdt",
    settings: { heading: "Checkout", description: "", delivery_note: "", support_phone: "", support_label: "", show_order_note: false },
    trackingEventId: IC_ID, consent: null,
    ...props,
  }, { strict })
  return { form, log, events }
}

const inputById = (tree, id) => walk(tree, (node) => node.props?.id === id && ["input", "select", "textarea"].includes(node.type))[0]

/** Fills the form, waits for the district's quote and submits it. */
async function placeOrder(h) {
  h.form.commit()
  for (const [id, value] of Object.entries({ full_name: "Fixture Customer", phone: "01700000000", district: "Dhaka",
    area: "Dhanmondi", address: "House 1, Road 2" })) {
    inputById(h.form.tree, id).props.onChange({ target: { value } })
    h.form.update()
  }
  await settle()
  h.form.update()
  const [form] = byType(h.form.tree, "form")
  await form.props.onSubmit({ preventDefault() {} })
  await settle()
}

test("InitiateCheckout goes out once on mount with the server's ic- id, the lines that have a variant, and no form data", () => {
  const h = checkoutHarness()
  assert.equal(h.events.length, 0, "nothing during render")
  h.form.commit()
  h.form.update()
  assert.deepEqual(h.events, [{ name: "InitiateCheckout", id: IC_ID,
    data: { items: [{ id: V1, q: 2, price: 1400 }], value: 3100, currency: "BDT", num_items: 3 } }])
  const received = asReceived(h.events[0], "/checkout/")
  assert.ok(received, "the endpoint's validateEvent keeps it")
  assert.equal(received.id, IC_ID)
  assert.doesNotMatch(JSON.stringify(h.events), /Fixture|0170|cart_/)
})

test("StrictMode's second effect run sends no second InitiateCheckout", () => {
  const h = checkoutHarness({ strict: true })
  h.form.commit()
  assert.equal(h.events.length, 1)
})

test("no InitiateCheckout without the server's id, without a line that has a variant, or for a non-BDT bag", () => {
  for (const props of [
    { trackingEventId: null }, { trackingEventId: undefined },
    { items: [line("line_2", null, 1, 500)] }, { currencyCode: "usd" },
  ]) {
    const h = checkoutHarness({ props })
    h.form.commit()
    assert.equal(h.events.length, 0, JSON.stringify(props))
  }
})

test("a placed order hands its Purchase block to the pixels before anything else, then leaves for the order page", async () => {
  const h = checkoutHarness({ result: { ok: true, order: { id: "order_01FIXTURE", display_id: 1234, total: 3160, currency_code: "bdt" },
    tracking: purchaseBlock() } })
  await placeOrder(h)
  assert.deepEqual(h.log, ["submitOrder", "trackPurchase fl-1234", "applySummary", "push /order/order_01FIXTURE/"])
})

test("no Purchase hand-off without a tracking block, or when the order fails", async () => {
  const untracked = checkoutHarness({ result: { ok: true, order: { id: "order_01FIXTURE", display_id: 1234, total: 3160, currency_code: "bdt" } } })
  await placeOrder(untracked)
  assert.deepEqual(untracked.log, ["submitOrder", "applySummary", "push /order/order_01FIXTURE/"])

  const failed = checkoutHarness({ result: { ok: false, errors: { form: "Try again" }, tracking: purchaseBlock() } })
  await placeOrder(failed)
  assert.deepEqual(failed.log, ["submitOrder"])
})

test("the consent line renders under the terms only with a consent, and links to /privacy/", () => {
  const terms = (tree) => walk(tree, (node) => node.type === "p" && node.props.className === "checkout-terms")
  const without = checkoutHarness()
  assert.equal(terms(without.form.tree).length, 1, "only the existing terms line")

  const consent = { text: "We share hashed contact details with our advertising partners to measure our ads.", version: 3 }
  const h = checkoutHarness({ props: { consent } })
  const lines = terms(h.form.tree)
  assert.equal(lines.length, 2)
  assert.match(JSON.stringify(lines[0].props.children), /device model and delivery address/, "the existing line stays first")
  const children = lines[1].props.children
  assert.equal(children[0], consent.text)
  const [link] = byType(children, "Link")
  assert.equal(link.props.href, "/privacy/")
  assert.equal(link.props.children, "Privacy policy")
})

// ---------------------------------------------------------------- sources

test("the components reach tracking only through track() and trackPurchase() of lib/tracking/queue", () => {
  for (const [file, names] of [
    ["components/product-view.tsx", "track"],
    ["components/cart-provider.tsx", "track"],
    ["components/checkout-form.tsx", "track, trackPurchase"],
  ]) {
    const source = read(file)
    const imports = [...source.matchAll(/from "(@\/lib\/tracking[^"]*)"/g)].map((match) => match[1])
    assert.deepEqual(imports, ["@/lib/tracking/queue"], file)
    assert.match(source, new RegExp(`import \\{ ${names} \\} from "@/lib/tracking/queue"`), file)
  }
})

test("checkout puts trackPurchase first inside result.ok, and the page never hands the raw cart id to the form", () => {
  const form = read("components/checkout-form.tsx")
  assert.match(form, /if \(result\.ok\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(result\.tracking\) trackPurchase\(result\.tracking\)\n\s*applySummary\(/)
  const page = read("app/checkout/page.tsx")
  assert.match(page, /trackingEventId=\{cart \? icEventId\(cart\.id\) : null\}/)
  assert.match(page, /consent=\{checkoutConsent\(tracking\)\}/)
  assert.match(page, /getTrackingConfig\(\)\]\)/, "the config is read in the page's existing Promise.all")
  assert.doesNotMatch(page.replace(/icEventId\(cart\.id\)/, ""), /cart\.id|cart\?\.id/)
})
