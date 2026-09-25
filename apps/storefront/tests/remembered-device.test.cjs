const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const filename = path.join(__dirname, "../src/lib/remembered-device.ts")
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
/** A fresh copy of lib/remembered-device.ts running against the given window. */
function load(window = {}) {
  const exports = {}
  vm.runInNewContext(code, { exports, window }, { filename })
  return exports
}
const { deviceFromPath } = load()

const SLUGS = ["iphone-15", "iphone-15-pro", "iphone-15-pro-max", "iphone-16", "airpods-pro-3", "airpods-pro-2", "samsung-s24-ultra"]

test("a product page's device is the longest slug its handle ends with, in both modes", () => {
  assert.equal(deviceFromPath("/men/product/leopard-iphone-15-pro-max/", SLUGS), "iphone-15-pro-max")
  assert.equal(deviceFromPath("/product/leopard-iphone-15-pro-max/", SLUGS), "iphone-15-pro-max")
  assert.equal(deviceFromPath("/product/leopard-iphone-15/", SLUGS), "iphone-15")
  assert.equal(deviceFromPath("/product/leopard/", SLUGS), null, "a design page has no device")
  assert.equal(deviceFromPath("/product/leopard-iphone-15-pro-max", SLUGS), "iphone-15-pro-max", "no trailing slash")
})

test("a shop page's device is its first segment when it is a real device", () => {
  assert.equal(deviceFromPath("/shop/airpods-pro-3/signature-earbuds/", SLUGS), "airpods-pro-3")
  assert.equal(deviceFromPath("/men/shop/iphone-16/", SLUGS), "iphone-16")
  assert.equal(deviceFromPath("/shop/iphone-99/", SLUGS), null, "an unknown slug is never remembered")
  assert.equal(deviceFromPath("/shop/", SLUGS), null)
})

test("every other page has no device", () => {
  for (const page of ["/cart/", "/", "/men/", "/collection/leopard/", "/search/", "/account/", "/menu/shop/iphone-16/"]) {
    assert.equal(deviceFromPath(page, SLUGS), null, page)
  }
})

/* The header's device tuples ([slug, name, family, badge]), every form. */
const DEVICES = [
  ["iphone-15", "iPhone 15", "iphone", null], ["iphone-15-pro-max", "iPhone 15 Pro Max", "iphone", null], ["samsung-s24-ultra", "Samsung S24 Ultra", "samsung", null],
  ["airpods-pro-3", "AirPods Pro 3", "airpods", "New"], ["apple-watch-band", "Apple Watch Band", "watch", null],
  ["card-wallet", "Card Wallet", "wallet", null], ["magsafe-wallet", "MagSafe Wallet", "wallet", null],
]
const plain = (value) => JSON.parse(JSON.stringify(value))

test("only phones are remembered: AirPods, watch band and wallet pages leave the phone alone", () => {
  const { phoneSlugs, isPhoneFamily } = load()
  assert.deepEqual(plain(phoneSlugs(DEVICES)), ["iphone-15", "iphone-15-pro-max", "samsung-s24-ultra"])
  assert.ok(isPhoneFamily("iphone") && isPhoneFamily("samsung"))
  assert.ok(!["airpods", "watch", "wallet", undefined].some(isPhoneFamily))

  // What the shell's pathname effect does: deviceFromPath over the phone slugs only.
  const store = new Map([["fl_device", "iphone-15"]])
  const lib = load({ localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } })
  const visit = (page) => {
    const slug = lib.deviceFromPath(page, lib.phoneSlugs(DEVICES))
    if (slug) lib.rememberDevice(slug)
  }
  for (const page of ["/shop/airpods-pro-3/signature-earbuds/", "/product/leopard-apple-watch-band/", "/men/shop/card-wallet/", "/product/stripes-magsafe-wallet/"]) {
    visit(page)
    assert.equal(store.get("fl_device"), "iphone-15", page)
  }
  visit("/product/leopard-iphone-15-pro-max/")
  assert.equal(store.get("fl_device"), "iphone-15-pro-max", "a phone page still remembers its phone")
  assert.equal(lib.deviceFromPath("/shop/airpods-pro-3/", DEVICES.map((d) => d[0])), "airpods-pro-3", "the page's own device (the menu's current row) is still every form")
})

test("a stored AirPods, watch or wallet slug reads as no phone", () => {
  const { phoneOf } = load()
  assert.deepEqual(plain(phoneOf("samsung-s24-ultra", DEVICES)), ["samsung-s24-ultra", "Samsung S24 Ultra", "samsung", null])
  for (const slug of ["airpods-pro-3", "apple-watch-band", "card-wallet", "iphone-99", null, ""]) assert.equal(phoneOf(slug, DEVICES), null, String(slug))
})

test("the phone is kept in this browser only, and blocked storage never throws", () => {
  const store = new Map()
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  const lib = load({ localStorage })
  assert.equal(lib.readDevice(), null)
  lib.rememberDevice("iphone-15-pro-max")
  assert.equal(store.get("fl_device"), "iphone-15-pro-max")
  assert.equal(lib.readDevice(), "iphone-15-pro-max")
  store.set("fl_device", "<script>")
  assert.equal(lib.readDevice(), null, "a tampered value is ignored")
  lib.forgetDevice()
  assert.equal(store.has("fl_device"), false)

  const blocked = load({ get localStorage() { throw new Error("SecurityError") } })
  assert.equal(blocked.readDevice(), null)
  assert.doesNotThrow(() => blocked.rememberDevice("iphone-16"))
  assert.doesNotThrow(() => blocked.forgetDevice())
})
