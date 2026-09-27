const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// lib/tracking/contract.ts and paths.ts against the shared Appendix C vectors
// (TRACKING.md 4.1). The backend runs the same fixture through its own copy.
const root = path.join(__dirname, "..")
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function load() {
  const context = vm.createContext({ URLSearchParams })
  const run = (file, modules) => {
    const exports = {}
    const require = (name) => {
      if (name in modules) return modules[name]
      throw new Error(`Unexpected import ${name}`)
    }
    vm.runInContext(`(function (exports, require) {${compile(file)}\n})`, context, { filename: file })(exports, require)
    return exports
  }
  const paths = run("src/lib/tracking/paths.ts", {})
  const contract = run("src/lib/tracking/contract.ts", { "./paths": paths })
  return { paths, contract }
}

const { paths, contract } = load()
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/tracking-vectors.json"), "utf8"))
const plain = (value) => JSON.parse(JSON.stringify(value))
const UUID = "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
const VARIANT = "variant_01K6EXAMPLEVARIANT01"

test("the fixture is Appendix C of TRACKING.md, byte for byte", () => {
  const lf = (text) => text.replace(/\r\n/g, "\n")
  const spec = lf(fs.readFileSync(path.join(root, "../../TRACKING.md"), "utf8"))
  const block = /## Appendix C\. Shared test vectors\n[\s\S]*?```json\n([\s\S]*?)```/.exec(spec)
  assert.ok(block, "TRACKING.md has the Appendix C json block")
  assert.equal(lf(fs.readFileSync(path.join(__dirname, "fixtures/tracking-vectors.json"), "utf8")), block[1])
  assert.equal(vectors.version, 1)
})

test("private paths: order, review and account, also under one /men", () => {
  assert.ok(vectors.private_paths.length >= 20)
  for (const [pathname, expected] of vectors.private_paths) assert.equal(contract.isPrivatePath(pathname), expected, pathname)
  assert.equal(contract.isPrivatePath("/order/x/?case=signature#top"), true, "query and hash are ignored")
  assert.equal(contract.isPrivatePath("/product/x/?next=/order/x/"), false)
  assert.equal(contract.isPrivatePath("//order/x/"), true)
})

test("safe paths keep only case, device and variant", () => {
  for (const [pathname, search, expected] of vectors.safe_path) assert.equal(contract.safePath(pathname, search), expected, pathname + search)
  assert.equal(contract.safePath("/product/x/"), "/product/x/")
  assert.equal(contract.safePath("/product/x/", `?case=${"a".repeat(81)}&device=d`), "/product/x/?device=d", "a value over 80 chars is dropped")
  const long = `/product/${"x".repeat(280)}/`
  assert.equal(contract.safePath(long, "?case=signature"), long.slice(0, 300), "over 300 chars keeps only the pathname")
  assert.equal(contract.safePath(`/${"y".repeat(400)}`, "").length, 300)
})

test("landing params keep only the allowlisted click ids and utm tags", () => {
  for (const [search, expected] of vectors.landing_params) assert.deepEqual(plain(contract.landingParams(search)), expected, search)
  assert.deepEqual(plain(contract.landingParams(`?ttclid=${"t".repeat(1001)}&gclid=g`)), { gclid: "g" })
  assert.equal(contract.landingParams(`?ttclid=${"t".repeat(1000)}`).ttclid.length, 1000, "a click id is never truncated")
  assert.deepEqual(plain(contract.CLICK_KEYS), ["fbclid", "ttclid", "gclid", "gbraid", "wbraid"])
  assert.deepEqual(plain(contract.LANDING_PARAMS), ["fbclid", "ttclid", "gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign"])
  assert.deepEqual(plain(contract.PATH_PARAMS), ["case", "device", "variant"])
  assert.deepEqual(plain(contract.PRIVATE_SEGMENTS), ["order", "review", "account"])
  assert.equal(contract.pathnameOf("/product/x/?case=signature#a"), "/product/x/")
})

test("contract re-exports paths, and paths.ts (the layout chunk's copy) holds only the private-path check", () => {
  assert.deepEqual(Object.keys(paths).sort(), ["PRIVATE_SEGMENTS", "isPrivatePath", "pathnameOf"])
  for (const name of Object.keys(paths)) assert.equal(contract[name], paths[name], name)
  for (const name of ["safePath", "landingParams", "PATH_PARAMS", "LANDING_PARAMS", "CLICK_KEYS"]) {
    assert.ok(contract[name], `${name} is contract's own, for the lazy chunks and the server`)
  }
})

test("event ids: uuid v4 for browser events, ic- for InitiateCheckout only", () => {
  for (const [name, id, expected] of vectors.event_ids) assert.equal(contract.isBrowserEventId(name, id), expected, `${name} ${id}`)
  assert.equal(contract.isBrowserEventId("PageView", 12), false)
  assert.equal(contract.isBrowserEventId("OrderConfirmed", UUID), false)
  assert.equal(contract.isVariantId(VARIANT), true)
  assert.equal(contract.isVariantId("variant_short"), false)
  assert.equal(contract.isVariantId("prod_01ABCDEFGHIJ"), false)
  assert.equal(contract.isVariantId(`variant_${"a".repeat(41)}`), false)
  assert.equal(contract.isVariantId(null), false)
})

test("every Appendix C event validates as expected and the good ones come back unchanged", () => {
  for (const vector of vectors.events) {
    const result = contract.validateEvent(vector.e)
    assert.equal(result !== null, vector.ok, vector.why || vector.e.n)
    if (vector.ok) {
      assert.deepEqual(plain(result), vector.e)
      assert.notEqual(result, vector.e, "a new object, never the input")
    }
  }
  assert.deepEqual(plain(contract.BROWSER_EVENTS), ["PageView", "ViewContent", "AddToCart", "InitiateCheckout"])
  assert.deepEqual(plain(contract.EVENT_LIMITS), { maxEventsPerBatch: 25, maxItems: 50, maxQty: 99, maxAmount: 1000000, maxString: 120, maxPath: 300 })
})

const addToCart = (d = {}, extra = {}) => ({
  n: "AddToCart", id: UUID, t: 1790467200000, p: "/product/x/?case=signature",
  d: { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT", ...d }, ...extra,
})

test("validateEvent drops unknown and empty keys but rejects bad known ones", () => {
  const kept = contract.validateEvent(addToCart({ handle: "zebra-stark", secret: "x", phone: "01712345678", device: null, first: true }))
  assert.deepEqual(plain(kept.d), { items: [{ id: VARIANT, q: 1, price: 1400 }], value: 1400, currency: "BDT", handle: "zebra-stark" })
  const item = contract.validateEvent(addToCart({ items: [{ id: VARIANT, q: 2, price: 0, name: "Zebra" }], value: 0 }))
  assert.deepEqual(plain(item.d.items), [{ id: VARIANT, q: 2, price: 0 }], "extra item keys are dropped")
  const pageView = contract.validateEvent({ n: "PageView", id: UUID, t: 1, p: "/shop/", d: { items: [], value: 3, first: false } })
  assert.deepEqual(plain(pageView), { n: "PageView", id: UUID, t: 1, p: "/shop/", d: { first: false } })
  assert.deepEqual(plain(contract.validateEvent({ n: "PageView", id: UUID, t: 1, p: "/", d: {} })), { n: "PageView", id: UUID, t: 1, p: "/" })

  assert.equal(contract.validateEvent(addToCart({ handle: "h".repeat(121) })), null, "a string over 120 chars")
  assert.ok(contract.validateEvent(addToCart({ handle: "h".repeat(120) })))
  assert.equal(contract.validateEvent(addToCart({ handle: 12 })), null)
  assert.equal(contract.validateEvent({ ...addToCart(), n: "ViewContent", d: { ...addToCart().d, primary: "yes" } }), null)
  assert.equal(contract.validateEvent({ ...addToCart(), n: "InitiateCheckout", id: "ic-0123456789abcdef01234567", d: { ...addToCart().d, num_items: 0 } }), null)
  assert.equal(contract.validateEvent(addToCart({ items: [{ id: VARIANT, q: 1.5, price: 1400 }] })), null)
  assert.equal(contract.validateEvent(addToCart({ items: [{ id: VARIANT, q: 0, price: 1400 }] })), null)
  assert.equal(contract.validateEvent(addToCart({ items: [{ id: VARIANT, q: 1, price: -1 }] })), null)
  assert.equal(contract.validateEvent(addToCart({ items: [{ id: VARIANT, q: 1, price: "1400" }] })), null)
  assert.equal(contract.validateEvent(addToCart({ value: 1000001 })), null)
  assert.equal(contract.validateEvent(addToCart({ value: undefined })), null)
  assert.equal(contract.validateEvent(addToCart({ currency: undefined })), null)
  const items = (count) => Array.from({ length: count }, () => ({ id: VARIANT, q: 1, price: 10 }))
  assert.ok(contract.validateEvent(addToCart({ items: items(50) })))
  assert.equal(contract.validateEvent(addToCart({ items: items(51) })), null)
  assert.equal(contract.validateEvent({ ...addToCart(), d: undefined }), null, "commerce events need items")
  assert.equal(contract.validateEvent({ ...addToCart(), d: [] }), null)
})

test("validateEvent checks the envelope: name, id, time and path", () => {
  for (const bad of [null, "x", [], 12]) assert.equal(contract.validateEvent(bad), null)
  assert.equal(contract.validateEvent(addToCart({}, { n: "Purchase" })), null)
  assert.equal(contract.validateEvent(addToCart({}, { id: "ic-0123456789abcdef01234567" })), null)
  for (const t of [0, -1, 1.5, "1790467200000", Number.NaN, 2 ** 60]) assert.equal(contract.validateEvent(addToCart({}, { t })), null, String(t))
  for (const p of ["//evil.example/", "/product/x/#top", "/product/x/?case=signature&fbclid=abc", "/product/x/?device=iPhone%2017",
    "/product/x/?", "/product/x/\\evil", "/product/ x/", "product/x/", "/men/order/x/", "/review", `/${"p".repeat(300)}`, 7]) {
    assert.equal(contract.validateEvent(addToCart({}, { p })), null, String(p))
  }
  assert.ok(contract.validateEvent(addToCart({}, { p: `/${"p".repeat(299)}` })))
  assert.ok(contract.validateEvent(addToCart({}, { p: "/men/product/x/?case=signature&device=iPhone+17&variant=variant_01ABCDEFGHIJ" })))
})

const purchase = (patch = {}) => ({
  event_id: "fl-1234", value: 2860, currency: "BDT", num_items: 2,
  contents: [{ id: VARIANT, quantity: 2, item_price: 1400 }],
  platforms: { meta: true, tiktok: false, google: false },
  match: { meta: { external_id: "202f3b44" }, tiktok: { external_id: "202f3b44" } },
  ...patch,
})

test("isPurchaseBlock accepts the checkout block with share off and on", () => {
  assert.equal(contract.isPurchaseBlock(purchase()), true)
  assert.equal(contract.isPurchaseBlock(purchase({ match: {} })), true)
  assert.equal(contract.isPurchaseBlock(purchase({ contents: [] })), true)
  assert.equal(contract.isPurchaseBlock(purchase({ platforms: { meta: true, tiktok: true, google: true }, match: {
    meta: { ph: "a", fn: "b", ln: "c", ct: "d", country: "e", external_id: "f" },
    tiktok: { phone_number: "a", external_id: "f" },
    google: { sha256_phone_number: "a", sha256_email_address: "b", address: { sha256_first_name: "c", country: "BD" } },
  } })), true)
})

test("isPurchaseBlock rejects the wrong currency, bad contents and ids that are not fl-", () => {
  for (const event_id of ["1234", "order_01ABC", "fl-", "fl-12a", "FL-1234", " fl-1234", 1234]) {
    assert.equal(contract.isPurchaseBlock(purchase({ event_id })), false, String(event_id))
  }
  for (const currency of ["bdt", "USD", undefined]) assert.equal(contract.isPurchaseBlock(purchase({ currency })), false, String(currency))
  for (const contents of [
    undefined, {}, [{ id: "prod_01ABCDEFGHIJ", quantity: 1, item_price: 1400 }], [{ id: VARIANT, quantity: 0, item_price: 1400 }],
    [{ id: VARIANT, quantity: 1.5, item_price: 1400 }], [{ id: VARIANT, quantity: 1 }], [{ id: VARIANT, quantity: 1, item_price: "1400" }],
    [{ id: VARIANT, quantity: 1, item_price: Number.POSITIVE_INFINITY }], [null],
  ]) assert.equal(contract.isPurchaseBlock(purchase({ contents })), false, JSON.stringify(contents))
  for (const value of ["2860", -1, Number.NaN, undefined]) assert.equal(contract.isPurchaseBlock(purchase({ value })), false, String(value))
  assert.equal(contract.isPurchaseBlock(purchase({ num_items: "2" })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ platforms: { meta: true, tiktok: false } })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ platforms: { meta: 1, tiktok: false, google: false } })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ match: undefined })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ match: { meta: { external_id: 5 } } })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ match: { tiktok: "x" } })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ match: { google: { address: { sha256_first_name: "c", country: "IN" } } } })), false)
  assert.equal(contract.isPurchaseBlock(purchase({ match: { google: { sha256_phone_number: 5 } } })), false)
  for (const bad of [null, undefined, "fl-1234", [], 5]) assert.equal(contract.isPurchaseBlock(bad), false)
})

test("the inert id response keeps the browser untracked", () => {
  const inert = { v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false, optout: false, share: false,
    consent_version: 1, landing: null, meta: null, tiktok: null, google: null }
  assert.deepEqual(plain(contract.inertIdResponse()), inert)
  assert.deepEqual(plain(contract.inertIdResponse(3)), { ...inert, consent_version: 3 })
  assert.notEqual(contract.inertIdResponse(), contract.inertIdResponse(), "a fresh object each time")
})
