const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const src = path.join(__dirname, "../src")
/**
 * Load components/product-view.tsx for its pure query rule. Its component
 * imports (gallery, buy box, strips…) are stubbed: the rule only needs
 * lib/variant-matrix's pairKey, which loads for real.
 */
function load() {
  const cache = new Map()
  function one(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: filename }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, { exports, URL, URLSearchParams, process: { env: {} }, require(dep) {
      if (dep === "@/lib/variant-matrix") return one(path.join(src, "lib/variant-matrix.ts"))
      if (dep.startsWith("@/") || dep.startsWith(".")) return { __esModule: true, default: () => null }
      return require(dep)
    } }, { filename })
    return exports
  }
  return one(path.join(src, "components/product-view.tsx"))
}

const { pickFromQuery } = load()
const { pairKey } = (() => {
  const filename = path.join(src, "lib/variant-matrix.ts")
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require() { return {} } })
  return exports
})()
const plain = (value) => JSON.parse(JSON.stringify(value))

/*
 * game-night, as on the live store: Signature leaves out the Plus models that
 * Elite Clear sells, so iPhone 16 Plus is sold in Elite Clear only.
 */
const sold = {
  Signature: ["iPhone 16", "iPhone 17"],
  "Elite Clear": ["iPhone 16 Plus", "iPhone 16", "iPhone 17"],
}
const matrix = {
  caseTypes: Object.keys(sold),
  devices: ["iPhone 17", "iPhone 16 Plus", "iPhone 16"],
  devicesByCaseType: sold,
  caseTypesByDevice: {},
  variantIdByPair: {},
}
for (const [caseType, devices] of Object.entries(sold)) {
  for (const device of devices) {
    ;(matrix.caseTypesByDevice[device] ??= []).push(caseType)
    matrix.variantIdByPair[pairKey(caseType, device)] = `variant_${caseType}_${device}`.replace(/\s+/g, "_")
  }
}
const records = [{ slug: "signature", name: "Signature" }, { slug: "elite-clear", name: "Elite Clear" }]
const pick = (search, current, devicePage) => plain(pickFromQuery(search, matrix, records, current, devicePage))

test("on a device page, ?case= for a case type that phone is not sold in is ignored, never a phone swap", () => {
  // /product/game-night-iphone-16-plus/?case=signature (a search or menu link).
  assert.equal(pick("?case=signature", { caseType: "Elite Clear", device: "iPhone 16 Plus" }, true), null)
})

test("on a device page, ?case= for a case type that phone is sold in picks it on the same phone", () => {
  assert.deepEqual(pick("?case=elite-clear", { caseType: "Signature", device: "iPhone 16" }, true), { caseType: "Elite Clear", device: "iPhone 16" })
  assert.deepEqual(pick("?case=signature", { caseType: "Elite Clear", device: "iPhone 17" }, true), { caseType: "Signature", device: "iPhone 17" })
})

test("on the design page, ?case= still moves to a device that case type is sold for", () => {
  assert.deepEqual(pick("?case=signature", { caseType: "Elite Clear", device: "iPhone 16 Plus" }, false), { caseType: "Signature", device: "iPhone 16" })
  assert.deepEqual(pick("?case=elite-clear", { caseType: "Signature", device: "iPhone 17" }, false), { caseType: "Elite Clear", device: "iPhone 17" })
})

test("?variant= and ?device= (links from the admin) keep working, with a case type sold for that model", () => {
  assert.deepEqual(pick("?variant=variant_Signature_iPhone_17", { caseType: "Elite Clear", device: "iPhone 16 Plus" }, true), { caseType: "Signature", device: "iPhone 17" })
  assert.deepEqual(pick("?device=iphone-16-plus&case=signature", { caseType: "Signature", device: "iPhone 16" }, false), { caseType: "Elite Clear", device: "iPhone 16 Plus" })
  assert.deepEqual(pick("?device=iPhone%2016&case=signature", { caseType: "Elite Clear", device: "iPhone 17" }, false), { caseType: "Signature", device: "iPhone 16" })
})

test("an unknown or missing ?case= changes nothing", () => {
  assert.equal(pick("?case=armor-black", { caseType: "Signature", device: "iPhone 16" }, false), null)
  assert.equal(pick("", { caseType: "Signature", device: "iPhone 16" }, true), null)
  assert.equal(pick("?variant=gone", { caseType: "Signature", device: "iPhone 16" }, true), null)
})

test("the page decides it is a device page from the device its URL names", () => {
  const view = fs.readFileSync(path.join(src, "components/product-view.tsx"), "utf8")
  assert.match(view, /const devicePage = !!deviceName && deviceName === initialDevice/)
  assert.match(view, /pickFromQuery\(window\.location\.search, matrix, caseTypeRecords, \{ caseType, device \}, devicePage\)/)
  const page = fs.readFileSync(path.join(src, "components/pages/product-page.tsx"), "utf8")
  assert.match(page, /deviceName=\{device\?\.name \?\? null\}/, "the product page passes the path's device")
})
