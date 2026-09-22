const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relative, dependencies = {}) {
  const filename = path.join(__dirname, "../src", relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: filename }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] ?? require(name) })
  return exports
}
const forms = load("lib/product-forms.ts")
const devices = [
  { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone" },
  { slug: "galaxy-s26", name: "Samsung S26", family: "samsung" },
  { slug: "airpods-pro-3", name: "AirPods Pro 3", family: "airpods" },
  { slug: "airpods-max", name: "AirPods Max", family: "airpods" },
  { slug: "watch", name: "Apple Watch Band", family: "watch" },
  { slug: "wallet", name: "Card Wallet", family: "wallet" },
  { slug: "new-family", name: "Future accessory", family: "future" },
]

for (const [slug, expected] of [
  [undefined, ["iphone-17-pro-max", "galaxy-s26"]],
  ["galaxy-s26", ["iphone-17-pro-max", "galaxy-s26"]],
  ["airpods-max", ["airpods-pro-3", "airpods-max"]],
  ["watch", ["watch"]], ["wallet", ["wallet"]], ["new-family", ["new-family"]],
]) {
  test(`shop model drawer stays within its form: ${slug ?? "default phone shop"}`, () => {
    let items
    const Component = load("components/shop-selectors.tsx", {
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "@/lib/product-forms": forms,
      "@/components/model-drawer": ({ items: value }) => { items = value; return null },
      "@/components/case-type-modal": () => null,
    }).default
    renderToStaticMarkup(React.createElement(Component, { deviceSlug: slug, devices, caseTypes: [] }))
    assert.deepEqual(Array.from(items, (item) => item.value), expected)
  })
}
