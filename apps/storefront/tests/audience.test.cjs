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
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] ?? require(name) })
  return exports
}
const audience = load("lib/audience.ts")

test("Women is the root and Men is the same site under /men", () => {
  assert.equal(audience.audienceFromPath("/"), "women")
  assert.equal(audience.audienceFromPath("/shop/iphone-17-pro-max/signature/"), "women")
  assert.equal(audience.audienceFromPath("/men"), "men")
  assert.equal(audience.audienceFromPath("/men/product/zebra-rust/"), "men")
  assert.equal(audience.audienceFromPath("/cart/"), null, "the cart exists once, for both")
  assert.equal(audience.audienceFromPath("/menu/"), null, "only the /men segment counts")
  assert.equal(audience.stripAudience("/men"), "/")
  assert.equal(audience.stripAudience("/men/collection/leopard/?device=x"), "/collection/leopard/?device=x")
})

test("admin links stay plain and pick up /men only where the page has a Men version", () => {
  const men = (href) => audience.withAudience(href, "men")
  assert.equal(men("/"), "/men/")
  assert.equal(men("/shop/iphone-17-pro-max/signature/"), "/men/shop/iphone-17-pro-max/signature/")
  assert.equal(men("/collection/card-wallets/?device=Card%20Wallet"), "/men/collection/card-wallets/?device=Card%20Wallet")
  assert.equal(men("/collections/"), "/men/collections/")
  assert.equal(men("/product/stickpad-pro/"), "/men/product/stickpad-pro/")
  assert.equal(men("/men/shop/x/"), "/men/shop/x/", "never doubled")
  for (const shared of ["/cart/", "/contact/", "/account", "/checkout", "https://florayn.com/", "//cdn.example/x", "mailto:a@b.c", "#top", "tel:+880"]) {
    assert.equal(men(shared), shared)
  }
  assert.equal(audience.withAudience("/men/product/x/", "women"), "/product/x/")
})

test("search has a Men page too, and keeps its query", () => {
  assert.equal(audience.withAudience("/search/?q=x", "men"), "/men/search/?q=x")
  assert.equal(audience.withAudience("/search/", "men"), "/men/search/")
  assert.equal(audience.withAudience("/men/search/?q=x", "women"), "/search/?q=x")
  assert.equal(audience.audienceFromPath("/search/"), "women")
  assert.equal(audience.audienceFromPath("/men/search/"), "men")
  assert.equal(audience.audienceFromPath("/searching/"), null, "only the /search segment counts")
  assert.equal(audience.withAudience("/searching/", "men"), "/searching/")
  assert.equal(audience.switchAudiencePath("/search/?q=leopard", "men"), "/men/search/?q=leopard")
  assert.equal(audience.switchAudiencePath("/men/search/?q=leopard", "women"), "/search/?q=leopard")
})

test("the switch opens the same page in the other mode, or its home from a shared page", () => {
  assert.equal(audience.switchAudiencePath("/shop/iphone-17-pro-max/signature/", "men"), "/men/shop/iphone-17-pro-max/signature/")
  assert.equal(audience.switchAudiencePath("/men/product/zebra-rust/?case=signature", "women"), "/product/zebra-rust/?case=signature")
  assert.equal(audience.switchAudiencePath("/", "men"), "/men/")
  assert.equal(audience.switchAudiencePath("/men/", "women"), "/")
  assert.equal(audience.switchAudiencePath("/contact/", "men"), "/men/")
  assert.equal(audience.switchAudiencePath("/cart/", "women"), "/")
})

test("an untagged or unknown product shows in both modes; a tagged one only in its own", () => {
  const items = [
    { id: "w", metadata: { audience: "women" } },
    { id: "m", metadata: { audience: "men" } },
    { id: "b", metadata: { audience: "both" } },
    { id: "u", metadata: {} },
    { id: "x", metadata: { audience: "kids" } },
    { id: "n" },
  ]
  assert.deepEqual(audience.forAudience(items, "women").map((i) => i.id), ["w", "b", "u", "x", "n"])
  assert.deepEqual(audience.forAudience(items, "men").map((i) => i.id), ["m", "b", "u", "x", "n"])
  assert.equal(audience.readAudienceTag({ audience: "kids" }), "both")
})

function toggle(pathname, variant = "pill") {
  const pushed = []
  const Toggle = load("components/audience-toggle.tsx", {
    "next/link": { __esModule: true, default: ({ prefetch, children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push: (to) => pushed.push(to) }) },
    "@/lib/audience": audience,
    "@/components/use-audience": { useAudience: () => audience.audienceFromPath(pathname) ?? "women", rememberAudience() {}, setSwitchingAudience() {} },
  }).default
  return renderToStaticMarkup(React.createElement(Toggle, { variant }))
}

test("the header switch links each option to the counterpart page and marks the live mode", () => {
  const html = toggle("/men/product/zebra-rust/")
  assert.match(html, /data-audience="men"/)
  assert.match(html, /href="\/product\/zebra-rust\/"[^>]*>Women</)
  assert.match(html, /href="\/men\/product\/zebra-rust\/" aria-current="true"[^>]*>Men</)
  assert.match(html, /aria-label="Shop for"/)
  assert.match(toggle("/", "tabs"), /fl-audience--tabs/)
  assert.match(toggle("/contact/"), /href="\/men\/"/)
})

test("a switch in flight dims the old page, points every link at the new mode, and always clears", () => {
  const filename = path.join(__dirname, "../src/components/use-audience.ts")
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const timers = []
  const document = { cookie: "", documentElement: { dataset: {} } }
  vm.runInNewContext(code, {
    exports, document,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: () => {},
    require(name) {
      if (name === "next/navigation") return { usePathname: () => "/shop/x/" }
      if (name === "react") return { useEffect() {}, useSyncExternalStore: (subscribe, get) => get() }
      if (name === "@/lib/audience") return audience
      throw new Error(name)
    },
  }, { filename })
  assert.equal(exports.useAudience(), "women", "the URL decides when nothing is switching")
  exports.setSwitchingAudience("men")
  assert.equal(document.documentElement.dataset.audienceSwitch, "men")
  assert.equal(exports.useAudience(), "men", "links already point at the chosen mode")
  assert.equal(timers.at(-1).ms, 12000, "a failed navigation cannot leave the page dimmed")
  timers.at(-1).fn()
  assert.equal(document.documentElement.dataset.audienceSwitch, undefined)
  assert.equal(exports.useAudience(), "women")
  exports.rememberAudience("men")
  assert.match(document.cookie, /fl_audience=men/)
})
