const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const src = path.join(__dirname, "../src")
/** Load a storefront file and its value imports ("./x", "../x" or "@/x"); types are erased. */
function load(relative) {
  const cache = new Map()
  function one(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, { exports, URL, process: { env: {} }, require(dep) {
      const base = dep.startsWith("@/") ? path.join(src, dep.slice(2)) : dep.startsWith(".") ? path.resolve(path.dirname(filename), dep) : null
      if (!base) throw new Error(`Unexpected import ${dep}`)
      const file = [".ts", ".tsx"].map((ext) => base + ext).find((f) => fs.existsSync(f))
      if (!file) throw new Error(`Cannot find ${dep}`)
      return one(file)
    } }, { filename })
    return exports
  }
  return one(path.join(src, relative))
}

const model = load("components/header/nav-model.ts")
const { sortNewestFirst } = load("lib/device-order.ts")
const { withAudience } = load("lib/audience.ts")
const plain = (value) => JSON.parse(JSON.stringify(value))

/* The live catalogue, in /store/devices order: admin family order, each family newest first. */
const seed = [
  ...["11", "11 Pro", "11 Pro Max", "12 Mini", "12", "12 Pro", "12 Pro Max", "13 Mini", "13", "13 Pro", "13 Pro Max", "14", "14 Plus", "14 Pro", "14 Pro Max", "15", "15 Plus", "15 Pro", "15 Pro Max", "16", "16 Plus", "16 Pro", "16 Pro Max", "17", "17 Air", "17 Pro", "17 Pro Max"]
    .map((n) => [`iphone-${n.toLowerCase().replace(/ /g, "-")}`, `iPhone ${n}`, "iphone"]),
  ...["S23", "S23 Plus", "S23 Ultra", "S24", "S24 Plus", "S24 Ultra", "S25", "S25 Plus", "S25 Ultra", "S26", "S26 Plus", "S26 Ultra"]
    .map((n) => [`samsung-${n.toLowerCase().replace(/ /g, "-")}`, `Samsung ${n}`, "samsung"]),
  ["airpods-1-2", "AirPods 1/2", "airpods"], ["airpods-3", "AirPods 3", "airpods"], ["airpods-4", "AirPods 4", "airpods"],
  ["airpods-pro", "AirPods Pro", "airpods"], ["airpods-pro-2", "AirPods Pro 2", "airpods"], ["airpods-pro-3", "AirPods Pro 3", "airpods"], ["airpods-max", "AirPods Max", "airpods"],
  ["apple-watch-band", "Apple Watch Band", "watch"],
  ["card-wallet", "Card Wallet", "wallet"], ["magsafe-wallet", "MagSafe Wallet", "wallet"],
]
const NEW = new Set(["iphone-17-pro-max", "iphone-17-pro", "iphone-17-air", "iphone-17", "samsung-s26-ultra", "airpods-pro-3"])
const devices = sortNewestFirst(seed, (d) => d[1], (d) => d[2]).map(([slug, name, family]) => [slug, name, family, NEW.has(slug) ? "New" : null])

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/site/case-types"
const caseTypes = [
  ["signature", "Signature", 950, `${R2}/signature-9a3de988.jpg`, ["phone"]],
  ["essentials", "Essentials", 750, `${R2}/essentials-c95650a6.jpg`, ["phone"]],
  ["elite-clear", "Elite Clear", 1100, `${R2}/elite-clear-bde7403d.jpg`, ["phone"]],
  ["armor-clear", "Armor Clear", 1200, `${R2}/armor-clear-4c44fbe7.jpg`, ["phone"]],
  ["armor-black", "Armor Black", 1200, `${R2}/armor-black-5115f65d.webp`, ["phone"]],
  ["alcantara", "Alcantara", 1400, `${R2}/alcantara-d3190c32.jpg`, ["phone"]],
  ["signature-earbuds", "Signature Earbuds", 750, null, ["airpods"]],
]
const section = (id, label, extra = {}) => ({ id, label, href: null, kind: "links", image: null, badge: null, placement: "all", config: null, groups: [], ...extra })
const phone = section("phone", "Phone Case", { kind: "devices", href: "/shop/", config: { families: ["iphone", "samsung"], case_type: "signature" } })
const earbuds = section("earbuds", "Earbuds", { kind: "devices", config: { families: ["airpods"], case_type: "signature-earbuds" } })
const watch = section("watch", "Watch", { kind: "devices", config: { families: ["watch"], case_type: null } })
const styles = section("styles", "Styles", { kind: "case_types", config: { form: "phone", exclude: ["armor-black"], links: { alcantara: "/collection/alcantara/" } } })
const collections = section("collections", "Collections", { kind: "collections", placement: "drawer", config: { title: "Collections", view_all_href: "/collections/", limit: 3 } })
const accessories = section("accessories", "Accessories", { href: "/shop/accessories/", groups: [{ heading: "Charms", links: [{ label: "Phone Charm", href: "/product/phone-charm/", badge: null }] }] })
const sale = section("sale", "Sale", { href: "/collection/sale/" })
const empty = section("empty", "Empty")
const data = {
  women: [phone, earbuds, watch, styles, collections, accessories, sale, empty],
  men: null,
  devices,
  caseTypes,
  collections: [["leopard", "Leopard", null, 0, 3], ["floral", "Floral", null, 1, 1], ["marble", "Marble", null, 0, 2], ["pastel", "Pastel", null, 0, 3], ["cars", "Cars", null, 0, 2]],
  families: { iphone: "iPhone", samsung: "Samsung Galaxy", airpods: "AirPods", watch: "Apple Watch", wallet: "Card Wallet" },
  drawerLinks: [{ label: "My account", href: "/account/" }, { label: "Help & contact", href: "/contact/" }],
  rememberDevice: true,
  search: { placeholder: "Search designs or models", suggest: { women: [], men: [] }, help: { label: "Can't find your model? Message us", href: "/contact/" } },
}
const find = (slug) => devices.find((d) => d[0] === slug)

test("an Earbuds section (families [airpods]) goes straight to the AirPods models", () => {
  assert.deepEqual(plain(model.resolveSection(earbuds, data)), { type: "models", family: "airpods" })
})

test("a section with one Watch device is a direct link to that device", () => {
  assert.deepEqual(plain(model.resolveSection(watch, data)), { type: "link", href: "/shop/apple-watch-band/" })
})

test("the Phone Case section opens the brands iPhone and Samsung Galaxy with model counts", () => {
  assert.deepEqual(plain(model.resolveSection(phone, data)), { type: "brands", families: ["iphone", "samsung"] })
  assert.deepEqual(plain(model.familiesOf(phone, data)), [
    { family: "iphone", label: "iPhone", count: 27, badge: "New" },
    { family: "samsung", label: "Samsung Galaxy", count: 12, badge: "New" },
  ])
  const renamed = { ...data, families: { ...data.families, samsung: "Samsung" } }
  assert.equal(model.familiesOf(phone, renamed)[1].label, "Samsung", "brand names come from Navigation settings")
  const reordered = { ...phone, config: { families: ["samsung", "iphone"], case_type: null } }
  assert.deepEqual(plain(model.familiesOf(reordered, data)).map((f) => f.family), ["samsung", "iphone"], "brands keep the section's order")
})

test("the iPhone models begin 17 Pro Max, 17 Pro, 17 Air, 17, 16 Pro Max", () => {
  assert.deepEqual(plain(model.modelsOf(data, "iphone")).slice(0, 9).map((d) => d[1]), [
    "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air", "iPhone 17", "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16", "iPhone 15 Pro Max",
  ])
  assert.deepEqual(plain(model.modelsOf(data, "samsung")).slice(0, 3).map((d) => d[1]), ["Samsung S26 Ultra", "Samsung S26 Plus", "Samsung S26"])
})

test("series subheads appear for iPhone and Samsung, not for AirPods", () => {
  const iphone = model.seriesGroups(model.modelsOf(data, "iphone"))
  assert.deepEqual(plain(iphone).map((g) => g.heading), ["iPhone 17 series", "iPhone 16 series", "iPhone 15 series", "iPhone 14 series", "iPhone 13 series", "iPhone 12 series", "iPhone 11 series"])
  assert.deepEqual(plain(iphone[0].devices).map((d) => d[1]), ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air", "iPhone 17"])
  assert.equal(plain(iphone).flatMap((g) => g.devices).length, 27, "no model is lost or repeated")
  assert.equal(model.seriesGroups(model.modelsOf(data, "samsung"))[0].heading, "Samsung S26 series")

  const airpods = model.seriesGroups(model.modelsOf(data, "airpods"))
  assert.equal(airpods.length, 1)
  assert.equal(airpods[0].heading, null, "AirPods Max has no number, so the list stays flat")
  assert.equal(model.seriesGroups([find("iphone-17"), find("iphone-16")])[0].heading, null, "no generation with two models: flat")
  assert.equal(model.seriesGroups([find("iphone-17-pro"), find("iphone-17"), find("iphone-16")]).length, 1, "only one full generation: flat")
  assert.deepEqual(plain(model.seriesGroups([["iphone-16", "iPhone 16", "iphone", null], ["iphone-16e", "iPhone 16e", "iphone", null], ["iphone-15-pro", "iPhone 15 Pro", "iphone", null], ["iphone-15", "iPhone 15", "iphone", null]])).map((g) => g.heading), ["iPhone 16 series", "iPhone 15 series"], "16e belongs to the 16 series")
  assert.deepEqual(plain(model.seriesGroups([])), [])
})

test("shopHref ignores signature-earbuds for an iPhone and uses it for AirPods Pro 3", () => {
  assert.equal(model.shopHref(find("iphone-17"), earbuds, data, "women"), "/shop/iphone-17/")
  assert.equal(model.shopHref(find("airpods-pro-3"), earbuds, data, "women"), "/shop/airpods-pro-3/signature-earbuds/")
  assert.equal(model.shopHref(find("iphone-17"), phone, data, "women"), "/shop/iphone-17/signature/")
  assert.equal(model.shopHref(find("iphone-17"), null, data, "women"), "/shop/iphone-17/")
  const gone = { ...phone, config: { families: ["iphone"], case_type: "retired" } }
  assert.equal(model.shopHref(find("iphone-17"), gone, data, "women"), "/shop/iphone-17/", "an unknown case type falls back to the device shop")
})

test("caseStyleHref sends alcantara to /collection/alcantara/ through the override", () => {
  const alcantara = caseTypes.find((c) => c[0] === "alcantara")
  assert.equal(model.caseStyleHref(alcantara, styles, data, "women", null), "/collection/alcantara/")
  assert.equal(model.caseStyleHref(alcantara, styles, data, "women", "iphone-15"), "/collection/alcantara/", "the override wins over the shopper's phone")
})

test("without an override a style opens on the remembered iPhone 15, else on the newest iPhone", () => {
  const essentials = caseTypes.find((c) => c[0] === "essentials")
  assert.equal(model.caseStyleHref(essentials, styles, data, "women", "iphone-15"), "/shop/iphone-15/essentials/")
  assert.equal(model.caseStyleHref(essentials, styles, data, "women", null), "/shop/iphone-17-pro-max/essentials/")
  assert.equal(model.caseStyleHref(essentials, styles, data, "women", "airpods-pro-3"), "/shop/iphone-17-pro-max/essentials/", "a remembered AirPods is not a phone")
  assert.equal(model.caseStyleHref(essentials, styles, data, "women", "samsung-s24"), "/shop/samsung-s24/essentials/", "a Samsung is a phone too")
  assert.equal(model.caseStyleHref(essentials, styles, data, "women", "iphone-99"), "/shop/iphone-17-pro-max/essentials/", "an unknown slug is ignored")
})

test("Men mode prefixes /men on /shop and /collection links but not on /account/ or /contact/", () => {
  const alcantara = caseTypes.find((c) => c[0] === "alcantara")
  const essentials = caseTypes.find((c) => c[0] === "essentials")
  assert.equal(model.shopHref(find("iphone-17"), phone, data, "men"), "/men/shop/iphone-17/signature/")
  assert.equal(model.caseStyleHref(alcantara, styles, data, "men", null), "/men/collection/alcantara/")
  assert.equal(model.caseStyleHref(essentials, styles, data, "men", "iphone-15"), "/men/shop/iphone-15/essentials/")
  assert.deepEqual(data.drawerLinks.map((l) => withAudience(l.href, "men")), ["/account/", "/contact/"])
  assert.equal(model.resolveSection(watch, data).href, "/shop/apple-watch-band/", "a section link stays plain; the link adds the mode")
})

test("styles list the section's form, minus exclusions, in case-type order", () => {
  assert.deepEqual(plain(model.resolveSection(styles, data)), { type: "styles" })
  assert.deepEqual(plain(model.stylesOf(styles, data)).map((c) => c[0]), ["signature", "essentials", "elite-clear", "armor-clear", "alcantara"])
  const earbudStyles = { ...styles, config: { form: "airpods", exclude: [], links: {} } }
  assert.deepEqual(plain(model.stylesOf(earbudStyles, data)).map((c) => c[0]), ["signature-earbuds"])
  assert.deepEqual(plain(model.resolveSection({ ...styles, href: "/shop/" }, { ...data, caseTypes: [] })), { type: "link", href: "/shop/" }, "no case types: the section's own link")
})

test("a style's from-price is its price for the section's form, never a cheaper form's", () => {
  // The seed's Alcantara: phone 3800, AirPods 2100, Watch 2200, Card Wallet 1900 (the overall lowest).
  const alcantara = ["alcantara", "Alcantara", 1900, null, ["phone", "airpods", "watch", "wallet"], [3800, 2100, 2200, 1900]]
  const withAlcantara = { ...data, caseTypes: [...caseTypes.filter((c) => c[0] !== "alcantara"), alcantara] }
  assert.equal(model.sectionForm(styles), "phone")
  assert.equal(model.sectionForm({ ...styles, config: { form: "airpods", exclude: [], links: {} } }), "airpods")
  assert.equal(model.sectionForm({ ...styles, config: null }), "phone", "an unset form is phone")
  const row = model.stylesOf(styles, withAlcantara).find((c) => c[0] === "alcantara")
  assert.equal(model.styleFromPrice(row, model.sectionForm(styles)), 3800, "the phone Styles row says from 3800, not 1900")
  assert.equal(model.styleFromPrice(alcantara, "airpods"), 2100)
  assert.equal(model.styleFromPrice(alcantara, "wallet"), 1900)
  assert.equal(model.styleFromPrice(["x", "X", 900, null, ["phone"], [null]], "phone"), 900, "no price for the form: the overall one")
  assert.equal(model.styleFromPrice(["x", "X", 900, null, ["phone"]], "phone"), 900, "an older tuple without prices")
})

test("links, collections and empty sections resolve to what they can show", () => {
  assert.deepEqual(plain(model.resolveSection(accessories, data)), { type: "links" })
  assert.deepEqual(plain(model.resolveSection(sale, data)), { type: "link", href: "/collection/sale/" })
  assert.deepEqual(plain(model.resolveSection(empty, data)), { type: "none" })
  assert.deepEqual(plain(model.resolveSection(collections, data)), { type: "collections" })
})

test("without devices, device sections fall back to their own link or are left out", () => {
  const bare = { ...data, devices: [] }
  assert.deepEqual(plain(model.resolveSection(phone, bare)), { type: "link", href: "/shop/" })
  assert.deepEqual(plain(model.resolveSection(earbuds, bare)), { type: "none" })
  assert.deepEqual(plain(model.familiesOf(phone, bare)), [])
})

test("collectionsFor keeps the mode's collections by mask, up to the limit", () => {
  assert.deepEqual(plain(model.collectionsFor(data, "women", 8)).map((c) => c[0]), ["leopard", "floral", "pastel"])
  assert.deepEqual(plain(model.collectionsFor(data, "men", 8)).map((c) => c[0]), ["leopard", "marble", "pastel", "cars"])
  assert.deepEqual(plain(model.collectionsFor(data, "men", 2)).map((c) => c[0]), ["leopard", "marble"])
  assert.deepEqual(plain(model.collectionsConfig(collections)), { title: "Collections", view_all_href: "/collections/", limit: 3 })
  assert.deepEqual(plain(model.collectionsConfig({ ...collections, label: "Shop by collection", config: null })), { title: "Shop by collection", view_all_href: "/collections/", limit: 8 }, "defaults for a missing config")
})

test("the no-match hint suggests models from the list itself", () => {
  assert.deepEqual(plain(model.exampleQueries(model.modelsOf(data, "iphone"))), ["17 Pro Max", "16 Pro Max"])
  assert.deepEqual(plain(model.exampleQueries([...model.modelsOf(data, "iphone"), ...model.modelsOf(data, "samsung")])), ["17 Pro Max", "S26 Ultra"])
  assert.deepEqual(plain(model.exampleQueries(model.modelsOf(data, "airpods"))), ["AirPods 4", "AirPods Pro 3"])
  assert.deepEqual(plain(model.exampleQueries([])), [])
  assert.equal(model.modelCount(1), "1 model")
  assert.equal(model.modelCount(27), "27 models")
})
