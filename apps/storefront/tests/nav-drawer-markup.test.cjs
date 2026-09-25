const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

const src = path.join(__dirname, "../src")
/**
 * Load a storefront file and its "@/…" / "./…" imports, transpiled; `stubs`
 * replace modules by name (next/*, the shell's pieces, a patched react).
 */
function load(relative, stubs = {}) {
  const cache = new Map()
  function one(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: filename }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, { exports, URL, Intl, process: { env: {} }, require(dep) {
      if (dep in stubs) return stubs[dep]
      const base = dep.startsWith("@/") ? path.join(src, dep.slice(2)) : dep.startsWith(".") ? path.resolve(path.dirname(filename), dep) : null
      if (!base) return require(dep)
      const file = [".ts", ".tsx"].map((ext) => base + ext).find((f) => fs.existsSync(f))
      if (!file) throw new Error(`Cannot find ${dep}`)
      return one(file)
    } }, { filename })
    return exports
  }
  return one(path.join(src, relative))
}

const { withAudience } = load("lib/audience.ts")
const { sortNewestFirst } = load("lib/device-order.ts")

/*
 * Static markup only shows the first level, with no remembered phone (both
 * need effects or clicks). A patched useState seeds the drawer's own state
 * instead: the level stack ({ session, stack, leaving }), the filters ({})
 * and the remembered slug (null). Everything else renders for real.
 */
function render(props, { nav, queries, remembered = null, audience = "women" } = {}) {
  const patchedReact = {
    ...React,
    useState(initial) {
      const value = typeof initial === "function" ? initial() : initial
      if (nav && value && typeof value === "object" && "stack" in value) return [nav, () => {}]
      if (queries && value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return [queries, () => {}]
      if (value === null) return [remembered, () => {}]
      return React.useState(initial)
    },
  }
  const IntentLink = ({ href, children, className, ...rest }) =>
    React.createElement("a", { href: withAudience(href, audience), className, "aria-current": rest["aria-current"] }, children)
  const NavDrawer = load("components/header/nav-drawer.tsx", {
    react: patchedReact,
    "next/navigation": { useRouter: () => ({ push() {}, prefetch() {} }), usePathname: () => props.pathname },
    "next/image": { __esModule: true, default: ({ src, sizes, loading, className }) => React.createElement("img", { src, sizes, loading, className, alt: "" }) },
    "@/components/header/intent-link": { __esModule: true, default: IntentLink },
    "@/components/audience-toggle": { __esModule: true, default: ({ variant }) => React.createElement("nav", { "data-toggle": variant }, "WOMEN MEN") },
  }).default
  return renderToStaticMarkup(React.createElement(NavDrawer, { onNavigate() {}, openCount: 1, audience, ...props }))
}

/** Every <button> and <a>, in order: neither may open inside the other. */
function assertNoNestedControls(html) {
  const open = []
  for (const [, close, tag] of html.matchAll(/<(\/?)(a|button)\b[^>]*>/g)) {
    if (close) {
      assert.equal(open.pop(), tag, "controls close in order")
      continue
    }
    assert.equal(open.length, 0, `<${tag}> inside <${open[open.length - 1]}>`)
    open.push(tag)
  }
  assert.equal(open.length, 0)
}

const hrefs = (html) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1])
const rows = (html) => [...html.matchAll(/<a [^>]*href="\/(?:men\/)?shop\/[^"]*"[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1])

/* ---------------------------------------------------------------- Data */

const seed = [
  ...["13", "13 Pro", "14", "14 Plus", "15", "15 Plus", "15 Pro", "15 Pro Max", "16", "16 Pro", "16 Pro Max", "17", "17 Air", "17 Pro", "17 Pro Max"]
    .map((n) => [`iphone-${n.toLowerCase().replace(/ /g, "-")}`, `iPhone ${n}`, "iphone"]),
  ...["S25", "S25 Ultra", "S26", "S26 Ultra"].map((n) => [`samsung-${n.toLowerCase().replace(/ /g, "-")}`, `Samsung ${n}`, "samsung"]),
  ["airpods-4", "AirPods 4", "airpods"], ["airpods-pro-3", "AirPods Pro 3", "airpods"], ["airpods-max", "AirPods Max", "airpods"],
  ["apple-watch-band", "Apple Watch Band", "watch"],
]
const devices = sortNewestFirst(seed, (d) => d[1], (d) => d[2]).map(([slug, name, family]) => [slug, name, family, slug === "iphone-17-pro-max" ? "New" : null])
const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"
const section = (id, label, extra = {}) => ({ id, label, href: null, kind: "links", image: null, badge: null, placement: "all", config: null, groups: [], ...extra })
const data = {
  women: [
    section("phone", "Phone Case", { kind: "devices", href: "/shop/", image: `${R2}/site/menu/phone.webp`, badge: "New", config: { families: ["iphone", "samsung"], case_type: "signature" } }),
    section("earbuds", "Earbuds", { kind: "devices", href: "/shop/airpods-pro-3/", config: { families: ["airpods"], case_type: "signature-earbuds" } }),
    section("watch", "Watch", { kind: "devices", config: { families: ["watch"], case_type: null } }),
    section("styles", "Styles", { kind: "case_types", config: { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/" } } }),
    section("collections", "Collections", { kind: "collections", placement: "drawer", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }),
    section("desk", "Desk only", { href: "/shop/desk/", placement: "bar" }),
    section("accessories", "Accessories", { href: "/shop/accessories/", groups: [{ heading: "Charms", links: [{ label: "Phone Charm", href: "/product/phone-charm/", badge: "New" }] }, { heading: null, links: [] }] }),
    section("sale", "Sale", { href: "/collection/sale/" }),
  ],
  men: null,
  devices,
  caseTypes: [
    ["signature", "Signature", 950, `${R2}/site/case-types/signature-9a3de988.jpg`, ["phone"], [950]],
    // The seed's Alcantara: 3800 for phones, 1900 for the card wallet (its overall lowest).
    ["alcantara", "Alcantara", 1900, `${R2}/site/case-types/alcantara-d3190c32.jpg`, ["phone", "airpods", "watch", "wallet"], [3800, 2100, 2200, 1900]],
    ["signature-earbuds", "Signature Earbuds", 750, null, ["airpods"], [750]],
  ],
  collections: [["leopard", "Leopard", `${R2}/c/leopard.jpg`, 0, 3], ["floral", "Floral", `${R2}/c/floral.webp`, 1, 1], ["cars", "Cars", null, 0, 2]],
  families: { iphone: "iPhone", samsung: "Samsung Galaxy", airpods: "AirPods", watch: "Apple Watch", wallet: "Card Wallet" },
  drawerLinks: [{ label: "My account", href: "/account/" }, { label: "Help & contact", href: "/contact/" }, { label: "Size guide", href: "/size-guide/" }],
  rememberDevice: true,
  search: { placeholder: "Search designs or models", suggest: { women: [], men: [] }, help: { label: "Can't find your model? Message us", href: "/contact/" } },
}

const menu = { key: "1/menu", level: { type: "menu" }, back: "", opener: null }
const at = (level, back = "Menu", opener = "section:phone") => ({ session: 1, stack: [menu, { key: "1/1", level, back, opener }], leaving: null })

/* ---------------------------------------------------------------- Tests */

test("the first level: the mode tabs, the drawer's sections in order, the bottom links", () => {
  const html = render({ data, pathname: "/" })
  assertNoNestedControls(html)
  assert.match(html, /<h2 tabindex="-1" class="sr-only">Menu<\/h2><nav data-toggle="tabs">/)
  assert.doesNotMatch(html, /Your phone/, "no remembered phone")
  assert.doesNotMatch(html, /Desk only/, "a desktop-only section stays off the phone menu")
  const labels = [...html.matchAll(/<span class="text-\[15px\] font-medium">([^<]*)<\/span>/g)].map((m) => m[1])
  assert.deepEqual(labels, ["Phone Case", "Earbuds", "Watch", "Styles", "Accessories", "Sale"])
  // Drill rows are buttons with a chevron; a single device and a plain link are links.
  assert.match(html, /<button type="button" data-nav-key="section:phone"[^>]*>.*?Phone Case<\/span><span class="[^"]*bg-purple[^"]*">New<\/span><svg/)
  assert.match(html, /<button type="button" data-nav-key="section:earbuds"/)
  assert.match(html, /<a href="\/shop\/apple-watch-band\/"[^>]*>.*?Watch<\/span><\/a>/)
  assert.match(html, /<a href="\/collection\/sale\/"/)
  assert.match(html, /<img src="https:\/\/pub-[^"]*\/site\/menu\/phone.webp" sizes="52px" loading="lazy" class="object-contain p-1"/)
  assert.match(html, />E<\/span><\/span><span class="text-\[15px\] font-medium">Earbuds/, "no picture: the first letter")
  // Collections: Women's two, campaign pictures cropped, product art contained.
  assert.match(html, /<ul data-hscroll="true"/)
  assert.deepEqual(hrefs(html).filter((h) => h.startsWith("/collection")), ["/collection/leopard/", "/collection/floral/", "/collection/sale/"])
  assert.match(html, /<button type="button" data-nav-key="collections:collections"[^>]*>View all<svg/, "View all opens the list inside the menu")
  assert.match(html, /leopard.jpg" sizes="104px" loading="lazy" class="object-cover"/)
  assert.match(html, /floral.webp" sizes="104px" loading="lazy" class="object-contain p-2"/)
  assert.deepEqual(hrefs(html).slice(-3), ["/account/", "/contact/", "/size-guide/"])
})

test("no Your phone card, even when the shopper's phone is remembered", () => {
  const html = render({ data, pathname: "/" }, { remembered: "iphone-15" })
  assertNoNestedControls(html)
  assert.doesNotMatch(html, /Your phone|Change phone|data-nav-key="your-phone"/)
  assert.match(html, /<h2 tabindex="-1" class="sr-only">Menu<\/h2><nav data-toggle="tabs">WOMEN MEN<\/nav><div class="pt-2">/, "the tabs, then the sections")
})

test("Men mode: shop and collection links get /men, shared pages do not", () => {
  const html = render({ data, pathname: "/men/", audience: "men" }, { audience: "men", remembered: "iphone-15" })
  const links = hrefs(html)
  assert.ok(links.includes("/men/shop/apple-watch-band/"))
  assert.ok(links.includes("/men/collection/leopard/"))
  assert.ok(links.includes("/men/collection/cars/"), "Men's collections")
  assert.ok(!links.includes("/men/collection/floral/"), "a Women-only collection is left out")
  assert.ok(links.includes("/account/") && links.includes("/contact/"))
  assert.ok(!links.some((h) => h.startsWith("/men/account") || h.startsWith("/men/contact")))
})

test("brands: Back, the heading, the filter, Shop all, then each brand with its model count", () => {
  const html = render({ data, pathname: "/" }, { nav: at({ type: "brands", section: "phone" }) })
  assertNoNestedControls(html)
  assert.match(html, /<button type="button" class="[^"]*"><svg[^>]*>.*?<\/svg><span class="[^"]*"><span class="sr-only">Back to <\/span>Menu<\/span><\/button>/)
  assert.match(html, /<h2 tabindex="-1" class="px-4 pb-1 pt-4 text-\[20px\] font-semibold[^"]*">Phone Case<\/h2>/)
  assert.match(html, /<input type="search" placeholder="Find your model" aria-label="Find your model" enterKeyHint="go" autoComplete="off"[^>]* class="h-11 w-full rounded-full bg-field px-4 text-\[16px\][^"]*" value=""\/>/)
  assert.doesNotMatch(html, /autofocus/i, "no keyboard over the list on phones")
  assert.match(html, /<a href="\/shop\/"[^>]*>Shop all Phone Case/)
  const brands = [...html.matchAll(/data-nav-key="family:(\w+)".*?text-\[16px\] font-medium">([^<]*)<.*?text-\[13px\] text-ink-muted">([^<]*)</g)].map((m) => [m[1], m[2], m[3]])
  assert.deepEqual(brands, [["iphone", "iPhone", "15 models"], ["samsung", "Samsung Galaxy", "4 models"]])
})

test("brands filter: a flat list across the brands, grouped by brand", () => {
  const nav = at({ type: "brands", section: "phone" })
  const html = render({ data, pathname: "/" }, { nav, queries: { "1/1": "ultra" } })
  assertNoNestedControls(html)
  assert.deepEqual(rows(html), ["Samsung S26 Ultra", "Samsung S25 Ultra"])
  assert.match(html, /<h3[^>]*>Samsung Galaxy<\/h3>/)
  assert.doesNotMatch(html, /data-nav-key="family:/, "brand rows give way to the results")
  const none = render({ data, pathname: "/" }, { nav, queries: { "1/1": "pixel 9" } })
  assert.match(none, /No model matches “pixel 9”\. Try <span>“17 Pro Max”<\/span><span> or “S26 Ultra”<\/span>\./)
  assert.match(none, /<a href="\/contact\/"[^>]*>Can(?:&#x27;|')t find your model\? Message us/)
})

test("models: newest first under series heads, the shopper's phone never pulled to the top or tagged, the current page marked", () => {
  const nav = at({ type: "models", family: "iphone", section: "phone", shopAll: false }, "Phone Case", "family:iphone")
  const html = render({ data, pathname: "/shop/iphone-16-pro/signature/" }, { nav, remembered: "iphone-15" })
  assertNoNestedControls(html)
  assert.match(html, /<span class="sr-only">Back to <\/span>Phone Case/)
  assert.match(html, />iPhone<span class="ml-2 text-\[13px\] font-normal text-ink-muted">15 models<\/span><\/h2>/)
  assert.match(html, /placeholder="Search iPhone models"/)
  assert.deepEqual(rows(html), [
    "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air", "iPhone 17",
    "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16",
    "iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15 Plus", "iPhone 15",
    "iPhone 14 Plus", "iPhone 14", "iPhone 13 Pro", "iPhone 13",
  ])
  assert.match(html, /<a href="\/shop\/iphone-15\/signature\/"[^>]*><span>iPhone 15<\/span><\/a>/, "the remembered phone is a plain row in its place")
  assert.doesNotMatch(html, /Your phone/)
  const heads = [...html.matchAll(/<h3[^>]*>([^<]*series)<\/h3>/g)].map((m) => m[1])
  assert.deepEqual(heads, ["iPhone 17 series", "iPhone 16 series", "iPhone 15 series", "iPhone 14 series", "iPhone 13 series"])
  assert.match(html, /<a href="\/shop\/iphone-16-pro\/signature\/" class="[^"]*font-semibold[^"]*" aria-current="page">/)
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1)
  assert.match(html, /<a href="\/shop\/iphone-17-pro-max\/signature\/"[^>]*><span>iPhone 17 Pro Max<\/span><span class="[^"]*bg-purple[^"]*">New<\/span>/)
})

test("models filter: shortcuts find the model, and no match offers help", () => {
  const nav = at({ type: "models", family: "iphone", section: "phone", shopAll: false }, "Phone Case", "family:iphone")
  assert.deepEqual(rows(render({ data, pathname: "/" }, { nav, queries: { "1/1": "15pm" } })), ["iPhone 15 Pro Max"])
  assert.deepEqual(rows(render({ data, pathname: "/" }, { nav, queries: { "1/1": "১৭ pro" } })), ["iPhone 17 Pro Max", "iPhone 17 Pro"])
  const none = render({ data, pathname: "/" }, { nav, queries: { "1/1": "12 mini" } })
  assert.match(none, /No model matches “12 mini”\. Try <span>“17 Pro Max”<\/span><span> or “16 Pro Max”<\/span>\./)
  assert.ok(hrefs(none).includes("/contact/"))
})

test("Earbuds opens the AirPods list directly: flat, with Shop all, on the earbuds case type", () => {
  const nav = at({ type: "models", family: "airpods", section: "earbuds", shopAll: true }, "Menu", "section:earbuds")
  const html = render({ data, pathname: "/" }, { nav })
  assertNoNestedControls(html)
  assert.match(html, /Back to <\/span>Menu/)
  assert.doesNotMatch(html, /series<\/h3>/)
  assert.match(html, /<a href="\/shop\/airpods-pro-3\/"[^>]*>Shop all Earbuds/)
  assert.deepEqual(rows(html), ["AirPods 4", "AirPods Pro 3", "AirPods Max"])
  assert.ok(hrefs(html).includes("/shop/airpods-pro-3/signature-earbuds/"))
})

test("styles: round pictures, from-prices for the section's form and the Alcantara override", () => {
  const html = render({ data, pathname: "/" }, { nav: at({ type: "styles", section: "styles" }, "Menu", "section:styles"), remembered: "samsung-s26" })
  assertNoNestedControls(html)
  assert.match(html, /<a href="\/shop\/samsung-s26\/signature\/"[^>]*>.*?sizes="44px" loading="lazy" class="object-cover".*?Signature<\/span><span class="block text-\[13px\] text-ink-muted">from ৳950<\/span>/)
  assert.match(html, /<a href="\/collection\/alcantara\/"[^>]*>.*?Alcantara<\/span><span[^>]*>from ৳3,800<\/span>/, "a phone Alcantara costs 3800")
  assert.doesNotMatch(html, /৳1,900/, "never the card wallet's price in a phone section")
  assert.doesNotMatch(html, /Signature Earbuds/, "an earbuds style is not a phone style")

  const earbudStyles = { ...data, women: [...data.women, section("buds-styles", "Earbud styles", { kind: "case_types", config: { form: "airpods", exclude: [], links: {} } })] }
  const buds = render({ data: earbudStyles, pathname: "/" }, { nav: at({ type: "styles", section: "buds-styles" }, "Menu", "section:buds-styles") })
  assert.match(buds, /Alcantara<\/span><span[^>]*>from ৳2,100<\/span>/, "an AirPods section shows the AirPods price")
  assert.match(buds, /Signature Earbuds<\/span><span[^>]*>from ৳750<\/span>/)
})

test("a stored AirPods or watch band never steers the Styles links, and nothing is pinned", () => {
  const styles = at({ type: "styles", section: "styles" }, "Menu", "section:styles")
  for (const slug of ["airpods-pro-3", "apple-watch-band"]) {
    const html = render({ data, pathname: "/" }, { nav: styles, remembered: slug })
    assert.ok(hrefs(html).includes("/shop/iphone-17-pro-max/signature/"), `${slug}: the newest phone, not the stored accessory`)
  }
  const nav = at({ type: "models", family: "airpods", section: "earbuds", shopAll: true }, "Menu", "section:earbuds")
  const list = render({ data, pathname: "/" }, { nav, remembered: "airpods-pro-3" })
  assert.deepEqual(rows(list), ["AirPods 4", "AirPods Pro 3", "AirPods Max"], "nothing pinned")
})

test("a WOMEN/MEN switch in flight survives the drawer mounting its tabs; only a new page clears it", () => {
  const calls = []
  let pathname = "/shop/iphone-16/"
  /** One mounted toggle: a React whose refs persist across its renders and whose effects run at once. */
  function mount() {
    const refs = []
    let slot = 0
    const react = {
      ...React,
      useRef: (initial) => (refs[slot++] ??= { current: initial }),
      useEffect: (effect) => void effect(),
    }
    const Toggle = load("components/audience-toggle.tsx", {
      react,
      "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push() {}, prefetch() {} }) },
      "next/link": { __esModule: true, default: ({ href, children, prefetch, ...rest }) => React.createElement("a", { href, className: rest.className }, children) },
      "@/components/use-audience": { useAudience: () => "men", rememberAudience() {}, setSwitchingAudience: (value) => calls.push(value) },
    }).default
    return () => {
      slot = 0
      return renderToStaticMarkup(React.createElement(Toggle, { variant: "tabs" }))
    }
  }
  const header = mount()
  header()
  // MEN was pressed; /men/shop/iphone-16/ is still loading. The shopper opens the menu, twice.
  mount()()
  mount()()
  header()
  assert.deepEqual(calls, [], "mounting or re-rendering a toggle never cancels the switch")
  pathname = "/men/shop/iphone-16/"
  header()
  assert.deepEqual(calls, [null], "the new page clears it")
  header()
  assert.deepEqual(calls, [null], "once")
})

test("collections: View all lists every collection of the mode inside the menu, with the page one tap away", () => {
  const many = { ...data, collections: [...data.collections, ...Array.from({ length: 10 }, (_, i) => [`extra-${i}`, `Extra ${i}`, `${R2}/c/extra-${i}.webp`, 0, 1])] }
  const html = render({ data: many, pathname: "/" }, { nav: at({ type: "collections", section: "collections" }, "Menu", "collections:collections") })
  assertNoNestedControls(html)
  assert.match(html, /<span class="sr-only">Back to <\/span>Menu<\/span><\/button>/)
  assert.match(html, /<h2 tabindex="-1"[^>]*>Collections<span[^>]*>12 collections<\/span><\/h2>/, "Women's 12: more than the row's limit of 8 would show")
  const links = hrefs(html)
  assert.equal(links[0], "/collections/", "Shop all first")
  assert.match(html, /Shop all collections/)
  assert.deepEqual(links.slice(1), ["/collection/leopard/", "/collection/floral/", ...Array.from({ length: 10 }, (_, i) => `/collection/extra-${i}/`)])
  assert.match(html, /<ul class="grid grid-cols-2 /)
  assert.match(html, /leopard.jpg" sizes="\(max-width:454px\) calc\(44vw - 22px\), 178px" loading="lazy" class="object-cover"/)
  assert.match(html, /floral.webp" sizes="[^"]*" loading="lazy" class="object-contain p-2"/, "product art contained")
  assert.doesNotMatch(html, /cars/, "a Men-only collection stays out of Women")

  const men = render({ data: many, pathname: "/men/", audience: "men" }, { audience: "men", nav: at({ type: "collections", section: "collections" }, "Menu", "collections:collections") })
  assert.deepEqual(hrefs(men), ["/men/collections/", "/men/collection/leopard/", "/men/collection/cars/"])
  assert.match(men, />2 collections</)
})

test("links: Shop all first, group headings, badges", () => {
  const html = render({ data, pathname: "/" }, { nav: at({ type: "links", section: "accessories" }, "Menu", "section:accessories") })
  assertNoNestedControls(html)
  assert.deepEqual(hrefs(html), ["/shop/accessories/", "/product/phone-charm/"])
  assert.match(html, /<h3[^>]*>Charms<\/h3>/)
  assert.match(html, /Phone Charm<span class="[^"]*bg-purple[^"]*">New<\/span>/)
})

test("while a level slides in, the one leaving stays behind it, inert", () => {
  const brands = { key: "1/1", level: { type: "brands", section: "phone" }, back: "Menu", opener: "section:phone" }
  const html = render({ data, pathname: "/" }, { nav: { session: 1, stack: [menu, brands], leaving: { entry: menu, dir: "push" } } })
  const frames = [...html.matchAll(/<div class="fl-level"([^>]*)>/g)].map((m) => m[1])
  assert.deepEqual(frames, [' data-anim="push-out" inert=""', ' data-anim="push-in"'])
  const back = render({ data, pathname: "/" }, { nav: { session: 1, stack: [menu], leaving: { entry: brands, dir: "back" } } })
  assert.deepEqual([...back.matchAll(/<div class="fl-level"([^>]*)>/g)].map((m) => m[1]), [' data-anim="back-in"', ' data-anim="back-out" inert=""'])
})
