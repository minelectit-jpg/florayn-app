const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Render DragScroll with a minimal hook host: refs are plain objects and
// effects are collected so the slider logic can run against fake elements.
function render(props) {
  const refs = []
  const effects = []
  const react = {
    useRef: (initial) => { const ref = { current: initial }; refs.push(ref); return ref },
    useEffect: (fn) => effects.push(fn),
  }
  const filename = path.join(__dirname, "../src/components/drag-scroll.tsx")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const exports = {}
  const frames = []
  const observed = []
  const jsx = (type, p, key) => ({ type, props: p, key })
  vm.runInNewContext(code, {
    exports,
    document: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
    ResizeObserver: class { constructor(fn) { this.fn = fn } observe(el) { observed.push(el) } disconnect() {} },
    require(name) {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  const tree = exports.default(props)
  return { tree, refs, effects, frames, observed }
}

function fakeList(size) {
  const listeners = {}
  return { ...size, style: {}, addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener() {}, listeners }
}

test("a rail without the indicator is just the draggable list", () => {
  const { tree } = render({ className: "fl-pdp-rail", children: "cards", "aria-label": "Recommended" })
  assert.equal(tree.type, "ul")
  assert.equal(tree.props.className, "fl-pdp-rail")
  assert.equal(tree.props["aria-label"], "Recommended")
})

test("the indicator adds a decorative slider that follows the scroll position", () => {
  const { tree, refs, effects, frames, observed } = render({ className: "fl-more-designs", children: "tiles", indicator: true })
  assert.equal(tree.type, "Fragment")
  const [list, bar] = tree.props.children
  assert.equal(list.type, "ul")
  assert.equal(bar.props.className, "fl-scrollbar")
  assert.equal(bar.props["aria-hidden"], "true", "screen readers use the list itself")

  const [listRef, barRef, thumbRef] = refs
  listRef.current = fakeList({ scrollWidth: 1000, clientWidth: 250, scrollLeft: 0 })
  barRef.current = { clientWidth: 250, dataset: { hidden: "true" } }
  thumbRef.current = { style: {} }
  effects[1]()
  assert.equal(barRef.current.dataset.hidden, undefined, "shown when the rail overflows")
  assert.equal(thumbRef.current.style.width, "25%", "thumb width is the visible share")
  assert.equal(thumbRef.current.style.transform, "translateX(0px)")
  assert.deepEqual(observed, [listRef.current])

  // Scrolling halfway moves the thumb halfway along its track (one frame per burst).
  listRef.current.scrollLeft = 375
  listRef.current.listeners.scroll()
  listRef.current.listeners.scroll()
  assert.equal(frames.length, 1)
  frames[0]()
  assert.equal(thumbRef.current.style.transform, `translateX(${0.5 * 250 * 0.75}px)`)

  // When everything fits there is nothing to swipe to, so the bar hides.
  listRef.current.scrollWidth = 250
  listRef.current.listeners.scroll()
  frames[1]()
  assert.equal(barRef.current.dataset.hidden, "true")
})

test("a non-case accessory shows only its own Features blocks, never the case defaults", () => {
  const filename = path.join(__dirname, "../src/components/features-section.tsx")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" }
    throw new Error(`Unexpected dependency: ${name}`)
  } }, { filename })
  const Features = exports.default
  const blocks = [
    { id: "case", title: "Drop-tested protection", case_type: null },
    { id: "pad", title: "Sticks anywhere", case_type: "Sticky Pad" },
  ]
  const ids = (tree) => JSON.stringify(tree).match(/"key":"[^"]+"|Drop-tested|Sticks anywhere/g)
  assert.ok(ids(Features({ blocks, group: "Signature" })).includes("Drop-tested"), "a case falls back to the defaults")
  assert.equal(Features({ blocks, group: "Phone Charm", fallback: false }), null, "a charm with no blocks shows none")
  assert.deepEqual(ids(Features({ blocks, group: "Sticky Pad", fallback: false })), ["Sticks anywhere"])
})
