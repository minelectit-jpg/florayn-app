const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Render the real component tree with a minimal hook host; child components
// stay as named placeholders so their props can be inspected directly.
function host() {
  const slots = []
  let cursor = 0
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next }]
    },
  }
  return { react, reset: () => { cursor = 0 } }
}
function load(react) {
  const filename = path.join(__dirname, "../src/components/recommended-for-you.tsx")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const exports = {}
  const jsx = (type, props, key) => ({ type, props, key })
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" }
    if (name === "next/link") return { __esModule: true, default: "Link" }
    if (name.startsWith("@/components/")) return { __esModule: true, default: name }
    throw new Error(`Unexpected dependency: ${name}`)
  } }, { filename })
  return exports.default
}
// Expand function components (the card) but keep placeholders (strings).
function expand(node, reset) {
  if (Array.isArray(node)) return node.map((n) => expand(n, reset))
  if (!node || typeof node !== "object") return node
  if (typeof node.type === "function") { reset?.(); return expand(node.type(node.props), reset) }
  return { ...node, props: { ...node.props, children: expand(node.props?.children, reset) } }
}
function find(node, match, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => find(n, match, out)); return out }
  if (!node || typeof node !== "object") return out
  if (match(node)) out.push(node)
  find(node.props?.children, match, out)
  return out
}

const airpods = {
  id: "bloom-airpods", name: "Bloom", handle: "bloom-airpods", formLabel: "AirPods Case", price: 750,
  variants: [
    { id: "v-pro3", label: "AirPods Pro 3", price: 750, image: "pro3.webp", href: "/product/bloom-airpods-airpods-pro-3/?case=signature-earbuds", caseType: "Signature Earbuds" },
    { id: "v-4", label: "AirPods 4", price: 800, image: "four.webp", href: "/product/bloom-airpods-airpods-4/?case=signature-earbuds", caseType: "Signature Earbuds" },
  ],
}
const picked = { id: "picked", name: "Timeless", handle: "timeless", formLabel: "Signature / iPhone 17 Pro Max", price: 1400,
  variants: [{ id: "variant_a", label: "Signature / iPhone 17 Pro Max", price: 1400, image: "a.webp", href: "/product/timeless/?variant=variant_a" }] }

test("one recommendation is one big shop card; its model picker moves image, price, link and cart item together", () => {
  const { react, reset } = host()
  const Recommended = load(react)
  const render = () => { reset(); return expand(Recommended({ items: [airpods] }), null) }
  let tree = render()
  const rail = find(tree, (n) => n.type === "@/components/drag-scroll")[0]
  assert.match(rail.props.className, /fl-pdp-rail is-single/)
  const card = () => find(tree, (n) => n.type === "article")[0]
  assert.match(card().props.className, /fl-card/)
  const state = () => ({
    href: find(card(), (n) => n.type === "Link")[0].props.href,
    add: find(card(), (n) => n.type === "@/components/quick-add")[0].props,
    image: find(card(), (n) => n.type === "@/components/product-image")[0].props,
  })
  let s = state()
  assert.equal(s.href, airpods.variants[0].href)
  assert.equal(s.add.variantId, "v-pro3"); assert.equal(s.add.unitPrice, 750); assert.equal(s.image.src, "pro3.webp")
  assert.match(s.image.sizes, /calc\(100vw - 30px\)/, "a single card downloads a full-width image")
  // The stretched link wraps nothing: no button ever sits inside it.
  assert.equal(find(card(), (n) => n.type === "Link")[0].props.children, undefined)
  const drawer = find(card(), (n) => n.type === "@/components/model-drawer")[0]
  drawer.props.onSelect("v-4")
  tree = render()
  s = state()
  assert.equal(s.href, airpods.variants[1].href)
  assert.equal(s.add.variantId, "v-4"); assert.equal(s.add.unitPrice, 800); assert.equal(s.image.src, "four.webp")
  assert.equal(s.add.variantTitle, "Signature Earbuds / AirPods 4")
})

test("two or more recommendations sit two to a phone screen; owner picks keep their exact variant link", () => {
  const { react, reset } = host()
  const Recommended = load(react)
  reset()
  const tree = expand(Recommended({ items: [picked, airpods], title: "We think you’ll love" }), null)
  const rail = find(tree, (n) => n.type === "@/components/drag-scroll")[0]
  assert.equal(rail.props.className, "fl-pdp-rail")
  const [first] = find(tree, (n) => n.type === "article")
  assert.equal(find(first, (n) => n.type === "Link")[0].props.href, "/product/timeless/?variant=variant_a")
  assert.equal(find(first, (n) => n.type === "@/components/model-drawer").length, 0, "one variant needs no picker")
  assert.match(find(first, (n) => n.type === "@/components/product-image")[0].props.sizes, /calc\(50vw - 20px\)/)
  assert.equal(Recommended({ items: [] }), null)
})
