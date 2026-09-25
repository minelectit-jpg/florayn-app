const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(filename, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] ?? require(name) })
  return exports
}
const src = (relative) => path.join(__dirname, "../src", relative)
/** A .tsx component, with its imports stubbed as given (the rest from node_modules). */
function loadTsx(relative, dependencies) {
  const filename = src(relative)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, process: { env: {} }, URLSearchParams, require: (name) => dependencies[name] ?? require(name) }, { filename })
  return exports
}
const normalize = load(src("lib/search/normalize.ts"))
const engine = load(src("lib/search/engine.ts"), { "./normalize": normalize })
const { sortNewestFirst } = load(src("lib/device-order.ts"))
const { DEFAULT_PRESENTATION } = load(src("lib/storefront-presentation.ts"))
const plain = (v) => JSON.parse(JSON.stringify(v))
const catalog = (file) => load(path.join(__dirname, "../../backend/src/modules/catalog/data", file))

// The real device catalogue (the backend seed), plus the iPhone 16e the live
// store lists, in /store/devices order: each family newest first.
const { DEVICES } = catalog("devices.ts")
const seeded = [...DEVICES]
seeded.splice(seeded.findIndex((d) => d.slug === "iphone-16"), 0, { slug: "iphone-16e", name: "iPhone 16e", family: "iphone" })
const devices = sortNewestFirst(seeded, (d) => d.name, (d) => d.family)
const dv = devices.map((d) => [d.slug, d.name, d.family, d.slug === "iphone-17-pro-max" ? "New" : null])
const at = (slug) => {
  const i = dv.findIndex((d) => d[0] === slug)
  assert.ok(i >= 0, `no device ${slug}`)
  return i
}

// Case types as the backend builds them (v2): [slug, name, fromPrice, forms,
// sold (dv indexes), price, groups ([price, dv indexes]), folder], sold from
// the seed's real links (CASE_TYPE_DEVICES).
const { CASE_TYPE_DEVICES } = catalog("design-devices.ts")
const formOfFamily = (family) => (family === "iphone" || family === "samsung" ? "phone" : family)
const sold = (slugs, ...forms) => slugs.map(at).filter((i) => !forms.length || forms.includes(formOfFamily(dv[i][2]))).sort((a, b) => a - b)
function caseType(slug, name, price, made, groups = [], folder = "") {
  const forms = ["phone", "airpods", "watch", "wallet"].filter((form) => made.some((i) => formOfFamily(dv[i][2]) === form))
  return [slug, name, Math.min(price, ...groups.map((g) => g[0])), forms, made, price, groups, folder]
}
const ALC = CASE_TYPE_DEVICES.alcantara
const ct = [
  caseType("signature", "Signature", 1400, sold(CASE_TYPE_DEVICES.signature, "phone")),
  // iPhones only: never a Samsung.
  caseType("elite-clear", "Elite Clear", 1600, sold(CASE_TYPE_DEVICES["elite-clear"])),
  // Phone shells 3,800; the AirPods, watch band and wallets cost less.
  caseType("alcantara", "Alcantara", 3800, sold(ALC), [[2100, sold(ALC, "airpods")], [2200, sold(["apple-watch-band", "magsafe-wallet"])], [1900, sold(["card-wallet"])]]),
  // The AirPods renders stay in each design's signature folder.
  caseType("signature-earbuds", "Signature Earbuds", 750, sold(CASE_TYPE_DEVICES["signature-earbuds"]), [], "signature"),
  // iPhone 13 to 16 only.
  caseType("essentials", "Essentials", 1400, sold(CASE_TYPE_DEVICES.essentials)),
]
const [SIG, ELITE, ALCANTARA, EARBUDS, ESSENTIALS] = [0, 1, 2, 3, 4]
// Collections: [slug, title, image, aud]
const col = [
  ["wild", "Wild Prints", "site/wild.jpg", 3],
  ["florals", "Florals", "", 1],
  ["classics", "Gentleman Classics", "", 2],
]
const PRO_MAX = at("iphone-17-pro-max")
const PLUS = sold(["iphone-14-plus", "iphone-15-plus", "iphone-16-plus"])
// Products, newest first: [handle, name, designSlug, form, aud, ct, col, thumb, fromPrice, notSold, pics, facts]
const p = [
  ["leopard-rose", "Leopard Rose", "leopard-rose", "phone", 3, [SIG, ELITE], 0, [SIG, PRO_MAX], 1400, [], 1, []],
  ["leopard-noir", "Leopard Noir", "leopard-noir", "phone", 2, [SIG], 0, [SIG, PRO_MAX], 1400, [at("iphone-13-pro")], 1, []],
  ["leopard-blush", "Leopard Blush", "leopard-blush", "phone", 1, [SIG, ALCANTARA], 0, [SIG, PRO_MAX], 1400, [], 1, []],
  ["leopard-classic-airpods", "Leopard Classic", "leopard-classic", "airpods", 3, [EARBUDS], 0, [EARBUDS, at("airpods-pro-3")], 750, [], 1, []],
  ["leopard-classic", "Leopard Classic", "leopard-classic", "phone", 3, [SIG], 0, [SIG, PRO_MAX], 1400, [], 1, []],
  ["daisy-field", "Daisy Field", "daisy-field", "phone", 1, [SIG], 1, [SIG, PRO_MAX], 1400, [], 1, []],
  ["tiger-stripe", "Tiger Stripe", "tiger-stripe", "phone", 2, [SIG], 2, [SIG, PRO_MAX], 1400, [], 1, []],
  ["rose-garden", "Rose Garden", "rose-garden", "phone", 1, [SIG], 1, "", null, [], 0, []],
  ["stickpad-pro", "StickPad Pro", "", "product", 3, [], -1, "https://img.florayn.com/stickpad.webp", 450, [], 0, []],
  // The live game-night: Signature leaves out the Plus phones it sells in Elite Clear.
  ["game-night", "Game Night", "game-night", "phone", 3, [SIG, ELITE], -1, [SIG, PRO_MAX], 1400, [], 1, [[SIG, PLUS]]],
  // An admin upload (versioned file names under designs/): no render is promised.
  // Its iPhone 16 Plus variant is in a style that is switched off.
  ["moon-phase", "Moon Phase", "moon-phase", "phone", 3, [SIG], -1, "designs/moon-phase/signature/iphone-17/1-01JABCDEF.webp", 1400, [], 0, [[SIG, [at("iphone-16-plus")]]]],
  // Its own prices: Signature at 1,500, but 1,400 for the iPhone 16; renders under designs/.
  ["velvet-crown", "Velvet Crown", "velvet-crown", "phone", 3, [SIG, ALCANTARA], -1, [SIG, PRO_MAX], 1400, [], "designs/velvet-crown", [[SIG, [], 1500, [[1400, [at("iphone-16")]]]]]],
]
const index = {
  v: 2,
  img: "https://pub-x.r2.dev",
  ct,
  dv,
  col,
  p,
  cat: [["StickPad", "/product/stickpad-pro/", "", 3], ["Phone Charm", "/product/phone-charm/", "", 3]],
  syn: DEFAULT_PRESENTATION.search.synonyms.map((row) => [row.words, row.means]),
  sug: { w: ["iPhone 17 Pro Max"], m: ["Samsung S26 Ultra"] },
  help: ["Can't find your model? Message us", "/contact/"],
  ph: "Search designs or models",
}
const P = engine.prepare(index)
const forms = Object.fromEntries(ct.map((c) => [c[0], c[3]]))
const links = engine.linkContext(
  [
    { kind: "devices", config: { families: ["iphone", "samsung"], case_type: "signature" } },
    { kind: "devices", config: { families: ["airpods"], case_type: "signature-earbuds" } },
    { kind: "case_types", config: { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/" } } },
  ],
  forms,
)
// The owner set "Case type for model links" on the Phone Case section to Elite Clear.
const eliteLinks = engine.linkContext([{ kind: "devices", config: { families: ["iphone", "samsung"], case_type: "elite-clear" } }], forms)
const women = (q, extra = {}) => engine.search(P, q, { audience: "women", links, ...extra })
const name = (i) => (i == null ? null : dv[i][1])
const exact = (q) => name(engine.exactModel(P, q))
const models = (q, typing) => plain(women(q, { typing }).models.map(name))
const handles = (designs) => plain(designs.map((h) => p[h.p][0]))
const hitFor = (result, handle) => result.designs.find((h) => p[h.p][0] === handle)
const productAt = (handle) => p.findIndex((row) => row[0] === handle)

test("the fixture is the v2 shape the backend builds", () => {
  const types = fs.readFileSync(src("lib/search/types.ts"), "utf8")
  assert.match(types, /^ {2}v: 2$/m)
  assert.ok(ct.every((row) => row.length === 8) && p.every((row) => row.length === 12))
})

test("the index is prepared once per session", () => {
  assert.equal(engine.prepare(index), P)
})

test("'iphone 16' is iPhone 16, then its generation newest first, and Enter opens its shop", () => {
  assert.equal(exact("iphone 16"), "iPhone 16")
  assert.deepEqual(models("iphone 16").slice(0, 4), ["iPhone 16", "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus"])
  const i = engine.exactModel(P, "iphone 16")
  assert.equal(engine.modelHref(dv[i][0], dv[i][2], links), "/shop/iphone-16/signature/")
  assert.equal(engine.modelLink(P, i, links), "/shop/iphone-16/signature/")
})

test("numbers never cross generations", () => {
  for (const typing of [false, true]) {
    assert.ok(models("16", typing).length > 0)
    assert.ok(models("16", typing).every((m) => /\b16/.test(m)), "'16' never returns an iPhone 15 model")
    assert.ok(!models("15", typing).includes("iPhone 16e"), "'15' never returns the iPhone 16e")
    assert.ok(models("15", typing).every((m) => /\b15\b/.test(m)))
  }
  assert.equal(exact("16"), "iPhone 16")
  assert.equal(exact("16e"), "iPhone 16e")
  assert.equal(exact("samsung 15"), null, "a brand must be the model's own")
})

test("shortcuts, Bangla and typos in model names", () => {
  assert.equal(exact("15pm"), "iPhone 15 Pro Max")
  assert.equal(exact("s24u"), "Samsung S24 Ultra")
  assert.equal(exact("samsung 24 ultra"), "Samsung S24 Ultra")
  assert.equal(exact("galaxy s24 ultra"), "Samsung S24 Ultra")
  assert.equal(exact("আইফোন ১৫"), "iPhone 15")
  assert.equal(exact("ipone 15 pro max cover"), "iPhone 15 Pro Max")
  assert.equal(exact("airpods 2"), "AirPods 1/2")
  assert.equal(models("airpods 2")[0], "AirPods 1/2")
  assert.notEqual(exact("airpods 2"), "AirPods Pro 2")
  assert.equal(exact("airpods pro 2"), "AirPods Pro 2")
  assert.equal(exact("16 pro"), "iPhone 16 Pro")
})

test("words that are not only a model are never an exact model", () => {
  assert.equal(exact("leopard 13 pro"), null)
  assert.equal(exact("iphone"), null)
  assert.equal(exact("iphone 16 pr"), null, "Enter does not guess a word being typed")
})

test("while typing, the last word may be the start of a model word", () => {
  assert.equal(name(women("17 pr", { typing: true }).model), "iPhone 17 Pro")
  assert.deepEqual(models("iphone 1", true).slice(0, 3), ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air"])
  assert.ok(women("iphone 1", { typing: true }).designs.length > 0, "a number on its way is not a design word")
  assert.deepEqual(models("iphone").slice(0, 3), ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air"])
})

test("a number still being typed is no model: '1' is not AirPods 1/2, but 'airpods 2' is", () => {
  for (const q of ["1", "2", "leopard 1", "leopard 2", "s2"]) assert.equal(name(women(q, { typing: true }).model), null, q)
  const leopard = handles(women("leopard 1", { typing: true }).designs)
  assert.ok(leopard.includes("leopard-rose") && leopard.includes("leopard-classic"), "the Leopard phone cases stay")
  assert.ok(!leopard.includes("leopard-classic-airpods"))
  assert.equal(name(women("airpods 2", { typing: true }).model), "AirPods 1/2", "another word names the model too")
  assert.equal(name(women("airpods pro 2", { typing: true }).model), "AirPods Pro 2")
  assert.equal(name(women("leopard 15", { typing: true }).model), "iPhone 15", "a number no longer one is a model")
  assert.equal(exact("1"), null, "Enter on a bare 1 opens no AirPods shop")
  assert.equal(exact("2"), null)
  assert.equal(exact("airpods 1"), "AirPods 1/2")
  // /search (not typing) reads the words the same way.
  assert.equal(name(women("1").model), null)
  assert.ok(!handles(women("leopard 1").designs).includes("leopard-classic-airpods"), "no switch to AirPods designs")
  assert.equal(name(women("airpods 2").model), "AirPods 1/2")
})

test("'leoprd' finds the Leopard designs, one per design, the phone case first", () => {
  const result = women("leoprd")
  assert.equal(result.close, false)
  assert.deepEqual(handles(result.designs).sort(), ["leopard-blush", "leopard-classic", "leopard-noir", "leopard-rose"])
  assert.ok(result.designs.every((h) => h.marks.includes("leopard")))
})

test("'leopard 13 pro' keeps only Leopard designs made for the iPhone 13 Pro, linked and pictured for it", () => {
  const result = women("leopard 13 pro")
  assert.equal(name(result.model), "iPhone 13 Pro")
  assert.deepEqual(handles(result.designs).sort(), ["leopard-blush", "leopard-classic", "leopard-rose"])
  const rose = hitFor(result, "leopard-rose")
  assert.deepEqual(plain(engine.designLink(P, rose)), {
    href: "/product/leopard-rose-iphone-13-pro/?case=signature",
    src: "https://pub-x.r2.dev/leopard-rose/signature/iphone-13-pro/1.webp",
    fallback: "https://pub-x.r2.dev/leopard-rose/signature/iphone-17-pro-max/1.webp",
  })
  assert.equal(engine.designMeta(P, rose), "for iPhone 13 Pro · from ৳1,400")
})

test("an AirPods model keeps the AirPods designs on the earbuds case, pictured from the signature folder", () => {
  const result = women("leopard airpods pro 3")
  assert.equal(name(result.model), "AirPods Pro 3")
  assert.deepEqual(handles(result.designs), ["leopard-classic-airpods"])
  assert.deepEqual(plain(engine.designLink(P, result.designs[0])), {
    href: "/product/leopard-classic-airpods-airpods-pro-3/?case=signature-earbuds",
    src: "https://pub-x.r2.dev/leopard-classic/signature/airpods-pro-3/1.webp",
    fallback: "https://pub-x.r2.dev/leopard-classic/signature/airpods-pro-3/1.webp",
  })
  assert.equal(engine.renderUrl(P, productAt("leopard-classic-airpods"), EARBUDS, at("airpods-4")), "https://pub-x.r2.dev/leopard-classic/signature/airpods-4/1.webp")
})

test("a design link opens only on a style the design sells for that model", () => {
  const game = productAt("game-night")
  assert.equal(engine.sells(P, game, SIG, at("iphone-16-plus")), false, "its Signature has no Plus")
  assert.equal(engine.sells(P, game, ELITE, at("iphone-16-plus")), true)
  assert.equal(engine.sells(P, game, ELITE, at("samsung-s24")), false, "Elite Clear is not made for a Samsung")
  assert.equal(engine.sells(P, game, SIG, at("samsung-s24")), true)

  const typed = women("game night 16 plus")
  assert.equal(name(typed.model), "iPhone 16 Plus")
  const plus = hitFor(typed, "game-night")
  assert.equal(plus.ct, ELITE, "the menu's Signature is not sold for it: Elite Clear is")
  assert.deepEqual(plain(engine.designLink(P, plus)), {
    href: "/product/game-night-iphone-16-plus/?case=elite-clear",
    src: "https://pub-x.r2.dev/game-night/elite-clear/iphone-16-plus/1.webp",
    fallback: "https://pub-x.r2.dev/game-night/signature/iphone-17-pro-max/1.webp",
  })
  assert.equal(engine.designMeta(P, plus), "for iPhone 16 Plus · from ৳1,600", "the price it is sold at for that model")
  const remembered = hitFor(women("game night", { device: "iphone-16-plus" }), "game-night")
  assert.equal(engine.designLink(P, remembered).href, "/product/game-night-iphone-16-plus/?case=elite-clear")
  const pro = hitFor(women("game night 16 pro"), "game-night")
  assert.equal(engine.designLink(P, pro).href, "/product/game-night-iphone-16-pro/?case=signature", "the menu's style where it is sold")
  const samsung = hitFor(engine.search(P, "game night s24", { audience: "women", links: eliteLinks }), "game-night")
  assert.equal(engine.designLink(P, samsung).href, "/product/game-night-samsung-s24/?case=signature", "the menu's Elite Clear is no Samsung case")

  // No switched-on style sells it for that model (its Plus variant is in one
  // that is off): the design's own page, picture and prices, not the Plus one's.
  const moon = hitFor(women("moon phase", { device: "iphone-16-plus" }), "moon-phase")
  assert.deepEqual([moon.device, moon.ct], [null, null])
  assert.equal(engine.designLink(P, moon).href, "/product/moon-phase/")
  assert.equal(engine.designMeta(P, moon), "from ৳1,400")
})

test("pictures come from the index, never a naming rule: an upload shows its own thumbnail", () => {
  const moon = hitFor(women("moon phase", { device: "iphone-17" }), "moon-phase")
  const upload = "https://pub-x.r2.dev/designs/moon-phase/signature/iphone-17/1-01JABCDEF.webp"
  assert.deepEqual(plain(engine.designLink(P, moon)), { href: "/product/moon-phase-iphone-17/?case=signature", src: upload, fallback: upload })
  assert.equal(engine.renderUrl(P, productAt("moon-phase"), SIG, at("iphone-17")), "", "renders not known")
  const velvet = hitFor(women("velvet crown 16 pro"), "velvet-crown")
  assert.equal(engine.designLink(P, velvet).src, "https://pub-x.r2.dev/designs/velvet-crown/signature/iphone-16-pro/1.webp", "renders under another folder")
  assert.equal(engine.thumbUrl(P, productAt("velvet-crown")), "https://pub-x.r2.dev/designs/velvet-crown/signature/iphone-17-pro-max/1.webp")
})

test("prices per style and model: a design's own prices, else its style's per-device ones", () => {
  const velvet = productAt("velvet-crown")
  assert.equal(engine.pairPrice(P, velvet, SIG, PRO_MAX), 1500)
  assert.equal(engine.pairPrice(P, velvet, SIG, at("iphone-16")), 1400)
  assert.equal(engine.pairPrice(P, velvet, ALCANTARA, PRO_MAX), 3800)
  assert.deepEqual(plain(engine.designPrices(P, velvet, PRO_MAX)), [1500, 3800])
  assert.deepEqual(plain(engine.designPrices(P, velvet, at("iphone-16"))), [1400], "Alcantara is not made for the iPhone 16")
  assert.deepEqual(plain(engine.designPrices(P, velvet, null)), [1400, 1500, 3800])
})

test("each mode's own designs first, then both, then the other mode's", () => {
  assert.deepEqual(handles(women("leopard").designs), ["leopard-blush", "leopard-rose", "leopard-classic", "leopard-noir"])
  assert.deepEqual(handles(engine.search(P, "leopard", { audience: "men" }).designs), ["leopard-noir", "leopard-rose", "leopard-classic", "leopard-blush"])
  const women_ = engine.forMode(P, women("leopard").designs, "women")
  assert.equal(women_.other, false)
  assert.ok(!handles(women_.designs).includes("leopard-noir"), "a Men design is not listed in Women")
  const tiger = engine.forMode(P, women("tiger").designs, "women")
  assert.equal(tiger.other, true, "nothing in Women: the Men designs show under a note")
  assert.deepEqual(handles(tiger.designs), ["tiger-stripe"])
})

test("the remembered phone links the designs that fit it and breaks ties", () => {
  const result = women("leopard", { device: "iphone-13-pro" })
  const noir = hitFor(result, "leopard-noir")
  assert.equal(noir.device, null, "not made for the remembered phone: its own page")
  const rose = hitFor(result, "leopard-rose")
  assert.equal(engine.designLink(P, rose).href, "/product/leopard-rose-iphone-13-pro/?case=signature")
})

test("a word that matches nothing falls back to any word, as Close matches", () => {
  const result = women("leopard zzzz")
  assert.equal(result.close, true)
  assert.ok(result.designs.length > 0)
  assert.equal(women("zzzz").designs.length, 0)
})

test("collections, styles and categories", () => {
  assert.deepEqual(women("wild").collections.map((k) => col[k][0]), ["wild"])
  assert.deepEqual(women("gentleman").collections, [], "a Men collection is not listed in Women")
  assert.deepEqual(women("alcantara").styles.map((k) => ct[k][0]), ["alcantara"])
  assert.equal(engine.styleHref(P, ALCANTARA, null, links), "/collection/alcantara/", "the admin's link wins")
  assert.equal(engine.styleHref(P, ELITE, null, links), "/shop/iphone-17-pro-max/elite-clear/", "else the newest model it is made for")
  assert.equal(engine.styleHref(P, ELITE, at("iphone-15"), links), "/shop/iphone-15/elite-clear/")
  assert.equal(engine.styleHref(P, EARBUDS, at("iphone-15"), links), "/shop/airpods-4/signature-earbuds/", "the phone does not fit an earbuds case: the newest AirPods")
  assert.deepEqual(women("stickpad").categories.map((k) => index.cat[k][0]), ["StickPad"])
  assert.deepEqual(handles(women("stickpad").designs), ["stickpad-pro"])
  assert.equal(engine.designLink(P, women("stickpad").designs[0]).src, "https://img.florayn.com/stickpad.webp", "other hosts stay absolute")
})

test("style links never open a shop the style has nothing in", () => {
  assert.equal(engine.styleHref(P, ELITE, at("samsung-s24"), links), "/shop/iphone-17-pro-max/elite-clear/", "no Elite Clear for a Samsung: the newest phone it is made for")
  assert.equal(engine.styleHref(P, ESSENTIALS, at("iphone-12"), links), "/shop/iphone-16-pro-max/essentials/", "no Essentials for an iPhone 12")
  assert.equal(engine.styleHref(P, ESSENTIALS, at("iphone-15"), links), "/shop/iphone-15/essentials/")
  assert.equal(engine.styleHref(P, ALCANTARA, at("airpods-max"), undefined), "/shop/airpods-4/alcantara/", "an AirPods it is not made for: the newest AirPods it is")
  assert.equal(engine.styleHref(P, ALCANTARA, at("card-wallet"), undefined), "/shop/card-wallet/alcantara/")
  assert.ok(!women("s24 elite clear").styles.includes(ELITE), "a model found keeps only the styles made for it")
  assert.ok(women("iphone 16 elite clear").styles.includes(ELITE))
  // Model links: the menu's case type only where it is made for that model.
  assert.equal(engine.modelLink(P, at("iphone-16"), eliteLinks), "/shop/iphone-16/elite-clear/")
  assert.equal(engine.modelLink(P, at("samsung-s24"), eliteLinks), "/shop/samsung-s24/", "never an empty Elite Clear shop for a Samsung")
  assert.equal(engine.modelLink(P, at("airpods-pro-3"), links), "/shop/airpods-pro-3/signature-earbuds/")
})

test("a style's from price is for the model its link opens, never another form's lower price", () => {
  assert.equal(ct[ALCANTARA][2], 1900, "its lowest price anywhere is the card wallet's")
  assert.equal(engine.stylePrice(P, ALCANTARA, null), 3800, "no model: as a phone case")
  assert.equal(engine.stylePrice(P, ALCANTARA, at("iphone-17-pro")), 3800)
  assert.equal(engine.stylePrice(P, ALCANTARA, at("samsung-s24")), 3800, "a phone it is not made for: its phone price")
  assert.equal(engine.stylePrice(P, ALCANTARA, at("airpods-pro-3")), 2100)
  assert.equal(engine.stylePrice(P, ALCANTARA, at("airpods-max")), 2100, "the AirPods its link opens")
  assert.equal(engine.stylePrice(P, ALCANTARA, at("card-wallet")), 1900)
  assert.equal(engine.stylePrice(P, EARBUDS, at("iphone-15")), 750)
  assert.equal(engine.stylePrice(P, ELITE, null), 1600)
  assert.equal(engine.formPrice(P, ALCANTARA, "watch"), 2200)
})

test("design scoring: exact, the start of the last word, and a slip", () => {
  assert.deepEqual(handles(women("leop", { typing: true }).designs).length, 4)
  assert.equal(women("leop zzzz").close, true, "only the last word may be a start")
  assert.deepEqual(handles(women("daisy").designs), ["daisy-field"])
  assert.deepEqual(handles(women("dasiy").designs), ["daisy-field"], "a swap is one slip")
  assert.deepEqual(handles(women("rose").designs)[0], "rose-garden", "the name outranks the collection")
  assert.deepEqual(women("cheetah").designs.length, 4, "admin synonyms apply")
  assert.deepEqual(handles(women("leopard clear").designs), ["leopard-rose"], "case types are searchable")
})

test("didYouMean offers the nearest catalogue word", () => {
  assert.equal(engine.didYouMean(P, "leopord"), "leopard")
  assert.equal(engine.didYouMean(P, "leopard"), null)
  assert.equal(engine.didYouMean(P, "qqqqqqqq"), null)
})

test("links and labels", () => {
  assert.equal(engine.modelHref("airpods-pro-3", "airpods", links), "/shop/airpods-pro-3/signature-earbuds/")
  assert.equal(engine.modelHref("apple-watch-band", "watch", links), "/shop/apple-watch-band/", "no section: the model's first style")
  const unsold = engine.linkContext([{ kind: "devices", config: { families: ["airpods"], case_type: "signature" } }], forms)
  assert.equal(engine.modelHref("airpods-pro-3", "airpods", unsold), "/shop/airpods-pro-3/", "a phone case type never opens an AirPods shop")
  assert.equal(engine.taka(3800), "৳3,800")
  assert.deepEqual(engine.newestPerFamily(P).map(name), ["iPhone 17 Pro Max", "Samsung S26 Ultra", "AirPods 4", "Apple Watch Band", "Card Wallet"])
  assert.deepEqual(plain(engine.marked(P, "Leopard Rose", ["leopard"])), [["Leopard", true], [" ", false], ["Rose", false]])
  const rose = women("rose").designs[1]
  assert.equal(engine.designMeta(P, rose), "Wild Prints · from ৳1,400")
})

// --- The /search page ----------------------------------------------------------

const React = require("react")
const remembered = load(src("lib/remembered-device.ts"))
const { renderToStaticMarkup } = require("react-dom/server")
const audienceLib = load(src("lib/audience.ts"))
let address = ""
const searchPage = loadTsx("components/search/search-page-client.tsx", {
  "next/navigation": { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams(address) },
  "@/components/audience-link": { __esModule: true, default: ({ href, children, prefetch: _prefetch, ...props }) => React.createElement("a", { href, ...props }, children) },
  "@/components/product-card": { __esModule: true, default: () => null },
  "@/lib/audience": audienceLib,
  "@/lib/remembered-device": { ...remembered, readDevice: () => null },
  "@/lib/search/engine": engine,
  "@/lib/search/load-index": { loadSearchIndex: () => new Promise(() => {}) },
})

test("/search is one static HTML for every ?q=: nothing that depends on the words renders before hydration", () => {
  const render = (query) => {
    address = query
    return renderToStaticMarkup(React.createElement(searchPage.default, {
      audience: "women", links, placeholder: "Search designs or models", suggest: ["Alcantara"], help: { label: "Help", href: "/contact/" }, rememberDevice: true,
    }))
  }
  const blank = render("")
  // The server (and React while hydrating) uses the no-words snapshot, so the
  // browser's first render of /search/?q=leopard is this same markup (no #418).
  assert.equal(render("q=leopard"), blank)
  assert.equal(render("q=iphone+16"), blank)
  assert.match(blank, /aria-busy="true"/, "the skeleton, not the Try chips")
  assert.doesNotMatch(blank, /leopard|Alcantara/)
  for (const file of ["app/search/page.tsx", "app/men/search/page.tsx"]) {
    const code = fs.readFileSync(src(file), "utf8")
    assert.match(code, /^export const dynamic = "force-static"$/m, `${file} stays static`)
    assert.doesNotMatch(code, /searchParams|cookies\(|headers\(/, `${file} reads nothing per request`)
  }
  const page = fs.readFileSync(src("components/pages/search-page.tsx"), "utf8")
  assert.match(page, /export default async function SearchPage\(\{ audience \}: \{ audience: Audience \}\)/, "no searchParams prop")
  assert.doesNotMatch(page, /from "next\/headers"/)
})

test("/search cards carry the exact price of the style and model they name", () => {
  const { cardFor } = searchPage
  const price = (card) => {
    const scoped = card.product.variants.filter((v) => [card.device, card.caseType].filter(Boolean).every((value) => v.options.some((o) => o.value === value)))
    return plain(scoped.map((v) => v.calculated_price?.calculated_amount))
  }

  // The owner's model links open Elite Clear: the card says Elite Clear at its 1,600, not the design's 1,400.
  const rose = hitFor(engine.search(P, "leopard rose 16", { audience: "women", links: eliteLinks }), "leopard-rose")
  const roseCard = cardFor(P, rose)
  assert.deepEqual([roseCard.device, roseCard.deviceSlug, roseCard.caseType, roseCard.caseTypeSlug], ["iPhone 16", "iphone-16", "Elite Clear", "elite-clear"])
  assert.deepEqual(price(roseCard), [1600])
  assert.deepEqual(roseCard.product.variants.map((v) => v.id), ["", ""], "no variant id: no Quick Add from search")

  const velvet = cardFor(P, hitFor(women("velvet crown 17 pro max"), "velvet-crown"))
  assert.deepEqual([velvet.caseType, price(velvet)], ["Signature", [1500]], "a design's own price")
  assert.deepEqual(price(cardFor(P, hitFor(women("velvet crown 16"), "velvet-crown"))), [1400])
  const plus = cardFor(P, hitFor(women("game night 16 plus"), "game-night"))
  assert.deepEqual([plus.caseType, price(plus)], ["Elite Clear", [1600]])

  // No model: every price it has, so the card reads "From".
  const anyModel = cardFor(P, hitFor(women("velvet crown"), "velvet-crown"))
  assert.equal(anyModel.caseType, null)
  assert.deepEqual(price(anyModel).sort((a, b) => a - b), [1400, 1500, 3800])

  // Pictures: the model's render only when renders are known, else the design's own.
  assert.deepEqual(plain(velvet.product.variants.find((v) => v.options[1].value === "Signature").metadata.images), ["https://pub-x.r2.dev/designs/velvet-crown/signature/iphone-17-pro-max/1.webp"])
  const moon = cardFor(P, hitFor(women("moon phase", { device: "iphone-17" }), "moon-phase"))
  assert.deepEqual(plain(moon.product.variants.map((v) => v.metadata.images)), [[]], "no guessed render: the card shows the thumbnail")
  assert.equal(moon.product.thumbnail, "https://pub-x.r2.dev/designs/moon-phase/signature/iphone-17/1-01JABCDEF.webp")
})

// --- The search sheet --------------------------------------------------------------

// The sheet body is in every page's HTML (inside dialog#site-search), so the
// first tap can focus a real input and bring the phone keyboard up.
const sheet = loadTsx("components/header/search-sheet.tsx", {
  "next/navigation": { useRouter: () => ({ push() {} }) },
  "@/components/header/intent-link": { __esModule: true, default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "@/lib/audience": audienceLib,
  "@/lib/remembered-device": { ...remembered, readDevice: () => null },
  "@/lib/search/load-index": { preloadSearchIndex() {} },
  "./load-on-intent": loadTsx("components/header/load-on-intent.tsx", {}),
  "./types": load(src("components/header/types.ts")),
})

test("the search sheet's SSR markup: the input, the search form and the Try chips", () => {
  const data = {
    women: [], men: null, devices: [], caseTypes: [], collections: [], families: {}, drawerLinks: [], rememberDevice: true,
    search: { placeholder: "Search designs or models", suggest: { women: ["Alcantara"], men: ["iPhone 17 Pro Max", "Samsung S26 Ultra"] }, help: { label: "Help", href: "/contact/" } },
  }
  const html = renderToStaticMarkup(React.createElement(sheet.default, { data, audience: "men", onClose() {} }))
  const input = html.match(/<input[^>]*>/)[0]
  for (const attribute of ['id="site-search-input"', 'name="q"', 'type="search"', 'enterKeyHint="search"', 'autoComplete="off"', 'autoCapitalize="none"', 'spellCheck="false"', 'aria-label="Search"', 'aria-controls="search-results"', 'placeholder="Search designs or models"']) {
    assert.ok(input.includes(attribute), `${attribute} in ${input}`)
  }
  const form = html.match(/<form[^>]*>/)[0]
  for (const attribute of ['role="search"', 'action="/men/search/"', 'method="get"']) assert.ok(form.includes(attribute), `${attribute} in ${form}`)
  assert.match(html, /id="search-results"/)
  assert.match(html, /aria-label="Close search"/)
  assert.match(html, />iPhone 17 Pro Max<\/button>.*>Samsung S26 Ultra<\/button>/, "this mode's Try chips")
  assert.doesNotMatch(html, /Popular|Trending/)
  assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>).)*<button/s, "no button inside a link")
  assert.match(html, /aria-live="polite"/)
})

test("arrow keys move through the results, never while an input method is composing", () => {
  const key = (k, extra = {}) => sheet.isListKey({ key: k, keyCode: 40, nativeEvent: { isComposing: false }, ...extra })
  assert.equal(key("ArrowDown"), true)
  assert.equal(key("ArrowUp"), true)
  assert.equal(key("Home"), true)
  assert.equal(key("End"), true)
  assert.equal(key("ArrowDown", { nativeEvent: { isComposing: true } }), false, "a candidate list owns the arrows (Safari names the key)")
  assert.equal(key("ArrowDown", { keyCode: 229 }), false, "Safari, just as composition ends")
  assert.equal(key("Process", { keyCode: 229, nativeEvent: { isComposing: true } }), false, "Chrome and Firefox")
  assert.equal(key("ArrowDown", { altKey: true }), false)
  assert.equal(key("ArrowDown", { metaKey: true }), false)
  assert.equal(key("a"), false)
  const code = fs.readFileSync(src("components/header/search-sheet.tsx"), "utf8")
  assert.match(code, /function onKeyDown\([^)]*\) \{\s*if \(!isListKey\(event\)\) return/, "the sheet's handler asks first")
})

test("the sheet's 'Cases for' chip and remembered model are a phone only: a stale AirPods or wallet slug reads as none", () => {
  const render = (stored) => {
    // Effects run once, during the render, so the remembered slug is read.
    const ran = new Set()
    const react = { ...React, useEffect: (effect) => { const k = String(effect); if (ran.has(k)) return; ran.add(k); try { effect() } catch {} } }
    const Sheet = loadTsx("components/header/search-sheet.tsx", {
      react,
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "@/components/header/intent-link": { __esModule: true, default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
      "@/lib/audience": audienceLib,
      "@/lib/remembered-device": { ...remembered, readDevice: () => stored },
      "@/lib/search/load-index": { preloadSearchIndex() {} },
      "./load-on-intent": loadTsx("components/header/load-on-intent.tsx", {}),
      "./types": load(src("components/header/types.ts")),
    }).default
    const data = {
      women: [], men: null, caseTypes: [], collections: [], families: {}, drawerLinks: [], rememberDevice: true,
      devices: [["iphone-15", "iPhone 15", "iphone", null], ["airpods-pro-3", "AirPods Pro 3", "airpods", null], ["card-wallet", "Card Wallet", "wallet", null]],
      search: { placeholder: "Search", suggest: { women: [], men: [] }, help: { label: "Help", href: "/contact/" } },
    }
    return renderToStaticMarkup(React.createElement(Sheet, { data, audience: "women", onClose() {} }))
  }
  assert.match(render("iphone-15"), /Cases for iPhone 15/)
  for (const stale of ["airpods-pro-3", "card-wallet", "iphone-99", null]) assert.doesNotMatch(render(stale), /Cases for/, String(stale))
  const page = fs.readFileSync(src("components/search/search-page-client.tsx"), "utf8")
  assert.match(page, /phoneOf\(device, index\.x\.dv\)/, "/search reads the remembered slug through phoneOf too")
})
