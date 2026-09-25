const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

const src = (relative) => path.join(__dirname, "../src", relative)
const has = (relative) => fs.existsSync(src(relative))

/* The page the stubbed router is on; set before each render. */
let pathname = "/"

const Anchor = React.forwardRef(function Anchor({ prefetch, href, children, ...props }, ref) {
  return React.createElement("a", { href, ...props, ref, "data-prefetch": prefetch === false ? "off" : undefined }, children)
})
const stubs = {
  "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), useSearchParams: () => new URLSearchParams() },
  "next/link": { __esModule: true, default: Anchor },
  "next/image": {
    __esModule: true,
    default: ({ fill, sizes, unoptimized, priority, loading, ...props }) => React.createElement("img", { ...props, loading: priority ? undefined : loading ?? "lazy", "data-sizes": sizes }),
    getImageProps: (props) => ({ props }),
  },
  "@/components/cart-provider": { useCart: () => ({ summary: null, openDrawer() {}, isDrawerOpen: false }) },
  // Search's index loads on intent only; nothing on the server may touch it.
  "@/lib/search/load-index": { loadSearchIndex: () => { throw new Error("the search index must not load during render") } },
}
/* The search sheet is another part's file; until it lands, a stand-in keeps the shell renderable. */
const searchSheetStub = { __esModule: true, default: () => React.createElement("div", { "data-search-sheet-stub": "" }) }

function resolve(from, name) {
  const base = name.startsWith("@/") ? src(name.slice(2)) : path.resolve(path.dirname(from), name)
  return [".tsx", ".ts"].map((ext) => base + ext).find((file) => fs.existsSync(file)) ?? null
}
/**
 * A loader that reads storefront files the way the bundler would, with next/*
 * and the cart stubbed. The server render has no window; `globals` adds one
 * for the tests of browser-only helpers, and `extra` stubs more modules by name.
 */
function loader(globals = {}, extra = {}) {
  const modules = new Map()
  return function load(file) {
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
    }).outputText
    vm.runInNewContext(code, {
      exports: module.exports, module, URL, URLSearchParams, Intl, console,
      process: { env: {} },
      ...globals,
      require(name) {
        if (name in extra) return extra[name]
        if (stubs[name]) return stubs[name]
        if (name.startsWith("@/") || name.startsWith(".")) {
          const target = resolve(file, name)
          if (target) return load(target)
          if (name.endsWith("/search-sheet")) return searchSheetStub
          throw new Error(`${path.relative(src(""), file)} imports ${name}, which does not exist`)
        }
        return require(name)
      },
    }, { filename: file })
    return module.exports
  }
}
const load = loader()

const SiteHeader = load(src("components/header/site-header.tsx")).default
const MegaPanel = load(src("components/header/mega-panel.tsx")).default
const { buildHeaderData, sectionsFor, packHeaderData } = load(src("lib/header-data.ts"))
const { SEARCH_INPUT_ID } = load(src("components/header/types.ts"))

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"
const section = (id, label, extra = {}) => ({ id, label, href: null, groups: [], kind: "links", image: null, badge: null, placement: "all", config: null, ...extra })
const device = (slug, name, family, badge = null) => ({ id: `dev_${slug}`, slug, name, family, brand: family, badge })
const DEVICES = [
  device("iphone-17-pro-max", "iPhone 17 Pro Max", "iphone", "New"),
  device("iphone-17-pro", "iPhone 17 Pro", "iphone"),
  device("iphone-17", "iPhone 17", "iphone"),
  device("iphone-16-pro-max", "iPhone 16 Pro Max", "iphone"),
  device("iphone-16", "iPhone 16", "iphone"),
  device("samsung-s26-ultra", "Samsung S26 Ultra", "samsung"),
  device("samsung-s25-ultra", "Samsung S25 Ultra", "samsung"),
  device("airpods-pro-3", "AirPods Pro 3", "airpods"),
  device("airpods-4", "AirPods 4", "airpods"),
]
const CASE_TYPES = [
  { slug: "signature", name: "Signature", description: "", price: 1400, image: `${R2}/site/case-types/signature-9a3de988.jpg`, forms: ["phone"], fromPrice: 1400, fromPrices: { phone: 1400 } },
  // The seed's Alcantara: 3800 for phones, cheaper for AirPods and the card wallet (its overall lowest).
  { slug: "alcantara", name: "Alcantara", description: "", price: 3800, image: null, forms: ["phone", "airpods", "wallet"], fromPrice: 1900, fromPrices: { phone: 3800, airpods: 2100, wallet: 1900 } },
  { slug: "signature-earbuds", name: "Signature Earbuds", description: "", price: 750, image: null, forms: ["airpods"], fromPrice: 750, fromPrices: { airpods: 750 } },
]
const WOMEN = [
  section("phone", "Phone Case", { kind: "devices", href: "/shop/", image: `${R2}/site/menu/phone.webp`, badge: "New", config: { families: ["iphone", "samsung"], case_type: "signature" } }),
  section("styles", "Styles", { kind: "case_types", config: { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/" } } }),
  section("collections", "Collections", { kind: "collections", placement: "drawer", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }),
  section("wallets", "Card Wallet", { href: "/collection/card-wallets/", placement: "bar" }),
  section("gifts", "Gifts", { href: "/collection/gifts/", groups: [{ heading: "For her", links: [{ id: "l1", label: "Charms", href: "/collection/charms/", badge: "Hot" }] }] }),
  section("empty", "Nothing here"),
]
const MEN = [section("men-phone", "Men Phone Case", { kind: "devices", href: "/shop/", config: { families: ["iphone"], case_type: null } })]
const COLLECTIONS = [
  { slug: "leopard", collection_id: "c1", title: "Leopard", image: `${R2}/leopard.jpg`, artwork: null, theme: {}, audiences: ["women"] },
  { slug: "carbon", collection_id: "c2", title: "Carbon", image: null, artwork: `${R2}/carbon.webp`, theme: {}, audiences: ["men"] },
  { slug: "floral", collection_id: "c3", title: "Floral", image: null, artwork: null, theme: {}, in_menu: false },
]
const DATA = buildHeaderData({ sections: [], primary: WOMEN, primaryMen: MEN, footer: [], footerNote: "", social: [], collections: COLLECTIONS }, CASE_TYPES, DEVICES)

function render(at, data = DATA) {
  pathname = at
  // The layout sends the packed wire form; the shell unpacks it.
  const props = typeof packHeaderData === "function" ? { wire: JSON.parse(JSON.stringify(packHeaderData(data))) } : { data }
  return renderToStaticMarkup(React.createElement(SiteHeader, props))
}
/** Every <a> or <button> opened inside another one. */
function nested(html) {
  const open = []
  const problems = []
  for (const [, closing, tag] of html.matchAll(/<(\/?)(a|button)\b[^>]*>/g)) {
    if (closing) {
      open.pop()
      continue
    }
    if (open.length) problems.push(`<${tag}> inside <${open.at(-1)}>`)
    open.push(tag)
  }
  return problems
}
const headerOnly = (html) => html.match(/<header[\s\S]*?<\/header>/)[0]
const navOnly = (html) => html.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)[0]

test("the shell never nests a button in a link or a link in a button", () => {
  for (const at of ["/", "/men/", "/shop/iphone-16/signature/", "/product/leopard/", "/cart/", "/checkout/"]) {
    assert.deepEqual(nested(render(at)), [], at)
  }
})

test("the wordmark is an inline SVG sized by attributes, hidden inside the Florayn home link", () => {
  const html = render("/")
  const [, attrs] = html.match(/<a[^>]*aria-label="Florayn home"[^>]*><svg([^>]*)>/)
  assert.match(attrs, /viewBox="0 0 4000 648"/)
  assert.match(attrs, /width="111"/)
  assert.match(attrs, /height="18"/)
  assert.match(attrs, /aria-hidden="true"/)
  assert.doesNotMatch(attrs, /role="img"/)
  assert.doesNotMatch(html, /<img[^>]*logo|FLORAYN<\/a>/i, "never an image or text logo")

  const checkout = render("/checkout/")
  const [, checkoutAttrs] = checkout.match(/<a[^>]*aria-label="Florayn home"[^>]*><svg([^>]*)>/)
  assert.match(checkoutAttrs, /width="124"[^>]*height="20"|height="20"[^>]*width="124"/)
  assert.doesNotMatch(checkout, /data-store-header|site-drawer|Open menu/, "checkout keeps its minimal header")
  assert.match(checkout, /Back to bag/)
})

test("the phone search field is inside the sticky header on every page but search; WOMEN/MEN only on home, shop and collection pages", () => {
  const row = (html) => headerOnly(html).match(/<div data-header-row2="true" class="lg:hidden">[\s\S]*?<\/a>(?:<nav[\s\S]*?<\/nav>)?<\/div><\/div>/)?.[0] ?? null
  for (const at of ["/", "/men/", "/shop/iphone-16/signature/", "/collection/leopard/", "/collections/", "/men/collections/"]) {
    const html = render(at)
    assert.match(html, /<header data-store-header="true" data-row2=""/, at)
    const field = row(html)
    assert.ok(field, `${at}: the search row is inside <header>`)
    assert.match(field, /<a href="\/(?:men\/)?search\/"[^>]*class="flex h-11 min-w-0 flex-1/, at)
    assert.match(field, /fl-audience--compact/, at)
  }
  for (const at of ["/product/leopard/", "/men/product/leopard/", "/cart/", "/account/", "/contact/"]) {
    const html = render(at)
    assert.match(html, /<header data-store-header="true" data-row2=""/, at)
    const field = row(html)
    assert.ok(field, `${at}: the search row is inside <header>`)
    assert.doesNotMatch(field, /fl-audience/, `${at}: no WOMEN/MEN switch beside the field`)
  }
  for (const at of ["/search/", "/men/search/"]) {
    const html = render(at)
    assert.doesNotMatch(html, /data-header-row2|data-row2/, `${at} has its own field`)
  }
  assert.doesNotMatch(render("/"), /fl-audience--tabs/, "the full-width tab bar left the page (it lives in the drawer)")
})

test("the logo row tucks away only on phones and tablets, by its own height, and never under keyboard focus", () => {
  const css = fs.readFileSync(src("app/header.css"), "utf8")
  assert.match(css, /@media \(max-width:1023px\) \{[\s\S]*?\[data-store-header\]\[data-row2\]\[data-tuck\]:not\(:has\(:focus-visible\)\) \{ transform:translateY\(-56px\); \}/)
  assert.match(css, /@media \(min-width:768px\) and \(max-width:1023px\) \{\s*\[data-store-header\]\[data-row2\]\[data-tuck\]:not\(:has\(:focus-visible\)\) \{ transform:translateY\(-64px\); \}/)
  assert.doesNotMatch(css, /fl-hdr-search/, "the row-1 search icon is gone")
  const shell = fs.readFileSync(src("components/header/site-header.tsx"), "utf8")
  assert.match(shell, /matchMedia\("\(max-width:1023px\)"\)/, "desktop never tucks")
  assert.match(shell, /addEventListener\("scroll", onScroll, \{ passive: true \}\)/)
  assert.doesNotMatch(shell, /useState\([^)]*tuck|setTuck/i, "a DOM attribute, not state")
  // Checkout swaps in its own <header>: searchRow is false there, so the listener re-attaches to the new header on the way back.
  assert.match(shell, /const searchRow = !minimal && !SEARCH_PAGE\.test\(plainPath\)/)
  assert.match(shell, /\}, \[searchRow\]\)/)
  assert.match(shell, /Math\.min\(Math\.max\(window\.scrollY, 0\), document\.documentElement\.scrollHeight - window\.innerHeight\)/, "an iOS bounce never reads as scrolling up")
})

test("what the taller phone header changes elsewhere: the quick-buy bar, anchors, and the drawer on desktop", () => {
  const bar = fs.readFileSync(src("components/product-buy-bar.tsx"), "utf8")
  assert.match(bar, /attributeFilter: \["data-tuck"\]/, "the quick-buy bar re-measures when the logo row tucks or comes back")
  assert.match(bar, /header\?\.getBoundingClientRect\(\)\.height \?\? 0\) - tucked/)
  const content = fs.readFileSync(src("app/product-content.css"), "utf8")
  const phone = content.slice(content.indexOf("@media(max-width:767px)"))
  assert.match(phone, /\.fl-acc__item\[id\] \{ scroll-margin-top:128px; \}/, "a #reviews link clears the 109px header")
  assert.match(phone, /\.fl-reviews \{[^}]*scroll-margin-top:128px; \}/)
  const dialogs = fs.readFileSync(src("components/header/header-dialogs.tsx"), "utf8")
  const press = dialogs.match(/export const searchPressIntent = \{[\s\S]*?\}/)[0]
  assert.doesNotMatch(press, /onMouseEnter|onFocus/, "opening the drawer under a resting mouse never loads search")
  const drawer = fs.readFileSync(src("components/header/nav-drawer.tsx"), "utf8")
  assert.match(drawer, /<ul data-hscroll className="[^"]*pointer-coarse:\[scrollbar-width:none\][^"]*pointer-fine:\[scrollbar-width:thin\]"/, "a mouse can scroll the Collections row")
  assert.match(fs.readFileSync(src("app/nav-drawer.css"), "utf8"), /@media \(pointer:coarse\) \{ \.fl-level \[data-hscroll\]::-webkit-scrollbar \{ display:none; \} \}/)
})

test("a solid bar: no backdrop blur, sticky, and the pieces the product page measures", () => {
  const html = render("/")
  const header = headerOnly(html)
  assert.doesNotMatch(html, /backdrop-blur|bg-paper\/95/)
  assert.match(header, /^<header data-store-header="true"[^>]*class="sticky top-0 z-40 border-b border-line bg-paper"/)
  assert.match(header, /grid h-14 max-w-\[1470px\] grid-cols-\[1fr_auto_1fr\][^"]* md:h-16[^"]* lg:h-\[72px\]/)
  assert.match(header, /aria-label="Open menu" aria-haspopup="dialog" aria-expanded="false" aria-controls="site-drawer"/)
  const menuButton = header.match(/<button[^>]*aria-label="Open menu"[^>]*>/)[0]
  assert.doesNotMatch(menuButton, /lg:hidden/, "the menu drawer opens on desktop too")
  assert.doesNotMatch(header, /aria-label="Search"/, "no separate search icon: the field is in the header")
  assert.match(header, /<a[^>]*href="\/account\/"[^>]*aria-label="My account"|<a[^>]*aria-label="My account"[^>]*href="\/account\/"/)
  assert.match(header, /aria-label="Bag, 0 items"/)
  assert.match(header, /<span class="sr-only" aria-live="polite"><\/span>/, "the bag's live region is always mounted")
  assert.match(header, /<kbd aria-hidden="true"[^>]*>\/<\/kbd>/, "the desktop field shows its shortcut")
  const custom = headerOnly(render("/", { ...DATA, search: { ...DATA.search, placeholder: "Find a case" } }))
  assert.match(custom, /Find a case/, "the placeholder comes from Admin > Search")
})

test("the skip link is the first thing to focus, and the sheets are closed, empty shells", () => {
  const html = render("/")
  assert.match(html.match(/<(a|button)\b[^>]*>/)[0], /href="#main"/)
  assert.match(html, />Skip to content<\/a>/)
  const drawer = html.match(/<dialog[^>]*id="site-drawer"[^>]*>/)[0]
  const search = html.match(/<dialog[^>]*id="site-search"[^>]*>/)[0]
  assert.match(drawer, /class="fl-sheet fl-sheet--left" aria-label="Menu"/)
  assert.match(search, /class="fl-sheet fl-sheet--search" aria-label="Search"/)
  assert.doesNotMatch(drawer + search, /\sopen/, "closed until showModal()")
  assert.doesNotMatch(html, /fl-levels|Loading the menu/, "the menu levels load on intent, never on the server")
  assert.match(html, /<div class="fl-panel"><div class="flex h-16[^"]*"><a href="\/search\/"/, "the drawer's top bar is in the shell")
  assert.match(html, /aria-label="Close menu"/)
})

test("the search input is in the server HTML, so the first tap can focus it", { skip: !has("components/header/search-sheet.tsx") && "search-sheet.tsx has not landed yet" }, () => {
  const html = render("/")
  const dialog = html.match(/<dialog[^>]*id="site-search"[\s\S]*?<\/dialog>/)[0]
  assert.match(dialog, new RegExp(`<input[^>]*id="${SEARCH_INPUT_ID}"`))
})

test("desktop nav: a link with a sibling chevron, a single button, or a link only", () => {
  const nav = navOnly(render("/"))
  assert.match(nav, /<nav aria-label="Main" class="relative hidden border-t border-line lg:block">/)
  assert.match(nav, /<ul class="mx-auto flex h-12 max-w-\[1470px\] items-center justify-center gap-8 px-\[30px\]">/)
  // (a) Phone Case: its own link, then a sibling button that opens the panel.
  assert.match(nav, /<li[^>]*><a href="\/shop\/"[^>]*data-prefetch="off"[^>]*>Phone Case<span[^>]*>New<\/span><\/a><button type="button" aria-expanded="false" aria-controls="mega-phone" aria-label="Show Phone Case menu"/)
  // (b) Styles has no link of its own: one button with the label and the chevron.
  assert.match(nav, /<li[^>]*><button type="button" aria-expanded="false" aria-controls="mega-styles"[^>]*>Styles<svg/)
  // (c) Card Wallet has nothing to open: a link only.
  assert.match(nav, /<li[^>]*><a href="\/collection\/card-wallets\/"[^>]*>Card Wallet<\/a><\/li>/)
  // A links section with groups opens a panel too; a section with neither is left out.
  assert.match(nav, /aria-controls="mega-gifts"/)
  assert.doesNotMatch(nav, /Nothing here/)
  assert.deepEqual(nested(nav), [])
  assert.doesNotMatch(nav, /mega-phone"[^>]*role="region"/, "no panel until it is opened")
})

test("placement: a drawer-only section never reaches the bar, a bar-only one never the drawer", () => {
  const nav = navOnly(render("/"))
  assert.doesNotMatch(nav, />Collections</, "Collections is placed in the drawer only")
  assert.match(nav, /Card Wallet/)
  assert.deepEqual(sectionsFor(DATA, "women", "drawer").map((s) => s.id), ["phone", "styles", "collections", "gifts", "empty"])
  assert.deepEqual(sectionsFor(DATA, "women", "bar").map((s) => s.id), ["phone", "styles", "wallets", "gifts", "empty"])
})

test("a shared page like /cart/ renders the Women bar on the server even when Men has its own menu", () => {
  assert.ok(Array.isArray(DATA.men), "the fixture's Men menu differs")
  const cart = navOnly(render("/cart/"))
  assert.match(cart, /Phone Case/)
  assert.doesNotMatch(cart, /Men Phone Case/)
  const men = navOnly(render("/men/shop/iphone-16/"))
  assert.match(men, /Men Phone Case/)
  assert.doesNotMatch(men, />Phone Case</)
})

test("after hydration a shared page's bar follows the remembered mode, like the pill: its labels and links agree", () => {
  // useAudience() once the fl_audience=men cookie is read (the server snapshot is Women, as above).
  const remembersMen = loader({}, { "@/components/use-audience": { useAudience: () => "men", rememberAudience() {}, setSwitchingAudience() {} } })
  const Header = remembersMen(src("components/header/site-header.tsx")).default
  pathname = "/cart/"
  const html = renderToStaticMarkup(React.createElement(Header, { wire: JSON.parse(JSON.stringify(packHeaderData(DATA))) }))
  const nav = navOnly(html)
  assert.match(nav, /<a href="\/men\/shop\/"[^>]*>Men Phone Case<\/a>/, "Men's sections, with Men links")
  assert.doesNotMatch(nav, />Phone Case</, "never the Women labels with Men links")
  assert.match(html, /class="fl-audience fl-audience--pill[^"]*" data-audience="men"/, "the pill shows the same mode")
})

test("without devices, a device section is a plain link to its own page", () => {
  const data = buildHeaderData({ sections: [], primary: WOMEN, footer: [], footerNote: "", social: [], collections: [] }, CASE_TYPES, [])
  const nav = navOnly(render("/", data))
  assert.match(nav, /<li[^>]*><a href="\/shop\/"[^>]*>Phone Case<span[^>]*>New<\/span><\/a><\/li>/)
  assert.doesNotMatch(nav, /mega-phone/)
})

const panel = (id, audience = "women") => {
  pathname = "/"
  return renderToStaticMarkup(React.createElement(MegaPanel, { section: DATA.women.find((s) => s.id === id), data: DATA, audience, onNavigate() {} }))
}

test("devices panel: brands, models newest first under series, and the promo; no filter", () => {
  const html = panel("phone")
  assert.match(html, /^<div id="mega-phone" role="region" aria-label="Phone Case" class="fl-mega /)
  assert.match(html, /<button type="button" aria-pressed="true"[^>]*><span class="flex-1">iPhone<\/span><span[^>]*>5<\/span><\/button>/)
  assert.match(html, /Samsung Galaxy<\/span><span[^>]*>2</)
  assert.doesNotMatch(html, /<input|Find your model/, "every model is on screen: no filter in the panel")
  const models = [...html.matchAll(/href="\/shop\/([a-z0-9-]+)\/signature\/"/g)].map((m) => m[1])
  assert.deepEqual(models, ["iphone-17-pro-max", "iphone-17-pro", "iphone-17", "iphone-16-pro-max", "iphone-16"])
  assert.match(html, /iPhone 17 series[\s\S]*iPhone 16 series/)
  assert.match(html, /<img[^>]*src="https:\/\/pub-[^"]*\/site\/menu\/phone\.webp"[^>]*data-sizes="260px"/)
  assert.match(html, /Shop all ›/)
  assert.deepEqual(nested(html), [])

  const one = renderToStaticMarkup(React.createElement(MegaPanel, { section: section("buds", "Earbuds", { kind: "devices", config: { families: ["airpods"], case_type: "signature-earbuds" } }), data: DATA, audience: "women", onNavigate() {} }))
  assert.doesNotMatch(one, /aria-pressed/, "one brand: no rail")
  assert.doesNotMatch(one, /Shop all/, "no picture: no promo")
  assert.match(one, /href="\/shop\/airpods-pro-3\/signature-earbuds\/"/)
})

test("styles, collections and link panels", () => {
  const styles = panel("styles")
  assert.match(styles, /href="\/shop\/iphone-17-pro-max\/signature\/"[\s\S]*Signature[\s\S]*from ৳1,400/, "the newest phone when none is remembered")
  assert.match(styles, /href="\/collection\/alcantara\/"[\s\S]*Alcantara[\s\S]*from ৳3,800/, "the admin's override and the lowest phone price")
  assert.doesNotMatch(styles, /৳1,900|৳2,100/, "never a cheaper AirPods or wallet price in a phone section")
  assert.doesNotMatch(styles, /Signature Earbuds/, "not an AirPods style in a phone section")

  const women = panel("collections")
  assert.match(women, /href="\/collection\/leopard\/"/)
  assert.doesNotMatch(women, /carbon|floral/i, "Men-only and hidden collections stay out")
  assert.match(women, /View all collections/)
  assert.match(panel("collections", "men"), /href="\/collection\/carbon\/"[\s\S]*object-contain p-2/, "product artwork is contained")

  const links = panel("gifts")
  assert.match(links, /For her[\s\S]*href="\/collection\/charms\/"[\s\S]*Charms<span[^>]*>Hot</)
  for (const html of [styles, women, links]) assert.deepEqual(nested(html), [])
})

test("opening the menu never downloads search: the drawer's search field ignores the focus showModal() gives it", () => {
  const anchors = []
  const runtime = require("react/jsx-runtime")
  const record = (fn) => (type, props, key) => {
    if (type === "a") anchors.push(props)
    return fn(type, props, key)
  }
  let loads = 0
  const dialogs = loader({}, {
    "react/jsx-runtime": { ...runtime, jsx: record(runtime.jsx), jsxs: record(runtime.jsxs) },
    "@/lib/search/load-index": { loadSearchIndex: () => (loads++, Promise.resolve(null)) },
    "./search-results": { __esModule: true, default: () => null },
  })(src("components/header/header-dialogs.tsx"))
  pathname = "/"
  renderToStaticMarkup(React.createElement(dialogs.MenuDrawer, { dialogRef: { current: null }, data: DATA, audience: "women", pathname: "/", openCount: 0, onClosed() {} }))
  const field = anchors.find((props) => props.href === "/search/")
  assert.ok(field, "the drawer's search field is in the shell")
  assert.equal(field.onFocus, undefined, "showModal() focuses it on open: that is not intent to search")
  assert.equal(typeof field.onPointerDown, "function")
  assert.equal(typeof field.onTouchStart, "function")
  assert.equal(loads, 0)
  field.onPointerDown()
  assert.equal(loads, 1, "a press on it still starts loading the index")
  assert.equal(typeof dialogs.searchIntent.onFocus, "function", "the header's own search links still load on focus (a Tab to them)")
})

test("the menu drawer's first level nests nothing and follows placement", { skip: !has("components/header/nav-drawer.tsx") && "nav-drawer.tsx has not landed yet" }, () => {
  const NavDrawer = load(src("components/header/nav-drawer.tsx")).default
  pathname = "/"
  const html = renderToStaticMarkup(React.createElement(NavDrawer, { data: DATA, audience: "women", pathname: "/", openCount: 1, onNavigate() {} }))
  assert.deepEqual(nested(html), [])
  assert.match(html, /fl-audience--tabs/, "WOMEN / MEN tabs live in the drawer")
  assert.doesNotMatch(html, /Card Wallet/, "a bar-only section never reaches the drawer")
})

test("a part that fails to load retries once, then reloads once per build; a quiet preload never reloads", async () => {
  const storage = new Map()
  let reloads = 0
  const window = {
    setTimeout: (fn) => (fn(), 1),
    clearTimeout() {},
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    location: { reload: () => reloads++ },
  }
  const { retryImport, loadable } = loader({ window })(src("components/header/header-dialogs.tsx"))
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  let calls = 0
  assert.equal(await retryImport(() => (++calls === 1 ? Promise.reject(new Error("blip")) : Promise.resolve("part"))), "part")
  assert.equal(calls, 2, "one retry")
  assert.equal(reloads, 0)

  const gone = () => Promise.reject(new Error("gone"))
  await assert.rejects(retryImport(gone, false))
  assert.equal(reloads, 0, "a quiet load never reloads")
  retryImport(gone)
  await tick()
  assert.equal(reloads, 1)
  assert.equal(storage.get("fl-chunk-reload"), "dev", "remembered per build")
  await assert.rejects(retryImport(gone), "the second time the error shows instead")
  assert.equal(reloads, 1)

  storage.clear()
  reloads = 0
  let tries = 0
  const part = loadable(() => (++tries <= 2 ? Promise.reject(new Error("offline")) : Promise.resolve({ default: "Levels" })))
  await assert.rejects(part.preload())
  assert.equal(part.loaded(), null)
  assert.equal(reloads, 0, "a hover or idle preload that fails leaves the page alone")
  assert.equal((await part.preload()).default, "Levels", "the next intent tries again")
  assert.equal(part.loaded().default, "Levels")
  assert.equal(await part.render(), part.loaded(), "rendering reuses what the preload fetched")
  assert.equal(tries, 3)
})

test("guards: no florayn.com hotlinks, the old header and mega menu are gone, heavy parts stay lazy", () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|css|json)$/.test(entry.name)) files.push(full)
    }
  }
  walk(src(""))
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /florayn\.com\/wp-content/, path.relative(src(""), file))
  assert.ok(!has("components/site-header.tsx") && !has("components/mega-menu.tsx"))

  const shell = fs.readFileSync(src("components/header/site-header.tsx"), "utf8")
  const dialogs = fs.readFileSync(src("components/header/header-dialogs.tsx"), "utf8")
  const nav = fs.readFileSync(src("components/header/desktop-nav.tsx"), "utf8")
  for (const code of [shell, dialogs, nav]) {
    assert.doesNotMatch(code, /next\/dynamic|ssr:\s*false/)
    assert.doesNotMatch(code, /^import (?!type )[^\n]*from "(?:\.|@\/components\/header)\/(?:nav-drawer|mega-panel|search-results)"/m, "the heavy parts are only ever imported lazily")
  }
  assert.match(dialogs, /import\("\.\/nav-drawer"\)/)
  assert.match(nav, /import\("\.\/mega-panel"\)/)
  const layout = fs.readFileSync(src("app/layout.tsx"), "utf8")
  assert.match(layout, /Promise\.all\(\[\s*getSiteContent\(\),\s*getCaseTypes\(\),\s*getDeviceCatalog\(\),?\s*\]\)/)
  assert.match(layout, /<SiteHeader (?:data=\{buildHeaderData\(content, caseTypes, devices\)\}|wire=\{packHeaderData\(buildHeaderData\(content, caseTypes, devices\)\)\}) \/>/)
  assert.match(layout, /<main id="main"/)
  assert.doesNotMatch(layout, /next\/headers|cookies\(|searchParams/)
  const globals = fs.readFileSync(src("app/globals.css"), "utf8")
  assert.match(globals, /--color-field: #f5f4f7;/)
  for (const sheet of ["header", "nav-drawer", "search"]) {
    assert.match(globals, new RegExp(`@import "\\./${sheet}\\.css";`))
    assert.ok(has(`app/${sheet}.css`), `app/${sheet}.css exists`)
  }
})
