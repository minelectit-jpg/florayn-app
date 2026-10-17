const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

// Phone colour pictures on the storefront (PHONE_COLOURS.md 6, 7, 9, 10). The
// product payloads come from the backend's own projections (as the local
// fixture's do), so both sides agree on the shape. Nothing here contacts a
// real service: fetch is always a local stand-in.
const src = path.join(__dirname, "../src")
const backend = path.join(__dirname, "../../backend/src")
const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate) }

function load(filename, resolve, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, URL, URLSearchParams, process: { env: {} }, ...globals, require: resolve }, { filename })
  return exports
}
const none = (from) => (name) => { throw new Error(`Unexpected dependency ${name} in ${from}`) }
const lib = load(path.join(src, "lib/phone-colours.ts"), none("lib/phone-colours.ts"))
const variantMatrix = load(path.join(src, "lib/variant-matrix.ts"), none("lib/variant-matrix.ts"))
const { pairKey } = variantMatrix
const mockupSettings = load(path.join(backend, "lib/mockup-settings.ts"), (name) => {
  if (name === "@medusajs/framework/utils") return { Modules: {} }
  throw new Error(`Unexpected dependency ${name}`)
})
const backendColours = load(path.join(backend, "lib/phone-colours.ts"), (name) => {
  if (name === "./mockup-settings") return mockupSettings
  throw new Error(`Unexpected dependency ${name}`)
})

/** A real-format Medusa ID: prefix + 26 of [0-9A-Z]. */
const id = (prefix, n) => `${prefix}_01K8ZQ${String(n).padStart(20, "0")}`
/** An uploaded colour picture, keyed like POST /admin/designs/upload with colourSlug (plus the provider's ULID). */
const picture = (device, colour, n) => `https://img.florayn.com/designs/muse-honey-glow/signature/${device}/${colour}/${n}-01K8ZQ5V3W9Y7X2N4M6P8R${String(n).padStart(4, "0")}.webp`

// ------------------------------------------------------------ pure helpers

test("settleColour: main first, a kept preference, a fallback on another model, hidden then restored", () => {
  const p17 = ["deep-blue", "cosmic-orange", "silver"]
  const p16 = ["black-titanium", "white-titanium", "silver"]
  assert.equal(lib.settleColour(null, p17), "deep-blue", "the first render is always the main colour")
  assert.equal(lib.settleColour("silver", p17), "silver")
  assert.equal(lib.settleColour("silver", p16), "silver", "a colour the next model also has stays")
  assert.equal(lib.settleColour("cosmic-orange", p16), "black-titanium", "otherwise that model's main colour")
  assert.equal(lib.settleColour("silver", []), null, "a case type without colours hides the row")
  assert.equal(lib.settleColour("silver", p17), "silver", "and coming back restores the colour")
  assert.equal(lib.settleColour("silver", ["silver"]), null, "one colour is no choice")
})

test("colourFromQuery reads ?color= as a web name only", () => {
  assert.equal(lib.colourFromQuery("?case=signature&color=silver"), "silver")
  assert.equal(lib.colourFromQuery("?case=signature&color=deep-blue"), "deep-blue")
  assert.equal(lib.colourFromQuery("?color=Deep-Blue"), null, "web names are lower case; the shop builds them")
  for (const search of ["", "?color=", "?color=2", "?color=-silver", "?color=silver-", "?color=deep--blue", "?color=a%2Fb", `?color=${"a".repeat(41)}`]) {
    assert.equal(lib.colourFromQuery(search), null, search)
  }
})

/**
 * The 17 Pro Max (3 colours) and 16 Pro Max (2) of one design, Signature only, through the backend projection.
 * silver16: the 16 Pro Max has Silver too (3 colours), so a kept Silver survives the switch.
 */
function designPayload(device = "iphone-17-pro-max", { silver16 = false } = {}) {
  const sets = [
    { device: "iphone-17-pro-max", base_url: "https://x.invalid/17", colours: ["Deep Blue", "Cosmic Orange", "Silver"], default_colour: "Deep Blue", enabled: true, swatches: { "Deep Blue": "#34405a" } },
    { device: "iphone-16-pro-max", base_url: "https://x.invalid/16", colours: ["Black Titanium", "White Titanium", ...(silver16 ? ["Silver"] : [])], default_colour: "Black Titanium", enabled: silver16 },
  ]
  const rows = []
  const add = (variant, deviceSlug, main, extras) => {
    rows.push({ variant_id: variant, device_slug: deviceSlug, colour_slug: main, is_main: true, images: null })
    for (const colour of extras) rows.push({ variant_id: variant, device_slug: deviceSlug, colour_slug: colour, is_main: false, images: [1, 2, 3].map((n) => picture(deviceSlug, colour, n)) })
  }
  add(id("variant", 1), "iphone-17-pro-max", "deep-blue", ["cosmic-orange", "silver"])
  add(id("variant", 2), "iphone-16-pro-max", "black-titanium", silver16 ? ["white-titanium", "silver"] : ["white-titanium"])
  // A single-colour variant only marks its main colour: no selector.
  add(id("variant", 3), "iphone-17-pro-max", "deep-blue", [])
  return backendColours.productPhoneColours({
    rows, galleryRows: rows.filter((r) => r.device_slug === device && !r.is_main),
    liveVariantIds: new Set([1, 2, 3, 4].map((n) => id("variant", n))), settings: { sets }, device,
  })
}

test("the product payload is read, kept to what the page uses and expanded on demand", () => {
  const raw = designPayload()
  const read = lib.readProductPhoneColours(raw)
  assert.deepEqual(Object.keys(read.variants), [id("variant", 1), id("variant", 2)], "variants with one colour are not listed")
  const view = lib.phoneColourView(read)
  assert.deepEqual(plain(view.optionsFor(id("variant", 1))), [["deep-blue", "Deep Blue", "#34405a"], ["cosmic-orange", "Cosmic Orange", "#f77e2d"], ["silver", "Silver", "#e3e4e5"]])
  assert.deepEqual(plain(view.optionsFor(id("variant", 2))).map((c) => c[0]), ["black-titanium", "white-titanium"])
  assert.deepEqual(plain(view.optionsFor(id("variant", 3))), [])
  assert.deepEqual(plain(view.optionsFor("variant_unknown")), [])
  assert.deepEqual(plain(view.inlineGallery(id("variant", 1), "silver")), [1, 2, 3].map((n) => picture("iphone-17-pro-max", "silver", n)), "base + tail round trip")
  assert.equal(view.inlineGallery(id("variant", 1), "silver"), view.inlineGallery(id("variant", 1), "silver"), "expanded once, so the gallery is not rebuilt every render")
  assert.equal(view.inlineGallery(id("variant", 2), "white-titanium"), undefined, "another model's pictures are not inline")
  assert.equal(view.hasInline(id("variant", 1)), true)
  assert.equal(view.hasInline(id("variant", 2)), false)
  assert.ok(raw.base.endsWith("/iphone-17-pro-max/"))

  assert.equal(lib.readProductPhoneColours({}), null, "no colours: exactly the old page")
  assert.equal(lib.readProductPhoneColours(null), null, "a failed read")
  const messy = lib.readProductPhoneColours({
    colours: [["silver", "Silver", "#E3E4E5"], ["Bad Slug", "x", "#000000"], ["black", "", "red"], ["blue", "Blue", "#0000ff"]],
    variants: { [id("variant", 9)]: [0, 1, 2, 0, 7], [id("variant", 8)]: [3] },
    base: "http://insecure.invalid/",
    galleries: { [id("variant", 9)]: { black: ["https://img.florayn.com/b.webp", 42], silver: ["https://img.florayn.com/main-should-not-be-here.webp"] } },
  })
  assert.deepEqual(plain(messy.colours), [["silver", "Silver", "#e3e4e5"], ["black", "black", "#c9c9cf"]], "invalid entries dropped, a missing hex is neutral grey")
  assert.deepEqual(plain(messy.variants), { [id("variant", 9)]: [0, 1] })
  assert.equal(messy.base, "", "only an https base")
  assert.deepEqual(plain(messy.galleries), { [id("variant", 9)]: { black: ["https://img.florayn.com/b.webp"] } }, "only extra colours keep pictures")
})

test("colour lookups read own keys only: a \"constructor\" web name never reads Object.prototype", () => {
  const read = lib.readProductPhoneColours({
    colours: [["black", "Black", "#000000"], ["silver", "Silver", "#e3e4e5"], ["constructor", "Constructor", "#111111"]],
    variants: { [id("variant", 9)]: [0, 1, 2] },
    base: "https://img.florayn.com/",
    galleries: { [id("variant", 9)]: { silver: ["https://img.florayn.com/a.webp"] } },
  })
  const view = lib.phoneColourView(read)
  assert.deepEqual(plain(view.optionsFor(id("variant", 9))).map((c) => c[0]), ["black", "silver", "constructor"])
  assert.deepEqual(plain(view.inlineGallery(id("variant", 9), "silver")), ["https://img.florayn.com/a.webp"])
  assert.equal(view.inlineGallery(id("variant", 9), "constructor"), undefined, "not the Object function, so the gallery never crashes")
  // The lazy answer is a null-prototype map: ProductView reads lazy[colour] directly.
  const lazy = lib.expandGalleries({ base: "https://x.invalid/", galleries: { silver: ["1.webp"] } })
  assert.equal(lazy.constructor, undefined)
  assert.equal(lazy["constructor"], undefined)
  assert.deepEqual(plain(lazy.silver), ["https://x.invalid/1.webp"])
})

test("the lazy variant payload is checked on the server (https pictures only) and expanded in the browser", () => {
  const rows = [
    { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "black-titanium", is_main: true, images: null },
    { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "white-titanium", is_main: false, images: [1, 2].map((n) => picture("iphone-16-pro-max", "white-titanium", n)) },
  ]
  const sets = [{ device: "iphone-16-pro-max", base_url: "", colours: ["Black Titanium", "White Titanium"], default_colour: "Black Titanium", enabled: true }]
  const read = lib.readVariantPhoneColours(backendColours.variantPhoneColours({ rows, variantId: id("variant", 2), settings: { sets } }))
  assert.deepEqual(plain(lib.expandGalleries(read)), { "white-titanium": [1, 2].map((n) => picture("iphone-16-pro-max", "white-titanium", n)) })
  assert.deepEqual(plain(lib.expandGalleries({ base: "", galleries: {} })), {})
  assert.deepEqual(plain(lib.readVariantPhoneColours({ base: "", galleries: { silver: ["data:image/svg+xml,x", "/relative.webp", "http://img.invalid/a.webp"] } })), { base: "", galleries: {} })
  assert.deepEqual(plain(lib.readVariantPhoneColours({ base: "http://img.invalid/", galleries: { silver: ["a.webp"], Silver: ["https://img.invalid/b.webp"] } })), { base: "", galleries: {} })
  assert.equal(lib.readVariantPhoneColours("nope"), null)
})

test("the product prop stays at or below 8,000 JSON bytes for 39 models x 4 colours x 13 pictures", () => {
  // Apple-like palettes from the console's suggestions, shared by several
  // generations (the owner's Mockup sets): 39 models, 4 colours each, 13 shots.
  const pool = ["Black", "White", "Silver", "Deep Blue", "Cosmic Orange", "Mist Blue", "Sage", "Lavender", "Black Titanium", "White Titanium",
    "Natural Titanium", "Desert Titanium", "Blue Titanium", "Pink", "Teal", "Ultramarine", "Midnight", "Starlight", "Purple", "Yellow", "Green", "Red"]
  const devices = Array.from({ length: 39 }, (_, i) => `iphone-${i + 1}-pro-max`)
  const sets = devices.map((device, i) => {
    const colours = [0, 1, 2, 3].map((k) => pool[(i * 3 + k * 5) % pool.length])
    return { device, base_url: "", colours, default_colour: colours[0], enabled: true }
  })
  const rows = []
  devices.forEach((device, i) => {
    const variant = id("variant", i + 1)
    const slugs = sets[i].colours.map(mockupSettings.colourSlug)
    rows.push({ variant_id: variant, device_slug: device, colour_slug: slugs[0], is_main: true, images: null })
    for (const colour of slugs.slice(1)) rows.push({ variant_id: variant, device_slug: device, colour_slug: colour, is_main: false, images: Array.from({ length: 13 }, (_, n) => picture(device, colour, n + 1)) })
  })
  const device = devices[38]
  const raw = backendColours.productPhoneColours({
    rows, galleryRows: rows.filter((r) => r.device_slug === device && !r.is_main),
    liveVariantIds: new Set(devices.map((_, i) => id("variant", i + 1))), settings: { sets }, device,
  })
  const prop = lib.readProductPhoneColours(raw)
  const bytes = Buffer.byteLength(JSON.stringify(prop))
  assert.equal(Object.keys(prop.variants).length, 39)
  assert.equal(Object.values(prop.galleries[id("variant", 39)]).flat().length, 39, "3 extra colours x 13 pictures inline for the first model only")
  assert.equal(id("variant", 1).length, 34, "IDs are 34 characters, as in PERFORMANCE.md")
  assert.ok(bytes <= 8000, `phoneColours prop is ${bytes} JSON bytes`)
  // Measured with the design's 39 x 4 x 13 shape; recorded in PHONE_COLOURS.md.
  console.log(`# phoneColours prop: ${bytes} JSON bytes (${prop.colours.length} colour entries)`)
})

// ------------------------------------------------------------ ProductView

/** Enough React for one component: hook slots across renders and effects on commit. */
function hooksRuntime() {
  let current = null
  let cursor = 0
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const slot = () => [current, cursor++]
  const react = {
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
    useEffect(fn, deps) {
      const [inst, i] = slot()
      const previous = inst.slots[i]
      if (previous && same(previous.deps, deps)) return
      if (!previous) inst.slots[i] = { deps: null, cleanup: undefined }
      inst.pending.push({ i, fn, deps })
    },
  }
  function mount(Component, props) {
    const inst = { slots: [], pending: [], dirty: false, tree: null }
    const render = () => {
      current = inst
      cursor = 0
      inst.dirty = false
      inst.tree = Component(props)
      current = null
    }
    const flush = () => {
      const list = inst.pending
      inst.pending = []
      for (const { i, fn, deps } of list) {
        inst.slots[i]?.cleanup?.()
        const cleanup = fn()
        inst.slots[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined }
      }
    }
    const settleRenders = () => {
      for (let guard = 0; inst.dirty && guard < 20; guard += 1) {
        render()
        flush()
      }
    }
    render()
    const handle = {
      get tree() { return inst.tree },
      commit() { flush(); settleRenders(); return handle },
      update() { inst.dirty = true; settleRenders(); return handle },
    }
    return handle
  }
  return { react, mount }
}

function fakeTimers() {
  let now = 0
  let next = 0
  const timers = new Map()
  return {
    setTimeout(fn, ms = 0) { next += 1; timers.set(next, { fn, at: now + ms }); return next },
    clearTimeout(timer) { timers.delete(timer) },
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
  }
}

function walk(node, match, found = []) {
  if (Array.isArray(node)) for (const child of node) walk(child, match, found)
  else if (node && typeof node === "object") {
    if (match(node)) found.push(node)
    if (node.props) walk(node.props.children, match, found)
  }
  return found
}
const byType = (tree, type) => walk(tree, (node) => node.type === type)

const P17 = "iPhone 17 Pro Max"
const P16 = "iPhone 16 Pro Max"
const SOLD = { Signature: [P17, P16], "Armor Black": [P17, P16] }
const variantFor = { [pairKey("Signature", P17)]: id("variant", 1), [pairKey("Signature", P16)]: id("variant", 2), [pairKey("Armor Black", P17)]: id("variant", 3), [pairKey("Armor Black", P16)]: id("variant", 4) }

function viewProps({ colours = designPayload(), deviceName = null, initialDevice = P17 } = {}) {
  const matrix = { caseTypes: Object.keys(SOLD), devices: [P17, P16], devicesByCaseType: SOLD, caseTypesByDevice: { [P17]: ["Signature", "Armor Black"], [P16]: ["Signature", "Armor Black"] }, variantIdByPair: variantFor }
  const variants = Object.entries(variantFor).map(([pair, variantId]) => ({
    id: variantId, title: pair, calculated_price: { calculated_amount: 1400, currency_code: "bdt" },
    metadata: { images: [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${variantId}/${n}.webp`) },
  }))
  return {
    pagePath: "/product/muse/", matrix, variants, families: {}, stock: {}, fallbackImages: [],
    designName: "Muse", productHandle: "muse", productTitle: "Muse", deviceName,
    initialCaseType: "Signature", initialDevice, designData: {}, buyBox: {}, tabs: null,
    caseTypeRecords: [{ slug: "signature", name: "Signature" }, { slug: "armor-black", name: "Armor Black" }],
    phoneColours: colours ? lib.readProductPhoneColours(colours) : undefined,
  }
}

function harness({ search = "", fetchImpl } = {}) {
  const { react, mount } = hooksRuntime()
  const timers = fakeTimers()
  const requests = []
  const events = []
  const fetch = fetchImpl === null ? undefined : (url) => {
    requests.push(url)
    return (fetchImpl ?? (() => Promise.reject(new Error("no answer"))))(url)
  }
  const { default: ProductView } = load(path.join(src, "components/product-view.tsx"), (name) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    if (name === "@/lib/variant-matrix") return variantMatrix
    if (name === "@/lib/phone-colours") return lib
    if (name === "@/lib/product-view-data") return { expandProductViewDesigns: () => ({}) }
    if (name === "@/lib/product-forms") return { featuresGroup: () => undefined }
    if (name === "@/lib/tracking/queue") return { track: (event, data) => events.push({ event, data }) }
    if (name.startsWith("@/components/")) return { __esModule: true, default: name }
    throw new Error(`Unexpected dependency ${name}`)
  }, { window: { location: { search } }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...(fetch ? { fetch } : {}) })
  const open = (props = viewProps()) => mount(ProductView, props).commit()
  const box = (page) => byType(page.tree, "@/components/product-buy-box")[0].props
  const gallery = (page) => byType(page.tree, "@/components/product-gallery")[0]
  return { open, box, gallery, timers, requests, events }
}

const urls = (page, h) => plain(h.gallery(page).props.items).map((item) => item.url)

test("the page opens on the main colour, server and client alike, and loads nothing", () => {
  const h = harness()
  const page = h.open()
  const colours = h.box(page).phoneColours
  assert.deepEqual(plain(colours.options).map((c) => c[0]), ["deep-blue", "cosmic-orange", "silver"])
  assert.equal(colours.value, "deep-blue")
  assert.equal(colours.busy, null)
  assert.deepEqual(urls(page, h), [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 1)}/${n}.webp`))
  h.timers.advance(10_000)
  assert.deepEqual(h.requests, [], "nothing is fetched on page load")
})

test("a colour switch changes the pictures only: same gallery identity, variant, bag picture and events", () => {
  const h = harness()
  const page = h.open()
  const before = h.gallery(page)
  const eventCount = h.events.length
  h.box(page).phoneColours.onSelect("silver")
  page.update()
  const after = h.gallery(page)
  assert.equal(after.key, before.key, "no remount: the shown angle is kept")
  assert.deepEqual(plain(after.props.items).map((item) => item.id), plain(before.props.items).map((item) => item.id).slice(0, 3), "item IDs stay `${variant}-${n}`")
  assert.deepEqual(urls(page, h), [1, 2, 3].map((n) => picture("iphone-17-pro-max", "silver", n)))
  const box = h.box(page)
  assert.equal(box.phoneColours.value, "silver")
  assert.equal(box.selected.id, id("variant", 1), "the same variant goes in the bag")
  assert.equal(box.thumbnail, `https://img.florayn.com/main/${id("variant", 1)}/1.webp`, "the bag, wishlist and pack picture stay the main colour")
  assert.equal(box.imageForCaseType("Signature"), picture("iphone-17-pro-max", "silver", 1), "the current case type's tile follows the colour")
  assert.equal(box.imageForCaseType("Armor Black"), `https://img.florayn.com/main/${id("variant", 3)}/1.webp`)
  h.timers.advance(10_000)
  assert.equal(h.events.length, eventCount, "no ViewContent and no new event for a colour")
  assert.deepEqual(h.requests, [], "inline pictures need no request")
})

test("a case type without colours hides the row; coming back restores the colour", () => {
  const h = harness()
  const page = h.open()
  h.box(page).phoneColours.onSelect("silver")
  page.update()
  h.box(page).onSelectCaseType("Armor Black")
  page.update()
  assert.equal(h.box(page).phoneColours, null)
  assert.deepEqual(urls(page, h), [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 3)}/${n}.webp`))
  h.box(page).onSelectCaseType("Signature")
  page.update()
  assert.equal(h.box(page).phoneColours.value, "silver")
  assert.deepEqual(urls(page, h), [1, 2, 3].map((n) => picture("iphone-17-pro-max", "silver", n)))
})

const lazyAnswer = () => Promise.resolve({ ok: true, json: async () => backendColours.variantPhoneColours({
  rows: [
    { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "black-titanium", is_main: true, images: null },
    { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "white-titanium", is_main: false, images: [1, 2].map((n) => picture("iphone-16-pro-max", "white-titanium", n)) },
  ],
  variantId: id("variant", 2),
  settings: { sets: [{ device: "iphone-16-pro-max", base_url: "", colours: ["Black Titanium", "White Titanium"], default_colour: "Black Titanium", enabled: true }] },
}) })

test("another model's colours load once from the same-origin route after the switch settles", async () => {
  const h = harness({ fetchImpl: lazyAnswer })
  const page = h.open()
  h.box(page).phoneColours.onSelect("silver")
  page.update()
  h.box(page).onSelectDevice(P16)
  page.update()
  assert.equal(h.box(page).phoneColours.value, "black-titanium", "silver is not a 16 Pro Max colour here: its main colour shows")
  h.timers.advance(249)
  assert.deepEqual(h.requests, [])
  h.timers.advance(1)
  assert.deepEqual(h.requests, [`/api/phone-colours/${id("variant", 2)}/`], "trailing slash: no redirect")
  await settle()
  page.update()
  h.box(page).phoneColours.onSelect("white-titanium")
  page.update()
  assert.deepEqual(urls(page, h), [1, 2].map((n) => picture("iphone-16-pro-max", "white-titanium", n)))
  h.box(page).onSelectDevice(P17)
  page.update()
  h.box(page).onSelectDevice(P16)
  page.update()
  h.timers.advance(1000)
  assert.equal(h.requests.length, 1, "loaded once per variant")
  assert.equal(h.box(page).phoneColours.value, "white-titanium")
})

test("a kept colour another model also has stays checked and busy from the switch until its pictures arrive", async () => {
  const sixteen = [{ device: "iphone-16-pro-max", base_url: "", colours: ["Black Titanium", "White Titanium", "Silver"], default_colour: "Black Titanium", enabled: true }]
  const withSilver = () => Promise.resolve({ ok: true, json: async () => backendColours.variantPhoneColours({
    rows: [
      { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "black-titanium", is_main: true, images: null },
      { variant_id: id("variant", 2), device_slug: "iphone-16-pro-max", colour_slug: "silver", is_main: false, images: [1, 2].map((n) => picture("iphone-16-pro-max", "silver", n)) },
    ],
    variantId: id("variant", 2), settings: { sets: sixteen },
  }) })
  const main16 = [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 2)}/${n}.webp`)
  const switchToSixteen = (h) => {
    const page = h.open(viewProps({ colours: designPayload(undefined, { silver16: true }) }))
    h.box(page).phoneColours.onSelect("silver")
    page.update()
    h.box(page).onSelectDevice(P16)
    page.update()
    return page
  }
  let h = harness({ fetchImpl: withSilver })
  let page = switchToSixteen(h)
  let colours = h.box(page).phoneColours
  assert.deepEqual(plain(colours.options).map((c) => c[0]), ["black-titanium", "white-titanium", "silver"])
  assert.equal(colours.value, "silver", "the kept colour stays checked while the switch settles: the row never snaps to the main colour")
  assert.equal(colours.busy, "silver")
  assert.deepEqual(h.requests, [], "the load still waits for the switch to settle")
  assert.deepEqual(urls(page, h), main16, "the main pictures stay meanwhile")
  h.timers.advance(250)
  page.update()
  assert.deepEqual(h.requests, [`/api/phone-colours/${id("variant", 2)}/`])
  assert.equal(h.box(page).phoneColours.busy, "silver", "and while the request runs")
  await settle()
  page.update()
  colours = h.box(page).phoneColours
  assert.equal(colours.value, "silver")
  assert.equal(colours.busy, null)
  assert.deepEqual(urls(page, h), [1, 2].map((n) => picture("iphone-16-pro-max", "silver", n)))

  // A loaded payload without that colour shows the main colour: a dot is never busy forever.
  h = harness({ fetchImpl: () => Promise.resolve({ ok: true, json: async () => ({ base: "", galleries: {} }) }) })
  page = switchToSixteen(h)
  assert.equal(h.box(page).phoneColours.busy, "silver")
  h.timers.advance(250)
  await settle()
  page.update()
  colours = h.box(page).phoneColours
  assert.equal(colours.value, "black-titanium")
  assert.equal(colours.busy, null)
  assert.deepEqual(urls(page, h), main16)
  h.timers.advance(10_000)
  assert.equal(h.requests.length, 1, "no retry loop")
})

test("while loading the dot is pressed and busy over the main pictures; a failure falls back and the next tap retries", async () => {
  let answer
  const h = harness({ fetchImpl: () => answer() })
  const page = h.open()
  h.box(page).onSelectDevice(P16)
  page.update()
  let release
  answer = () => new Promise((resolve, reject) => { release = reject })
  h.box(page).phoneColours.onIntent()
  page.update()
  h.box(page).phoneColours.onSelect("white-titanium")
  page.update()
  assert.equal(h.requests.length, 1, "intent started the one request; the tap does not repeat it")
  let colours = h.box(page).phoneColours
  assert.equal(colours.value, "white-titanium")
  assert.equal(colours.busy, "white-titanium")
  assert.deepEqual(urls(page, h), [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 2)}/${n}.webp`), "the gallery is never empty")
  release(new Error("offline"))
  await settle()
  page.update()
  colours = h.box(page).phoneColours
  assert.equal(colours.value, "black-titanium", "a failed load stays on the main colour")
  assert.equal(colours.busy, null)
  h.timers.advance(1000)
  assert.equal(h.requests.length, 1, "no automatic retry loop")
  answer = lazyAnswer
  h.box(page).phoneColours.onSelect("white-titanium")
  page.update()
  assert.equal(h.requests.length, 2, "the next tap retries")
  await settle()
  page.update()
  assert.equal(h.box(page).phoneColours.value, "white-titanium")
  assert.equal(h.box(page).phoneColours.busy, null)
})

test("?color= is read after hydration: inline colours show at once, another model's load, unknown ones are ignored", async () => {
  let h = harness({ search: "?case=signature&color=silver" })
  let page = h.open()
  assert.equal(h.box(page).phoneColours.value, "silver")
  assert.deepEqual(urls(page, h), [1, 2, 3].map((n) => picture("iphone-17-pro-max", "silver", n)))
  assert.deepEqual(h.requests, [])

  h = harness({ search: `?variant=${id("variant", 2)}&color=white-titanium`, fetchImpl: lazyAnswer })
  page = h.open()
  assert.equal(h.box(page).device, P16)
  assert.deepEqual(h.requests, [`/api/phone-colours/${id("variant", 2)}/`])
  await settle()
  page.update()
  assert.equal(h.box(page).phoneColours.value, "white-titanium")

  // A pair without colours (Armor Black, legacy pictures) ignores it.
  h = harness({ search: "?case=armor-black&color=silver" })
  page = h.open()
  assert.equal(h.box(page).phoneColours, null)
  assert.deepEqual(urls(page, h), [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 3)}/${n}.webp`))
  assert.deepEqual(h.requests, [])

  // A device page never changes device for a colour another model has.
  h = harness({ search: "?color=white-titanium" })
  page = h.open(viewProps({ deviceName: P17, initialDevice: P17 }))
  assert.equal(h.box(page).device, P17)
  assert.equal(h.box(page).phoneColours.value, "deep-blue")
  h.timers.advance(10_000)
  assert.deepEqual(h.requests, [])
})

test("legacy pictures: no row, no request, ever", () => {
  const h = harness({ search: "?color=silver", fetchImpl: null })
  const page = h.open(viewProps({ colours: null }))
  assert.equal(h.box(page).phoneColours, null)
  h.box(page).onSelectDevice(P16)
  page.update()
  h.timers.advance(10_000)
  assert.equal(h.box(page).phoneColours, null)
  assert.deepEqual(urls(page, h), [1, 2, 3, 4].map((n) => `https://img.florayn.com/main/${id("variant", 2)}/${n}.webp`))
})

test("the product page asks for colours beside the related reads and never sends them for simple products", () => {
  const page = fs.readFileSync(path.join(src, "components/pages/product-page.tsx"), "utf8").replace(/\r\n/g, "\n")
  assert.match(page, /const coloursPromise = Promise\.all\(\[productPromise, getDeviceCatalog\(\)\]\)/)
  assert.match(page, /if \(!resolved \|\| !isCaseMatrix\(resolved\.matrix\)\) return null/)
  assert.match(page, /relatedPromise,\n\s*picksPromise,\n\s*matchingPromise,\n\s*coloursPromise,\n\s*\]\)/, "one Promise.all with the related data: no new waterfall")
  assert.match(page, /\{\.\.\.\(phoneColours \? \{ phoneColours \} : \{\}\)\}/, "no prop at all without colours")
  const view = fs.readFileSync(path.join(src, "components/product-view.tsx"), "utf8").replace(/\r\n/g, "\n")
  assert.doesNotMatch(view, /localStorage|sessionStorage/, "a remembered colour is never applied (a second hero download)")
  assert.doesNotMatch(view, /history\.(replace|push)State|router\.replace/, "selection never rewrites the URL")
  const effect = view.slice(view.indexOf("pickFromQuery(window.location.search"), view.indexOf("if (!pick) return"))
  assert.match(effect, /colourFromQuery\(window\.location\.search\)/, "?color= is read in the one post-hydration effect, after pickFromQuery")
  const data = fs.readFileSync(path.join(src, "lib/product-view-data.ts"), "utf8").replace(/\r\n/g, "\n")
  assert.match(data, /metadata: \{ images: variant\.metadata\?\.images \?\? \[\] \}/, "the variant projection is unchanged")
})

// ------------------------------------------------------------ PHONE COLOR row

const buyBoxModules = new Map()
function loadBuyBox(relative) {
  if (buyBoxModules.has(relative)) return buyBoxModules.get(relative)
  const exports = load(path.join(src, relative), (name) => {
    if (name === "next/navigation") return { useRouter: () => ({ push() {}, prefetch() {} }) }
    if (name === "@/components/cart-provider") return { useCart: () => ({ add: () => { throw new Error("SSR must not touch the cart") }, items: null }) }
    if (name === "@/components/drag-scroll") return loadBuyBox("components/drag-scroll.tsx")
    if (name === "@/components/pack-selector") return { __esModule: true, default: () => null }
    if (name === "@/components/wishlist-button") return { __esModule: true, default: () => null }
    if (["@/components/model-drawer", "@/components/product-image"].includes(name)) return { __esModule: true, default: () => null }
    if (name === "@/components/ui/button") return { Spinner: () => null }
    if (name === "@/components/product-buy-bar") return loadBuyBox("components/product-buy-bar.tsx")
    if (name.startsWith("@/lib/")) return loadBuyBox(`${name.slice(2)}.ts`)
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name)
    throw new Error(`Unexpected import ${name}`)
  })
  buyBoxModules.set(relative, exports)
  return exports
}

function renderBox(extra = {}) {
  const BuyBox = loadBuyBox("components/product-buy-box.tsx").default
  const { DEFAULT_PRESENTATION } = loadBuyBox("lib/storefront-presentation.ts")
  const cases = ["Signature", "Armor Black"]
  return renderToStaticMarkup(React.createElement(BuyBox, {
    matrix: { caseTypes: cases, devices: [P17], variantIdByPair: Object.fromEntries(cases.map((c) => [pairKey(c, P17), `var_${c}`])), devicesByCaseType: Object.fromEntries(cases.map((c) => [c, [P17]])), caseTypesByDevice: { [P17]: cases } },
    selected: { id: "var_Signature", calculated_price: { calculated_amount: 1400, currency_code: "bdt" } },
    families: {}, stock: {}, productHandle: "muse", productTitle: "Muse", designName: "Muse", bundleConfig: null,
    packDesigns: [], caseTypeRecords: [], matchingProduct: null, thumbnail: null, caseType: "Signature", device: P17,
    onSelectCaseType() {}, onSelectDevice() {}, imageForCaseType: () => null, priceForCaseType: () => 1400,
    buyBox: DEFAULT_PRESENTATION.buy_box, ...extra,
  }))
}
const control = (value = "silver", busy = null) => ({
  options: [["deep-blue", "Deep Blue", "#34405a"], ["cosmic-orange", "Cosmic Orange", "#f77e2d"], ["silver", "Silver", "#e3e4e5"]],
  value, busy, onSelect() {}, onIntent() {},
})

test("PHONE COLOR sits under MODEL as a server-rendered radio group of 28px dots with the owner's note", () => {
  const html = renderBox({ phoneColours: control() })
  assert.match(html, /<p class="fl-pdp-label">PHONE COLOR <span class="font-normal normal-case text-ink-muted">Silver<\/span><\/p>/)
  assert.match(html, /<ul role="radiogroup" aria-label="Phone color" class="fl-colour-dots"/)
  const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => tag)
  assert.equal(radios.length, 3, "native radios: one tab stop, arrow keys and checked state come with them")
  assert.deepEqual(radios.map((tag) => /checked=""/.test(tag)), [false, false, true])
  assert.ok(radios.every((tag) => /name="phone-colour"/.test(tag) && /class="sr-only"/.test(tag)))
  assert.match(radios[2], /aria-label="Silver"/)
  assert.match(html, /<li role="none"><label class="fl-colour-dot" title="Silver">/)
  assert.match(html, /<span style="background-color:#e3e4e5"><\/span>/)
  assert.match(html, /Only changes the pictures\. The case is the same for every phone colour\./)
  const at = (text) => html.indexOf(text)
  assert.ok(at("MODEL") < at("PHONE COLOR") && at("PHONE COLOR") < at("CASE TYPE"), "Model, phone colour, then case type")
  assert.match(html, />iPhone 17 Pro Max · Signature</, "the quick-buy bar detail has no colour")
  assert.doesNotMatch(html, /fl-buybar[^]*Silver/, "nor anywhere in the bar")
  assert.match(renderBox({ phoneColours: control("silver", "silver") }), /aria-label="Silver" aria-busy="true"[^>]*value="silver"/)
  // Six dots fit at 320px: no slider bar in the server HTML that hydration would remove (layout shift).
  assert.match(html, /<\/ul><p class="fl-colour-note">/, "three dots: no bar")
  const seven = { ...control(), options: Array.from({ length: 7 }, (_, i) => [`c${String.fromCharCode(97 + i)}`, `Colour ${i + 1}`, "#cccccc"]) }
  assert.match(renderBox({ phoneColours: seven }), /<\/ul><div class="fl-scrollbar" aria-hidden="true"><span><\/span><\/div><p class="fl-colour-note">/, "seven dots can scroll: the bar shows")
  // onClick, not onChange: a tap on the dot already checked (the main colour after a failed load) still sets the preference.
  const box = fs.readFileSync(path.join(src, "components/product-buy-box.tsx"), "utf8").replace(/\r\n/g, "\n")
  const row = box.slice(box.indexOf("function PhoneColourRow("), box.indexOf("\n}\n", box.indexOf("function PhoneColourRow(")))
  assert.match(row, /onClick=\{\(\) => onSelect\(slug\)\}\n\s*onChange=\{\(\) => \{\}\}/)
  assert.equal(row.match(/onSelect\(/g).length, 1, "only one handler calls onSelect, so a retry never fetches twice")
})

test("no row without phone colours (ProductView sends them only for 2 or more), and never in simple mode (StickPad's COLOR is sellable)", () => {
  assert.doesNotMatch(renderBox(), /PHONE COLOR|radiogroup/)
  assert.doesNotMatch(renderBox({ phoneColours: control(), simple: true, device: "" }), /PHONE COLOR/)
})

// ------------------------------------------------------------ shop

const palette = { caseType: "signature", default: "deep-blue", colours: [["deep-blue", "Deep Blue", "#34405a", 1], ["cosmic-orange", "Cosmic Orange", "#f77e2d", 0], ["silver", "Silver", "#e3e4e5", 1], ["sage", "Sage", "#b9c3a6", 1]] }

function shopFilterPage(read = async () => palette) {
  const calls = []
  const audience = load(path.join(src, "lib/audience.ts"), none("lib/audience.ts"))
  const mod = load(path.join(src, "components/pages/shop-filter-page.tsx"), (name) => {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    if (name === "next/navigation") return {
      notFound: () => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }) },
      redirect: (to) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }) },
    }
    if (name === "@/components/shop-view") return { __esModule: true, default: "ShopView", shopMetadata: async (input) => input }
    if (name === "@/lib/audience") return audience
    if (name === "@/lib/phone-colours") return lib
    if (name === "@/lib/catalog") return { getDeviceCatalog: async () => [], getShopPhoneColours: async (...args) => { calls.push(args); return read(...args) } }
    throw new Error(`Unexpected dependency ${name}`)
  })
  return { ...mod, calls }
}

test("shop paths: 3 and 4 segments, a number is always the page, a colour is a web name", () => {
  const { parseShopSlug } = shopFilterPage()
  const parse = (path) => plain(parseShopSlug(path.split("/")))
  assert.deepEqual(parse("iphone-17-pro-max"), { deviceSlug: "iphone-17-pro-max", page: 1 })
  assert.deepEqual(parse("iphone-17-pro-max/2"), { deviceSlug: "iphone-17-pro-max", page: 2 })
  assert.deepEqual(parse("iphone-17-pro-max/signature"), { deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", page: 1 })
  assert.deepEqual(parse("iphone-17-pro-max/signature/3"), { deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", page: 3 })
  assert.deepEqual(parse("iphone-17-pro-max/signature/silver"), { deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", colourSlug: "silver", page: 1 })
  assert.deepEqual(parse("iphone-17-pro-max/signature/deep-blue/2"), { deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", colourSlug: "deep-blue", page: 2 })
  for (const bad of ["a/b/Silver", "a/b/silver-", "a/b/2/3", "a/b/silver/x", "a/b/silver/2/3", "a/b/-x/2"]) assert.equal(parseShopSlug(bad.split("/")), null, bad)
})

test("a colour path: unknown or unavailable -> 404, the default colour -> the colour-less page, palette down -> colour-less view", async () => {
  const { default: ShopFilterPage, calls } = shopFilterPage()
  const tree = await ShopFilterPage({ slug: ["iphone-17-pro-max", "signature", "silver", "2"], audience: "women" })
  assert.equal(tree.type, "ShopView")
  assert.equal(tree.props.colourSlug, "silver")
  assert.equal(tree.props.page, 2)
  assert.equal(tree.props.routePath, "/shop/iphone-17-pro-max/signature/silver/2/")
  assert.deepEqual(calls, [["iphone-17-pro-max", "signature"]])
  for (const colour of ["cosmic-orange", "pink"]) {
    await assert.rejects(ShopFilterPage({ slug: ["iphone-17-pro-max", "signature", colour], audience: "women" }), (error) => error.notFound === true, colour)
  }
  await assert.rejects(ShopFilterPage({ slug: ["iphone-17-pro-max", "signature", "deep-blue"], audience: "women" }), (error) => error.to === "/shop/iphone-17-pro-max/signature/")
  await assert.rejects(ShopFilterPage({ slug: ["iphone-17-pro-max", "signature", "deep-blue", "3"], audience: "men" }), (error) => error.to === "/men/shop/iphone-17-pro-max/signature/3/")
  const down = shopFilterPage(async () => null)
  const fallback = await down.default({ slug: ["iphone-17-pro-max", "signature", "silver"], audience: "women" })
  assert.equal(fallback.props.colourSlug, undefined, "a failed palette read shows the usual pictures")
  const plainPage = await down.default({ slug: ["iphone-17-pro-max", "signature"], audience: "women" })
  assert.equal(plainPage.props.colourSlug, undefined)
  assert.equal(down.calls.length, 1, "colour-less paths do not read the palette here")
  const meta = await shopFilterPage().shopFilterMetadata(["iphone-17-pro-max", "signature", "silver"], "women")
  assert.deepEqual(plain(meta), { deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", audience: "women" }, "the canonical URL never has the colour")
})

function shopView({ cards, colourPalette = palette }) {
  const requests = { cards: [], palettes: [] }
  const device = { name: P17, slug: "iphone-17-pro-max", family: "iphone" }
  const audience = load(path.join(src, "lib/audience.ts"), none("lib/audience.ts"))
  const { default: ShopView } = load(path.join(src, "components/shop-view.tsx"), (name) => {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    if (name === "@/lib/audience") return audience
    if (name === "@/lib/phone-colours") return lib
    if (name.startsWith("@/components/")) return { __esModule: true, default: name }
    if (name === "@/lib/catalog") return {
      getDeviceCatalog: async () => [device],
      getCaseTypes: async () => [{ name: "Signature", slug: "signature", price: 1400 }],
      getShopCatalog: async () => ["muse", "legacy"].map((slug) => ({ slug, name: slug, forms: ["phone"], caseTypes: ["signature"] })),
      shopCardImage: (slug) => `https://img.florayn.com/${slug}/legacy.webp`,
      getShopCards: async (...args) => { requests.cards.push(args); return cards },
      getShopPhoneColours: async (...args) => { requests.palettes.push(args); return colourPalette },
    }
    if (name === "@/lib/medusa") return { listProducts: async () => ({ products: [] }) }
    throw new Error(`Unexpected dependency ${name}`)
  })
  return { ShopView, requests }
}

test("shop cards: the colour's picture when a design has it, its own otherwise; nothing else changes", async () => {
  const cards = [
    { handle: "muse", variantId: "variant-muse", image: "https://img.florayn.com/muse/main.webp", imagesByCaseType: {}, colourImage: "https://img.florayn.com/muse/silver.webp" },
    { handle: "legacy", variantId: "variant-legacy", image: "https://img.florayn.com/legacy/main.webp", imagesByCaseType: {} },
  ]
  const { ShopView, requests } = shopView({ cards })
  const tree = await ShopView({ deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", colourSlug: "silver", routePath: "/shop/iphone-17-pro-max/signature/silver/" })
  const grid = tree.props.children[1].props
  assert.deepEqual(plain(requests.cards[0]), [["muse", "legacy"], P17, "Signature", "silver"])
  assert.deepEqual(plain(requests.palettes), [["iphone-17-pro-max", "signature"]])
  assert.deepEqual(grid.products.map((p) => p.variants[0].metadata.images[0]), ["https://img.florayn.com/muse/silver.webp", "https://img.florayn.com/legacy/main.webp"])
  assert.deepEqual(grid.products.map((p) => p.thumbnail), ["https://img.florayn.com/muse/main.webp", "https://img.florayn.com/legacy/main.webp"], "the product thumbnail stays the main colour")
  assert.deepEqual(grid.products.map((p) => p.variants[0].id), ["variant-muse", "variant-legacy"], "Quick Add variants unchanged")
  assert.equal(grid.totalCount, 2, "a colour never filters")
  assert.equal(grid.colourQuery, "&color=silver")
  assert.equal(grid.pageBase, "/shop/iphone-17-pro-max/signature/silver/", "page links keep the colour")
  assert.deepEqual(plain(grid.colourMenu), plain(lib.shopColourMenu({ palette, current: "silver", deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", pageCaseTypeSlug: "signature" })))
  assert.equal(grid.colourMenu.name, "Silver")

  const colourless = await shopView({ cards }).ShopView({ deviceSlug: "iphone-17-pro-max" })
  const plainGrid = colourless.props.children[1].props
  assert.equal(plainGrid.products[0].variants[0].metadata.images[0], "https://img.florayn.com/muse/main.webp", "colourImage only counts on a colour page")
  assert.equal(plainGrid.colourQuery, undefined)
  assert.equal(plainGrid.pageBase, "/shop/iphone-17-pro-max/signature/", "page links as before: the case type in view")
  assert.equal(plainGrid.colourMenu.name, "Deep Blue", "the colour-less page is the default colour")
  assert.equal(plainGrid.colourMenu.options[0].href, "/shop/iphone-17-pro-max/", "the default links to this page's colour-less path")
  const down = await shopView({ cards, colourPalette: null }).ShopView({ deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature" })
  assert.equal(down.props.children[1].props.colourMenu, undefined, "a failed palette read: no menu")
  const noSet = await shopView({ cards, colourPalette: { caseType: "signature", default: null, colours: [] } }).ShopView({ deviceSlug: "iphone-17-pro-max" })
  assert.equal(noSet.props.children[1].props.colourMenu, undefined, "a model without a Mockup set sends no menu at all")
  const single = { ...palette, colours: palette.colours.map((c, i) => [c[0], c[1], c[2], i === 0 ? 1 : 0]) }
  assert.equal((await shopView({ cards, colourPalette: single }).ShopView({ deviceSlug: "iphone-17-pro-max" })).props.children[1].props.colourMenu, undefined, "one available colour is no choice")
})

test("the shop Phone color menu: available colours only, the default to the colour-less page, page 1", () => {
  const props = { palette, current: "silver", deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", pageCaseTypeSlug: "signature" }
  const menu = plain(lib.shopColourMenu(props))
  assert.deepEqual(menu.options.map((o) => [o.label, o.href, o.current]), [
    ["Deep Blue", "/shop/iphone-17-pro-max/signature/", false],
    ["Silver", "/shop/iphone-17-pro-max/signature/silver/", true],
    ["Sage", "/shop/iphone-17-pro-max/signature/sage/", false],
  ], "Cosmic Orange has no pictures yet, so no option")
  assert.deepEqual([menu.name, menu.hex], ["Silver", "#e3e4e5"])
  const home = plain(lib.shopColourMenu({ ...props, current: null, pageCaseTypeSlug: null }))
  assert.equal(home.name, "Deep Blue", "the colour-less page is the default colour")
  assert.equal(home.options[0].href, "/shop/iphone-17-pro-max/")
  const one = { ...palette, colours: palette.colours.map((c, i) => [c[0], c[1], c[2], i === 0 ? 1 : 0]) }
  assert.equal(lib.shopColourMenu({ ...props, palette: one }), null, "fewer than 2 available colours: no menu")
  assert.equal(lib.shopColourMenu({ ...props, palette: null }), null)
})

function loadShopGrid() {
  const modules = new Map()
  const one = (relative) => {
    if (modules.has(relative)) return modules.get(relative)
    const exports = {}
    modules.set(relative, exports)
    const filename = path.join(src, relative)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { exports, console, require(name) {
      if (name === "next/link" || name === "@/components/audience-link") return { __esModule: true, default: ({ prefetch, scroll, ...props }) => React.createElement("a", props) }
      if (name === "@/components/quick-add") return { __esModule: true, default: ({ variantId, thumbnail }) => React.createElement("button", { "data-variant": variantId, "data-thumbnail": thumbnail }, "Add") }
      if (name.startsWith("@/")) {
        const rel = name.slice(2)
        return one(`${rel}${fs.existsSync(path.join(src, `${rel}.tsx`)) ? ".tsx" : ".ts"}`)
      }
      if (["react", "react/jsx-runtime", "next/image"].includes(name)) return require(name)
      throw new Error(`Unexpected dependency: ${name}`)
    } }, { filename })
    return exports
  }
  return one("components/shop-grid.tsx").default
}

test("a colour page keeps its colour in the page links and the card links; Quick Add keeps the exact variant", () => {
  const ShopGrid = loadShopGrid()
  const product = (i) => ({
    id: `p-${i}`, handle: `design-${i}`, title: `Design ${i}`, thumbnail: `/audit/design-${i}/main.webp`,
    variants: [{ id: `variant-${i}`, options: [{ value: P17 }, { value: "Signature" }], calculated_price: { calculated_amount: 1400 }, metadata: { images: [`/audit/design-${i}/silver.webp`] } }],
  })
  const html = renderToStaticMarkup(React.createElement(ShopGrid, {
    products: [product(0)], device: P17, deviceSlug: "iphone-17-pro-max", caseType: "Signature", caseTypeSlug: "signature",
    colourQuery: "&color=silver", colourMenu: lib.shopColourMenu({ palette, current: "silver", deviceSlug: "iphone-17-pro-max", caseTypeSlug: "signature", pageCaseTypeSlug: "signature" }), selectors: React.createElement("div", { "data-selectors": "" }),
    totalCount: 70, currentPage: 1, totalPages: 3, routePath: "/shop/iphone-17-pro-max/signature/silver/", pageBase: "/shop/iphone-17-pro-max/signature/silver/",
  }))
  assert.match(html, /href="\/shop\/iphone-17-pro-max\/signature\/silver\/2\/"/)
  assert.match(html, /href="\/shop\/iphone-17-pro-max\/signature\/silver\/3\/"/)
  assert.match(html, /href="\/product\/design-0-iphone-17-pro-max\/\?case=signature&amp;color=silver"/)
  assert.match(html, /data-variant="variant-0"/, "the same variant as the colour-less page")
  assert.match(html, /data-thumbnail="\/audit\/design-0\/main\.webp"/, "Quick Add puts the main colour in the bag, so the drawer line never flips")
  assert.doesNotMatch(html, /data-thumbnail="\/audit\/design-0\/silver\.webp"/)
  assert.match(html, /class="fl-shop-toolbar fl-shop-toolbar--colour"/, "a fourth control: 2 x 2 on phones, one row on desktop")
  const colourAt = html.indexOf('aria-label="Phone color: Silver"')
  assert.ok(colourAt > 0, "the Phone color menu shows the page's colour")
  assert.ok(html.indexOf("data-selectors") < colourAt && colourAt < html.indexOf("Sort designs on this page") && colourAt < html.indexOf('class="fl-grid"'), "Model and Case type, then Phone color, then Sort")
  assert.ok(!html.includes("/signature/sage/"), "the menu's links render only when it is opened")

  const colourless = renderToStaticMarkup(React.createElement(ShopGrid, {
    products: [product(0)], device: P17, deviceSlug: "iphone-17-pro-max", caseType: "Signature", caseTypeSlug: "signature",
    totalCount: 70, currentPage: 1, totalPages: 3, routePath: "/shop/iphone-17-pro-max/signature/", pageBase: "/shop/iphone-17-pro-max/signature/",
  }))
  assert.match(colourless, /href="\/shop\/iphone-17-pro-max\/signature\/2\/"/)
  assert.match(colourless, /href="\/product\/design-0-iphone-17-pro-max\/\?case=signature"/)
  assert.match(colourless, /data-thumbnail="\/audit\/design-0\/silver\.webp"/, "colour-less pages keep the card picture as before")
})

// ------------------------------------------------------------ data and cache

test("colour reads are tagged like product data, send colour only when set and fail safe", async () => {
  const requests = []
  let answer = (url) => url.includes("/store/shop-cards") ? { cards: [] } : url.includes("/variant/") ? { base: "", galleries: {} } : url.includes("/product?") ? designPayload() : palette
  let ok = true
  const catalog = load(path.join(src, "lib/catalog.ts"), (name) => {
    if (name === "./medusa") return { MEDUSA_BACKEND_URL: "http://fixture.invalid", MEDUSA_PUBLISHABLE_KEY: "fixture-only" }
    if (name === "./phone-colours") return lib
    throw new Error(`Unexpected dependency ${name}`)
  }, { fetch: async (url, options) => { requests.push({ url, tags: options.next.tags }); return { ok, json: async () => answer(url) } } })
  await catalog.getShopCards(["b", "a"], P17, "Signature")
  await catalog.getShopCards(["b", "a"], P17, "Signature", "silver")
  assert.equal(new URL(requests[0].url).searchParams.has("colour"), false, "colour-less pages keep their URL and cache entry")
  assert.equal(new URL(requests[1].url).searchParams.get("colour"), "silver")
  assert.deepEqual(plain(requests[1].tags), ["products", "catalog", "catalog:shop-cards"])

  const product = await catalog.getProductPhoneColours(id("prod", 1), "iphone-17-pro-max")
  assert.equal(requests.at(-1).url, `http://fixture.invalid/store/phone-colours/product?product_id=${id("prod", 1)}&device=iphone-17-pro-max`)
  assert.deepEqual(plain(requests.at(-1).tags), ["products", "catalog", "catalog:phone-colours"])
  assert.deepEqual(Object.keys(product.variants), [id("variant", 1), id("variant", 2)])
  assert.deepEqual(plain(await catalog.getShopPhoneColours("iphone-17-pro-max", "signature")), palette)
  assert.equal(requests.at(-1).url, "http://fixture.invalid/store/phone-colours?device=iphone-17-pro-max&case_type=signature")
  assert.deepEqual(plain(requests.at(-1).tags), ["products", "catalog", "catalog:phone-colours"])
  assert.deepEqual(plain(await catalog.getVariantPhoneColours(id("variant", 2))), { base: "", galleries: {} })
  assert.equal(requests.at(-1).url, `http://fixture.invalid/store/phone-colours/variant/${id("variant", 2)}`)
  answer = () => ({})
  assert.equal(await catalog.getProductPhoneColours(id("prod", 1), "iphone-17-pro-max"), null, "{} is no colours")
  ok = false
  assert.equal(await catalog.getProductPhoneColours(id("prod", 1), "iphone-17-pro-max"), null)
  assert.equal(await catalog.getShopPhoneColours("iphone-17-pro-max", "signature"), null)
  assert.equal(await catalog.getVariantPhoneColours(id("variant", 2)), null)

  const audience = load(path.join(src, "lib/audience.ts"), none("lib/audience.ts"))
  const { revalidationPlan } = load(path.join(src, "lib/revalidation.ts"), (name) => name === "./audience" ? audience : none("revalidation")(name))
  assert.deepEqual(plain(revalidationPlan({ tags: ["catalog:phone-colours"] }).tags), ["catalog:phone-colours"])
})

test("the lazy route: same origin, 404 for anything but a published variant, a one-minute cache", async () => {
  const asked = []
  let data = { base: "https://img.florayn.com/x/", galleries: { silver: ["1.webp"] } }
  const route = load(path.join(src, "app/api/phone-colours/[variant]/route.ts"), (name) => {
    if (name === "@/lib/catalog") return { getVariantPhoneColours: async (variantId) => { asked.push(variantId); return data } }
    if (name === "@/lib/phone-colours") return lib
    throw new Error(`Unexpected dependency ${name}`)
  }, { Response })
  const get = (variant) => route.GET(new Request("http://127.0.0.1/"), { params: Promise.resolve({ variant }) })
  for (const bad of ["variant_abc", "../store/stock", `${id("variant", 1)}x`, "prod_01K8ZQ00000000000000000001"]) {
    const res = await get(bad)
    assert.equal(res.status, 404, bad)
    assert.equal(res.headers.get("cache-control"), "no-store")
  }
  assert.deepEqual(asked, [], "a malformed ID never reaches the backend")
  const res = await get(id("variant", 1))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=600")
  assert.deepEqual(await res.json(), data)
  data = null
  assert.equal((await get(id("variant", 1))).status, 404, "unpublished or unknown")
})
