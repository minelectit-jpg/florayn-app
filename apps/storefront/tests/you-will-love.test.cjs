const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function loadSource(relativePath) {
  const filename = path.join(__dirname, "../src", relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(
    source,
    {
      exports,
      console,
      require(name) {
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
        if (name === "next/link" || name === "@/components/audience-link") return { __esModule: true, default: (p) => p }
        if (name.startsWith("@/")) return { __esModule: true, default: name }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
    { filename }
  )
  return exports
}

const { youWillLoveHref } = loadSource("components/you-will-love.tsx")

test("carries the current model + case type so the card and the opened page match", () => {
  const item = { handle: "timeless", imageByDevice: { "iPhone 17 Pro Max": "img.jpg" } }
  assert.equal(
    youWillLoveHref(item, "iPhone 17 Pro Max", "Elite Clear"),
    "/product/timeless-iphone-17-pro-max/?case=elite-clear"
  )
})

test("appends the device only when this design actually sells it", () => {
  const item = { handle: "timeless", imageByDevice: {} } // not sold on the chosen device
  assert.equal(
    youWillLoveHref(item, "iPhone 14", "Signature"),
    "/product/timeless/?case=signature"
  )
})

test("still carries the case type when there is no device match", () => {
  const item = { handle: "amplitude", imageByDevice: {} }
  assert.equal(
    youWillLoveHref(item, undefined, "Armor Black"),
    "/product/amplitude/?case=armor-black"
  )
})

test("falls back to the plain product link when nothing is selected", () => {
  const item = { handle: "legends", imageByDevice: {} }
  assert.equal(youWillLoveHref(item, undefined, undefined), "/product/legends/")
})
