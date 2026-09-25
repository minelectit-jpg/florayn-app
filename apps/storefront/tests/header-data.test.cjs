const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const lib = path.join(__dirname, "../src/lib")
/** Load a storefront lib file and its value imports ("./x" or "@/lib/x"); `fetch` is the test's stub. */
function load(relative, context = {}) {
  const cache = new Map()
  function one(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = path.join(lib, `${name}.ts`)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText
    const exports = {}
    cache.set(name, exports)
    vm.runInNewContext(code, { exports, URL, process: { env: {} }, ...context, require(dep) {
      if (dep.startsWith("./")) return one(dep.slice(2))
      if (dep.startsWith("@/lib/")) return one(dep.slice(6))
      throw new Error(`Unexpected import ${dep}`)
    } }, { filename })
    return exports
  }
  return one(relative)
}

const { buildHeaderData, sectionsFor, AUDIENCE_BIT, packHeaderData, unpackHeaderData } = load("header-data")
const plain = (value) => JSON.parse(JSON.stringify(value))

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"
const section = (id, label, extra = {}) => ({ id, label, href: null, groups: [], kind: "links", image: null, badge: null, placement: "all", config: null, ...extra })
const content = (primary, primaryMen, extra = {}) => ({ sections: [], primary, primaryMen, footer: [], footerNote: "", social: [], collections: [], ...extra })
const card = (slug, extra = {}) => ({ slug, collection_id: `pcol_${slug}`, title: slug, image: null, artwork: null, theme: {}, ...extra })

test("men is null when the two menus differ only in ids, and a list when they differ", () => {
  const women = [section("msec_w1", "Phone Case", { kind: "devices", href: "/shop/", config: { families: ["iphone", "samsung"], case_type: null } })]
  const same = [section("msec_m1", "Phone Case", { kind: "devices", href: "/shop/", config: { families: ["iphone", "samsung"], case_type: null } })]
  assert.equal(buildHeaderData(content(women, same), [], []).men, null)
  assert.equal(buildHeaderData(content(women, []), [], []).men, null, "an empty Men menu falls back to Women")
  assert.equal(buildHeaderData(content(women, undefined), [], []).men, null)
  const other = [section("msec_m1", "Phone Case", { kind: "devices", href: "/shop/", badge: "New", config: { families: ["iphone", "samsung"], case_type: null } })]
  const data = buildHeaderData(content(women, other), [], [])
  assert.ok(Array.isArray(data.men))
  assert.equal(data.men[0].badge, "New")
  assert.deepEqual(plain(sectionsFor(data, "men", "drawer")).map((s) => s.id), ["msec_m1"])
  assert.deepEqual(plain(sectionsFor(data, "women", "drawer")).map((s) => s.id), ["msec_w1"])
})

test("devices keep their input order (newest first per family from /store/devices)", () => {
  const input = ["iphone-17-pro-max", "iphone-17-pro", "iphone-17-air", "iphone-17", "iphone-16-pro-max", "samsung-s26-ultra", "airpods-pro-3"]
  const devices = input.map((slug, i) => ({ id: `dev_${i}`, slug, name: slug, family: slug.split("-")[0], brand: "x", badge: i === 0 ? "New" : undefined }))
  const data = buildHeaderData(content([], []), [], devices)
  assert.deepEqual(data.devices.map((d) => d[0]), input)
  assert.deepEqual(plain(data.devices[0]), ["iphone-17-pro-max", "iphone-17-pro-max", "iphone", "New"])
  assert.equal(data.devices[1][3], null, "no badge is null, never undefined")
})

/** The cards a mode's menu can show, by mask, in order (what collectionsFor filters). */
const forMode = (data, mode) => plain(data.collections.filter((c) => (c[4] & AUDIENCE_BIT[mode]) !== 0).map((c) => c[0]))

test("collections hidden from the menu are dropped, and each mode gets at most 12", () => {
  const cards = Array.from({ length: 16 }, (_, i) => card(`c${i}`, { in_menu: i === 1 ? false : undefined, image: i === 0 ? `${R2}/c0.jpg` : null, artwork: i === 2 ? `${R2}/c2.webp` : null, audiences: i === 3 ? ["men"] : i === 4 ? ["women"] : undefined }))
  const data = buildHeaderData(content([], [], { collections: cards }), [], [])
  assert.ok(!data.collections.some((c) => c[0] === "c1"))
  assert.equal(forMode(data, "women").length, 12)
  assert.equal(forMode(data, "men").length, 12)
  assert.deepEqual(forMode(data, "women").slice(0, 4), ["c0", "c2", "c4", "c5"], "page order, the Men-only card skipped")
  assert.deepEqual(forMode(data, "men").slice(0, 4), ["c0", "c2", "c3", "c5"], "page order, the Women-only card skipped")
  assert.ok(!data.collections.some((c) => c[0] === "c14" || c[0] === "c15"), "nothing past both modes' twelfth")
  assert.deepEqual(plain(data.collections[0]), ["c0", "c0", `${R2}/c0.jpg`, 0, 3], "a campaign picture is cropped")
  assert.deepEqual(plain(data.collections[1]), ["c2", "c2", `${R2}/c2.webp`, 1, 3], "product artwork is contained")
  assert.equal(data.collections[2][4], AUDIENCE_BIT.men)
  assert.equal(data.collections[3][4], AUDIENCE_BIT.women)
  assert.equal(data.collections[4][2], null)
})

test("the cap is per mode: Men collections after twelve Women ones still reach the Men menu", () => {
  const women = Array.from({ length: 13 }, (_, i) => card(`w${i}`, { audiences: ["women"] }))
  const cards = [...women.slice(0, 12), card("m0", { audiences: ["men"] }), card("both", { audiences: ["women", "men"] }), women[12], card("m1", { audiences: ["men"] })]
  const data = buildHeaderData(content([], [], { collections: cards }), [], [])
  assert.deepEqual(forMode(data, "men"), ["m0", "both", "m1"], "a global cap of 12 would have left Men with nothing")
  assert.deepEqual(forMode(data, "women").slice(0, 12), women.slice(0, 12).map((c) => c.slug), "Women keeps its first twelve (the most a limit can show)")
  assert.ok(!data.collections.some((c) => c[0] === "w12"), "a thirteenth Women-only card is not sent")
  assert.ok(data.collections.some((c) => c[0] === "both"), "a card for both is kept while one mode has room")
})

test("a style's from-price is per form: Alcantara phone cases from 3800, though its card wallet is 1900", async () => {
  const dev = (slug, family, extra = {}) => ({ slug, family, is_active: true, ...extra })
  // The seed's real Alcantara: 3800 for phone shells, cheaper groups for everything else.
  const body = { case_types: [
    { slug: "signature", name: "Signature", is_active: true, price: 1400, price_groups: [], devices: [dev("iphone-17", "iphone"), dev("samsung-s26", "samsung")] },
    { slug: "alcantara", name: "Alcantara", is_active: true, price: 3800, image_url: `${R2}/site/case-types/alcantara-d3190c32.jpg`,
      price_groups: [
        { label: "AirPods cases", price: 2100, devices: ["airpods-4", "airpods-pro-3"] },
        { label: "MagSafe Wallet and Apple Watch Band", price: 2200, devices: ["magsafe-wallet", "apple-watch-band"] },
        { label: "Card Wallet", price: 1900, devices: ["card-wallet"] },
        { label: "Retired AirPods", price: 1500, devices: ["airpods-3"] },
      ],
      devices: [dev("iphone-17", "iphone"), dev("samsung-s26", "samsung"), dev("airpods-pro-3", "airpods"), dev("airpods-3", "airpods", { is_active: false }), dev("apple-watch-band", "watch"), dev("magsafe-wallet", "wallet"), dev("card-wallet", "wallet")] },
    { slug: "signature-earbuds", name: "Signature Earbuds", is_active: true, price: 750, devices: [dev("airpods-pro-3", "airpods")] },
    { slug: "retired", name: "Retired", is_active: false, price: 100 },
  ] }
  const content = load("content", { fetch: async () => ({ ok: true, json: async () => body }) })
  const caseTypes = await content.getCaseTypes()
  const alcantara = caseTypes.find((c) => c.slug === "alcantara")
  assert.deepEqual(plain(alcantara.fromPrices), { phone: 3800, airpods: 2100, watch: 2200, wallet: 1900 }, "an inactive device's cheaper group does not count")
  assert.equal(alcantara.fromPrice, 1900, "the overall lowest (a fallback only) is a price a shopper can pay")
  const data = buildHeaderData({ sections: [], primary: [], footer: [], footerNote: "", social: [], collections: [] }, caseTypes, [])
  assert.deepEqual(plain(data.caseTypes), [
    ["signature", "Signature", 1400, null, ["phone"], [1400]],
    ["alcantara", "Alcantara", 1900, `${R2}/site/case-types/alcantara-d3190c32.jpg`, ["phone", "airpods", "watch", "wallet"], [3800, 2100, 2200, 1900]],
    ["signature-earbuds", "Signature Earbuds", 750, null, ["airpods"], [750]],
  ])
  // The wire sends the per-form prices only where they differ from fromPrice.
  const wire = plain(packHeaderData(data))
  assert.equal(wire.c[0].length, 5, "Signature costs the same for every phone: no price list")
  assert.deepEqual(wire.c[1][5], [3800, 2100, 2200, 1900])
  assert.deepEqual(plain(unpackHeaderData(wire).caseTypes), plain(data.caseTypes))
})

test("an older backend without kind, placement or config gives plain link sections", () => {
  const old = { id: "msec_old", label: "Accessories", href: "/collection/accessories/", groups: [{ heading: "More", links: [{ id: "ml_1", label: "Charms", href: "/collection/charms/", badge: null }] }] }
  const [s] = buildHeaderData(content([old], []), [], []).women
  assert.deepEqual(plain(s), { id: "msec_old", label: "Accessories", href: "/collection/accessories/", kind: "links", image: null, badge: null, placement: "all", config: null, groups: [{ heading: "More", links: [{ label: "Charms", href: "/collection/charms/", badge: null }] }] })
})

test("automatic sections never carry their legacy links, and placement picks the surface", () => {
  const legacy = [{ heading: "iPhone 17 Series", links: [{ id: "ml_1", label: "iPhone 17", href: "/shop/iphone-17/", badge: null }] }]
  const data = buildHeaderData(content([
    section("a", "Phone Case", { kind: "devices", groups: legacy, config: { families: ["iphone"], case_type: null } }),
    section("b", "Styles", { kind: "case_types", placement: "bar", config: { form: "phone", exclude: [], links: {} } }),
    section("c", "Collections", { kind: "collections", placement: "drawer", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }),
    section("d", "Wallets", { kind: "links", href: "/collection/card-wallets/", config: { stray: true } }),
  ], []), [], [])
  assert.deepEqual(plain(data.women[0].groups), [])
  assert.equal(data.women[3].config, null, "a links section has no config")
  assert.deepEqual(plain(sectionsFor(data, "women", "bar")).map((s) => s.id), ["a", "b", "d"])
  assert.deepEqual(plain(sectionsFor(data, "women", "drawer")).map((s) => s.id), ["a", "c", "d"])
})

test("Admin > Navigation and Admin > Search reach the header; an older backend gets the defaults", () => {
  const defaults = buildHeaderData(content([], []), [], [])
  assert.equal(defaults.families.samsung, "Samsung Galaxy")
  assert.deepEqual(plain(defaults.drawerLinks), [{ label: "My account", href: "/account/" }, { label: "Help & contact", href: "/contact/" }])
  assert.equal(defaults.rememberDevice, true)
  assert.equal(defaults.search.placeholder, "Search")
  assert.equal(defaults.search.help.href, "/contact/")
  assert.ok(!("synonyms" in defaults.search), "synonyms go only into the search index")

  const set = buildHeaderData(content([], [], {
    navigation: { family_labels: { iphone: "Apple iPhone", samsung: "Galaxy", airpods: "AirPods", watch: "Watch", wallet: "Wallet" }, drawer_links: [{ label: "Track order", href: "/account/" }], remember_device: false },
    search: { placeholder: "Find a case", suggest_women: ["Leopard"], suggest_men: ["Carbon"], help_label: "Ask us", help_href: "/contact/" },
  }), [], [])
  assert.equal(set.families.iphone, "Apple iPhone")
  assert.equal(set.rememberDevice, false)
  assert.deepEqual(plain(set.search), { placeholder: "Find a case", suggest: { women: ["Leopard"], men: ["Carbon"] }, help: { label: "Ask us", href: "/contact/" } })
})

test("the wire form keeps site paths and other hosts as they are", () => {
  if (typeof packHeaderData !== "function") return
  const data = buildHeaderData(content([
    section("a", "Phone Case", { image: `${R2}/site/menu/a.webp` }),
    section("b", "Charms", { image: "/brand/charms.png" }),
    section("c", "Gifts", { image: "https://img.florayn.com/gifts.jpg" }),
    section("d", "Wallets", { image: `${R2}/site/menu/d.webp` }),
  ], []), [], [{ id: "d1", slug: "galaxy-s26", name: "Samsung Galaxy S26", family: "samsung", brand: "samsung", badge: null }])
  const back = unpackHeaderData(plain(packHeaderData(data)))
  assert.deepEqual(plain(back), plain(data))
  assert.deepEqual(back.women.map((s) => s.image), [`${R2}/site/menu/a.webp`, "/brand/charms.png", "https://img.florayn.com/gifts.jpg", `${R2}/site/menu/d.webp`])
})

test("budget: the worst-case header prop stays at 10,000 bytes or less", () => {
  const img = (name) => `${R2}/site/menu/${name}-`.padEnd(95, "0") + ".webp"
  assert.equal(img("x").length, 100)
  const links = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `mlnk_01K5${prefix}${String(i).padStart(20, "0")}`, label: `${prefix} Collection ${i + 1}`, href: `/collection/${prefix.toLowerCase()}-collection-${i + 1}/`, badge: i === 0 ? "New" : null }))
  const menu = (mode) => [
    section(`msec_01K5${mode}PHONECASE00000000000`, "Phone Case", { kind: "devices", href: "/shop/", image: img(`${mode}-phone`), badge: "New", config: { families: ["iphone", "samsung"], case_type: "signature" } }),
    section(`msec_01K5${mode}EARBUDS0000000000000`, "Earbuds", { kind: "devices", href: "/shop/airpods-pro-3/", image: img(`${mode}-earbuds`), config: { families: ["airpods"], case_type: "signature-earbuds" } }),
    section(`msec_01K5${mode}WATCH00000000000000`, "Watch Band", { kind: "devices", href: "/shop/apple-watch/", config: { families: ["watch"], case_type: null } }),
    section(`msec_01K5${mode}STYLES0000000000000`, "Styles", { kind: "case_types", config: { form: "phone", exclude: ["armor-clear"], links: { alcantara: "/collection/alcantara/", "armor-black": "/collection/armor-black/" } } }),
    section(`msec_01K5${mode}COLLECTIONS00000000`, "Collections", { kind: "collections", placement: "drawer", href: "/collections/", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }),
    section(`msec_01K5${mode}ACCESSORIES00000000`, `${mode} Accessories`, { href: "/collection/accessories/", groups: [{ heading: "Charms", links: links(`${mode}A`, 6) }, { heading: "Straps", links: links(`${mode}B`, 6) }] }),
    section(`msec_01K5${mode}GIFTS00000000000000`, `${mode} Gifts`, { href: "/collection/gifts/", groups: [{ heading: null, links: links(`${mode}G`, 12) }] }),
    section(`msec_01K5${mode}WALLETS000000000000`, "Card Wallet", { href: "/shop/card-wallet/", placement: "bar" }),
  ]
  const families = [["iphone", 26], ["samsung", 24], ["airpods", 6], ["watch", 2], ["wallet", 2]]
  const devices = families.flatMap(([family, n]) => Array.from({ length: n }, (_, i) => {
    const name = family === "iphone" ? `iPhone ${17 - Math.floor(i / 4)} ${["Pro Max", "Pro", "Plus", ""][i % 4]}`.trim() : family === "samsung" ? `Samsung Galaxy S${26 - Math.floor(i / 3)} ${["Ultra", "Plus", ""][i % 3]}`.trim() : `${family} model ${i + 1}`
    return { id: `dev_${family}_${i}`, slug: name.toLowerCase().replace(/\s+/g, "-"), name, family, brand: family, badge: i < 2 ? "New" : null }
  }))
  assert.equal(devices.length, 60)
  // Alcantara is sold for every form at a different price: the per-form price list is sent for it.
  const caseTypes = ["signature", "essentials", "elite-clear", "armor-clear", "armor-black", "alcantara", "signature-earbuds", "leather-wallet"].map((slug, i) => ({
    slug, name: slug.replace(/-/g, " "), description: "A long description that must never reach the header.".repeat(4), price: 1400 + i * 200, image: `${R2}/site/case-types/${slug}-bde7403d.jpg`,
    forms: slug === "alcantara" ? ["phone", "airpods", "watch", "wallet"] : i === 6 ? ["airpods"] : i === 7 ? ["wallet"] : ["phone"],
    fromPrice: slug === "alcantara" ? 1900 : 1400 + i * 100,
    fromPrices: slug === "alcantara" ? { phone: 3800, airpods: 2100, watch: 2200, wallet: 1900 } : {},
  }))
  // Twelve Women-only and twelve Men-only collections: the most the per-mode cap can send.
  const collections = Array.from({ length: 26 }, (_, i) => card(`collection-number-${i + 1}`, { title: `Collection number ${i + 1}`, image: img(`collection-${i}`), audiences: [i % 2 ? "men" : "women"] }))
  const data = buildHeaderData(content(menu("W"), menu("M"), { collections }), caseTypes, devices)
  assert.ok(Array.isArray(data.men), "the fixture's menus are distinct")
  assert.equal(data.collections.length, 24)
  assert.equal(data.collections.filter((c) => c[4] === AUDIENCE_BIT.women).length, 12)
  assert.equal(data.collections.filter((c) => c[4] === AUDIENCE_BIT.men).length, 12)
  // What the layout sends: the packed wire form when lib/header-data.ts has one.
  const prop = typeof packHeaderData === "function" ? packHeaderData(data) : data
  if (typeof unpackHeaderData === "function") assert.deepEqual(plain(unpackHeaderData(plain(prop))), plain(data), "the wire form unpacks to the same header data")
  const bytes = Buffer.byteLength(JSON.stringify(prop))
  assert.ok(bytes <= 10_000, `the header prop is ${bytes} bytes; the budget is 10,000`)
  assert.doesNotMatch(JSON.stringify(prop), /description|mlnk_/, "no descriptions and no link ids")
})
