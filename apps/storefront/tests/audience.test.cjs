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
    "@/components/use-audience": { useAudience: () => audience.audienceFromPath(pathname) ?? "women", rememberAudience() {} },
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
