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
        if (name === "next/link") return { __esModule: true, default: (p) => ({ __link: true, props: p }) }
        if (name.startsWith("@/")) return { __esModule: true, default: name }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
    { filename }
  )
  return exports
}

const { MoreDesigns } = loadSource("components/product-sections.tsx")

function findNode(node, pred) {
  if (!node || typeof node !== "object") return null
  if (pred(node)) return node
  const kids = node.props?.children
  const arr = Array.isArray(kids) ? kids : kids != null ? [kids] : []
  for (const k of arr) {
    const found = findNode(k, pred)
    if (found) return found
  }
  return null
}

const items = [
  { id: "1", title: "Legends", handle: "legends", label: "Legends", thumbnail: "l.jpg", imageByDevice: {}, imageByPair: {} },
]

test("MoreDesigns renders the current design as a highlighted, non-link tile", () => {
  const tree = MoreDesigns({
    items,
    device: "iPhone 17 Pro Max",
    caseType: "Armor Clear",
    currentName: "Timeless",
    currentImage: "timeless.jpg",
  })
  const current = findNode(tree, (n) => n?.props?.["aria-current"] === "true")
  assert.ok(current, "current design tile is rendered")
  assert.equal(current.type, "div", "the current tile is a plain div, not a link")
  assert.match(current.props.className, /border-purple/)
  const img = findNode(current, (n) => n?.props?.src === "timeless.jpg")
  assert.ok(img, "the current tile shows the current design image")
})

test("MoreDesigns without a current design renders no highlighted tile", () => {
  const tree = MoreDesigns({ items, device: "iPhone 17 Pro Max", caseType: "Armor Clear" })
  assert.equal(findNode(tree, (n) => n?.props?.["aria-current"] === "true"), null)
})

test("MoreDesigns returns nothing when there are neither others nor a current design", () => {
  assert.equal(MoreDesigns({ items: [] }), null)
})
