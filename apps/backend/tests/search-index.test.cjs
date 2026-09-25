const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const zlib = require("node:zlib")
const ts = require("typescript")

// Load real sources (and their relative imports); only Medusa itself is stubbed.
const EXTERNAL = {
  "@medusajs/framework/utils": {
    Modules: { PRODUCT: "product", STORE: "store" },
    ContainerRegistrationKeys: { LOGGER: "logger", PG_CONNECTION: "pg" },
    ProductStatus: { PUBLISHED: "published", DRAFT: "draft" },
  },
  "node:fs": fs,
  "node:path": path,
}
const STUBS = {
  [path.join(__dirname, "../src/modules/content/index.ts")]: { CONTENT_MODULE: "content" },
  [path.join(__dirname, "../src/modules/catalog/index.ts")]: { CATALOG_MODULE: "catalog" },
}
function loader(env = {}) {
  const cache = new Map()
  function load(file) {
    if (Object.hasOwn(STUBS, file)) return STUBS[file]
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, console, process: { env }, URL, URLSearchParams, __dirname: path.dirname(file),
      require(name) {
        if (Object.hasOwn(EXTERNAL, name)) return EXTERNAL[name]
        if (name.startsWith(".")) {
          const base = path.resolve(path.dirname(file), name)
          for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
            if (fs.existsSync(candidate)) return load(candidate)
          }
        }
        throw new Error(`Unexpected dependency ${name} in ${file}`)
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  return (relative) => load(path.join(__dirname, "../src", relative))
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const load = loader()
const { buildSearchIndex, indexImagePath, productForm } = load("lib/search-index.ts")
const { DEFAULT_PRESENTATION } = load("lib/storefront-presentation.ts")
const IMG = "https://img.test"

function device(slug, name, family, badge = null) {
  return { slug, name, family, badge }
}
const DEVICES = [
  device("iphone-17-pro-max", "iPhone 17 Pro Max", "iphone", "New"),
  device("iphone-17", "iPhone 17", "iphone", " "),
  device("iphone-16", "iPhone 16", "iphone"),
  device("samsung-s26-ultra", "Samsung S26 Ultra", "samsung"),
  device("airpods-pro-3", "AirPods Pro 3", "airpods"),
  device("airpods-4", "AirPods 4", "airpods"),
  device("card-wallet", "Card Wallet", "wallet"),
]
const byDevice = (...slugs) => DEVICES.filter((d) => slugs.includes(d.slug)).map((d) => ({ slug: d.slug, family: d.family }))
const CASE_TYPES = [
  { slug: "essentials", name: "Essentials", price: 1400, price_groups: null, devices: byDevice("iphone-17-pro-max", "iphone-17", "iphone-16") },
  { slug: "signature", name: "Signature", price: 1400, price_groups: null, devices: byDevice("iphone-17-pro-max", "iphone-17", "iphone-16", "samsung-s26-ultra", "card-wallet") },
  { slug: "signature-earbuds", name: "Signature Earbuds", price: 750, price_groups: [], devices: byDevice("airpods-pro-3", "airpods-4") },
  {
    slug: "alcantara", name: "Alcantara", price: 3800,
    price_groups: [{ label: "AirPods", price: 2100, devices: ["airpods-pro-3", "airpods-4"] }, { label: "Card Wallet", price: 1900, devices: ["card-wallet"] }],
    devices: [...byDevice("iphone-17-pro-max", "airpods-pro-3", "airpods-4", "card-wallet"), { slug: "iphone-15-pro", family: "iphone", is_active: false }],
  },
]
const COLLECTIONS = [
  { slug: "blooms", collection_id: "pcol_blooms", title: "Blooms", image: `${IMG}/site/collections/blooms.webp`, artwork: null, audiences: ["women"] },
  { slug: "checkmate", collection_id: "pcol_check", title: "Checkmate", image: null, artwork: `${IMG}/checkmate/signature/iphone-17/1.webp`, audiences: ["men"] },
  { slug: "legacy", collection_id: "pcol_legacy", title: "Legacy", image: "https://cdn.other.test/legacy.jpg", artwork: null },
  { slug: "mixed", collection_id: "pcol_mixed", title: "Mixed", image: null, artwork: null, audiences: ["women", "men"] },
]
function product(handle, metadata, extra = {}) {
  return { handle, title: extra.title ?? handle, thumbnail: extra.thumbnail ?? null, collection_id: extra.collection_id ?? null, metadata }
}
function build(overrides = {}) {
  return plain(buildSearchIndex({
    img: IMG,
    products: [],
    devices: DEVICES,
    caseTypes: CASE_TYPES,
    collections: COLLECTIONS,
    menus: { women: [], men: [] },
    search: DEFAULT_PRESENTATION.search,
    ...overrides,
  }))
}

test("the index has exactly the storefront's SearchIndex keys, v 2 and the Admin > Search settings", () => {
  const types = fs.readFileSync(path.join(__dirname, "../../storefront/src/lib/search/types.ts"), "utf8")
  const body = types.match(/export type SearchIndex = \{([\s\S]*?)\n\}/)[1]
  const keys = [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  const index = build({ img: `${IMG}//` })
  assert.deepEqual(Object.keys(index), keys)
  assert.equal(index.v, 2)
  assert.match(body, /^ {2}v: 2$/m, "the storefront reads the same version")
  const tuple = (name) => [...types.match(new RegExp(`export type ${name} = \\[([\\s\\S]*?)\\n\\]`))[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(tuple("IndexProduct"), ["handle", "name", "designSlug", "form", "aud", "caseTypes", "collection", "thumb", "fromPrice", "notSold", "pics", "facts"])
  assert.deepEqual(tuple("IndexCaseType"), ["slug", "name", "fromPrice", "forms", "sold", "price", "groups", "folder"])
  const route = fs.readFileSync(path.join(__dirname, "../../storefront/src/app/search-index.json/route.ts"), "utf8")
  assert.match(route, /\["search-index-v2"\]/, "the storefront's cache key follows the version")
  const loader = fs.readFileSync(path.join(__dirname, "../../storefront/src/lib/search/load-index.ts"), "utf8")
  assert.match(loader, /index\?\.v === 2 \?/, "the browser accepts this version only")
  assert.equal(index.img, IMG, "no trailing slash")
  const search = plain(DEFAULT_PRESENTATION.search)
  assert.deepEqual(index.syn[0], [search.synonyms[0].words, search.synonyms[0].means])
  assert.equal(index.syn.length, search.synonyms.length)
  assert.deepEqual(index.sug, { w: search.suggest_women, m: search.suggest_men })
  assert.deepEqual(index.help, [search.help_label, search.help_href])
  assert.equal(index.ph, search.placeholder)
})

test("devices keep their order and badges; case types carry their lowest price, forms, devices and per-device prices", () => {
  const index = build()
  assert.deepEqual(index.dv.slice(0, 2), [["iphone-17-pro-max", "iPhone 17 Pro Max", "iphone", "New"], ["iphone-17", "iPhone 17", "iphone", null]], "a blank badge is none")
  // dv: 0 iPhone 17 Pro Max, 1 iPhone 17, 2 iPhone 16, 3 S26 Ultra, 4 AirPods Pro 3, 5 AirPods 4, 6 Card Wallet
  assert.deepEqual(index.ct, [
    ["essentials", "Essentials", 1400, ["phone"], [0, 1, 2], 1400, [], ""],
    ["signature", "Signature", 1400, ["phone", "wallet"], [0, 1, 2, 3, 6], 1400, [], ""],
    ["signature-earbuds", "Signature Earbuds", 750, ["airpods"], [4, 5], 750, [], ""],
    // An inactive device (the iPhone 15 Pro) is not sold; Alcantara phones are 3,800, its card wallet 1,900.
    ["alcantara", "Alcantara", 1900, ["phone", "airpods", "wallet"], [0, 4, 5, 6], 3800, [[2100, [4, 5]], [1900, [6]]], ""],
  ])
})

test("price groups: a device's first group wins, and a group at the flat price or with no price changes nothing", () => {
  const index = build({
    caseTypes: [{
      slug: "alcantara", name: "Alcantara", price: 3800,
      price_groups: [
        { label: "Same", price: 3800, devices: ["iphone-17"] },
        { label: "AirPods", price: 2100, devices: ["airpods-4", "unknown-device"] },
        { label: "Again", price: 2500, devices: ["airpods-4", "airpods-pro-3"] },
        { label: "Free", price: 0, devices: ["card-wallet"] },
      ],
      devices: byDevice("iphone-17", "airpods-4", "airpods-pro-3", "card-wallet"),
    }],
  })
  assert.deepEqual(index.ct[0].slice(4), [[1, 4, 5, 6], 3800, [[2100, [5]], [2500, [4]]], ""])
})

test("audience codes: women 1, men 2, both or untagged 3, on products and collections", () => {
  const index = build({
    products: [
      product("w", { design_slug: "w", audience: "women" }),
      product("m", { design_slug: "m", audience: "men" }),
      product("b", { design_slug: "b", audience: "both" }),
      product("u", { design_slug: "u" }),
      product("x", { design_slug: "x", audience: "kids" }),
    ],
  })
  assert.deepEqual(index.p.map((p) => p[4]), [1, 2, 3, 3, 3])
  assert.deepEqual(index.col.map((c) => c[3]), [1, 2, 3, 3], "absent audiences (unknown) count for both")
})

test("names, design slugs and forms follow metadata, with sensible fallbacks", () => {
  const index = build({
    products: [
      product("leopard", { design_slug: "leopard", design_name: "Leopard", form: "phone" }, { title: "Leopard case" }),
      product("leopard-airpods", { design_slug: "leopard", design_name: " Leopard ", form: "airpods" }, { title: "Leopard - AirPods Case" }),
      product("old-design", { design_slug: "old-design" }, { title: "Old Design" }),
      product("stickpad-pro", {}, { title: "StickPad Pro" }),
      product("phone-charm", { form: "charm", design_slug: "phone-charm", design_name: "Leather Chain Phone Charm" }),
    ],
  })
  assert.deepEqual(index.p.map((p) => [p[0], p[1], p[2], p[3]]), [
    ["leopard", "Leopard", "leopard", "phone"],
    ["leopard-airpods", "Leopard", "leopard", "airpods"],
    ["old-design", "Old Design", "old-design", "phone"],
    ["stickpad-pro", "StickPad Pro", "", "product"],
    ["phone-charm", "Leather Chain Phone Charm", "phone-charm", "product"],
  ])
  assert.equal(productForm({ form: "watch" }), "watch")
})

test("notSold lists this form's devices missing from card.devices, and only when the card has them", () => {
  const index = build({
    products: [
      product("a", { design_slug: "a", form: "phone", card: { devices: ["iPhone 17 Pro Max", "iPhone 16", "AirPods 4"] } }),
      product("b", { design_slug: "b", form: "airpods", card: { devices: ["AirPods 4"] } }),
      product("c", { design_slug: "c", form: "phone", card: { fromPrice: 1400 } }),
      product("d", { design_slug: "d", form: "phone" }),
      product("e", {}, { title: "Simple" }),
    ],
  })
  const names = (indexes) => indexes.map((i) => index.dv[i][1])
  assert.deepEqual(names(index.p[0][9]), ["iPhone 17", "Samsung S26 Ultra"], "phones only; another form's device is ignored")
  assert.deepEqual(names(index.p[1][9]), ["AirPods Pro 3"])
  assert.deepEqual(index.p[2][9], [], "no card.devices: nothing is ruled out")
  assert.deepEqual(index.p[3][9], [])
  assert.deepEqual(index.p[4][9], [])
})

const deviceName = (slug) => DEVICES.find((d) => d.slug === slug).name
/**
 * A card as buildCard writes it: "<device>|<case type>" pairs with the
 * variant's price and first picture (the <design>/<ct>/<device>/1.webp render
 * unless `image` says otherwise). entries: [caseTypeSlug, deviceSlugs, { price?, image? }].
 */
function cardOf(design, entries) {
  const pairs = {}
  const devices = new Set()
  const caseTypes = new Set()
  for (const [slug, deviceSlugs, own = {}] of entries) {
    const c = CASE_TYPES.find((x) => x.slug === slug)
    for (const d of deviceSlugs) {
      const group = (c.price_groups ?? []).find((g) => g.devices.includes(d))
      pairs[`${deviceName(d)}|${c.name}`] = {
        variantId: `variant_${design}_${slug}_${d}`,
        price: own.price?.[d] ?? own.price?.all ?? group?.price ?? c.price,
        image: own.image ? own.image(d) : `${IMG}/${design}/${slug}/${d}/1.webp`,
        inStock: true,
      }
      devices.add(deviceName(d))
      caseTypes.add(c.name)
    }
  }
  const prices = Object.values(pairs).map((pair) => pair.price).filter(Boolean)
  return { fromPrice: prices.length ? Math.min(...prices) : null, devices: [...devices], caseTypes: [...caseTypes], pairs }
}

test("facts: a case type that leaves out a device the design sells in another says so, from the card's pairs", () => {
  const index = build({
    designCaseTypes: new Map([["game-night", ["signature", "essentials", "alcantara"]]]),
    products: [
      // Signature has no iPhone 16 for this design; Essentials does. Essentials
      // is not made for Samsung at all, which the case type itself says.
      product("game-night", { design_slug: "game-night", form: "phone", card: cardOf("game-night", [
        ["signature", ["iphone-17-pro-max", "iphone-17", "samsung-s26-ultra"]],
        ["essentials", ["iphone-17-pro-max", "iphone-17", "iphone-16"]],
      ]) }),
      // Every case type sells every device the design is made for: nothing to say.
      product("plain", { design_slug: "plain", form: "phone", card: cardOf("plain", [["signature", ["iphone-17-pro-max", "iphone-17"]]]) }),
      // No pairs (an older card): the case types as merged, no facts.
      product("older", { design_slug: "older", form: "phone", case_type_slugs: ["signature", "essentials"], card: { devices: ["iPhone 17"] } }),
    ],
  })
  const [gameNight, plain, older] = index.p
  // Alcantara (the legacy manifest) has no variant: dropped.
  assert.deepEqual(gameNight[5], [0, 1], "essentials and signature, the case types it has variants in")
  assert.deepEqual(gameNight[9], [], "every phone it is made for is sold in some case type")
  assert.deepEqual(gameNight[11], [[1, [2]]], "Signature: not for the iPhone 16")
  assert.deepEqual(plain[11], [])
  assert.deepEqual(older[5], [0, 1])
  assert.deepEqual(older[11], [])
})

test("facts: a design's own prices, when they are not its case type's, ride along like a case type's", () => {
  const index = build({
    products: [
      product("special", { design_slug: "special", form: "phone", card: cardOf("special", [
        ["signature", ["iphone-17-pro-max", "iphone-17", "iphone-16"], { price: { "iphone-17-pro-max": 1500, "iphone-17": 1500 } }],
        ["alcantara", ["iphone-17-pro-max"]],
      ]) }),
      product("uniform", { design_slug: "uniform", form: "wallet", card: cardOf("uniform", [["alcantara", ["card-wallet"], { price: { all: 2000 } }]]) }),
      product("model", { design_slug: "model", form: "airpods", card: cardOf("model", [["alcantara", ["airpods-4", "airpods-pro-3"]]]) }),
    ],
  })
  assert.deepEqual(index.p[0][11], [[1, [], 1500, [[1400, [2]]]]], "Signature at 1,500 but 1,400 for the iPhone 16; Alcantara at its own 3,800")
  assert.deepEqual(index.p[1][11], [[3, [], 2000, []]], "a card wallet at 2,000, not Alcantara's 1,900")
  assert.deepEqual(index.p[2][11], [], "AirPods at Alcantara's own 2,100")
})

test("pics and thumb: renders are known only when every variant's picture follows <folder>/<ct>/<device>/1.webp", () => {
  const index = build({
    products: [
      product("leopard", { design_slug: "leopard", form: "phone", card: cardOf("leopard", [["signature", ["iphone-17-pro-max", "iphone-16"]]]) },
        { thumbnail: `${IMG}/leopard/signature/iphone-17-pro-max/1.webp` }),
      // AirPods sell "Signature Earbuds", but its renders stay in the design's signature folder.
      product("leopard-airpods", { design_slug: "leopard", form: "airpods", card: cardOf("leopard-airpods", [
        ["signature-earbuds", ["airpods-pro-3", "airpods-4"], { image: (d) => `${IMG}/leopard/signature/${d}/1.webp` }],
      ]) }, { thumbnail: `${IMG}/leopard/signature/airpods-4/1.webp` }),
      // An admin upload: designs/<slug>/<ct>/<device>/<n>, versioned by the file module.
      product("moon", { design_slug: "moon", form: "phone", card: cardOf("moon", [
        ["signature", ["iphone-17"], { image: (d) => `${IMG}/designs/moon/signature/${d}/1-01JABCDEF.webp` }],
      ]) }, { thumbnail: `${IMG}/designs/moon/signature/iphone-17/1-01JABCDEF.webp` }),
      // The same layout under another folder.
      product("star", { design_slug: "star", form: "phone", card: cardOf("star", [
        ["signature", ["iphone-17"], { image: (d) => `${IMG}/designs/star/signature/${d}/1.webp` }],
      ]) }, { thumbnail: "https://cdn.other.test/star.jpg" }),
      // One variant without a picture: nothing can be promised.
      product("gap", { design_slug: "gap", form: "phone", card: cardOf("gap", [
        ["signature", ["iphone-17", "iphone-16"], { image: (d) => (d === "iphone-16" ? null : `${IMG}/gap/signature/${d}/1.webp`) }],
      ]) }, { thumbnail: `${IMG}/gap/signature/iphone-17/1.webp` }),
      // A render filed under another device's folder is not the convention.
      product("mixed", { design_slug: "mixed", form: "phone", card: cardOf("mixed", [
        ["signature", ["iphone-17", "iphone-16"], { image: () => `${IMG}/mixed/signature/iphone-17/1.webp` }],
      ]) }),
      product("no-card", { design_slug: "no-card", form: "phone" }, { thumbnail: `${IMG}/no-card/signature/iphone-17/1.webp` }),
    ],
  })
  assert.equal(index.ct[2][7], "signature", "Signature Earbuds renders live in signature")
  assert.equal(index.ct[1][7], "", "Signature's in its own slug")
  const picked = (handle) => index.p.find((p) => p[0] === handle)
  assert.deepEqual([picked("leopard")[10], picked("leopard")[7]], [1, [1, 0]], "the thumbnail is the Signature iPhone 17 Pro Max render")
  assert.deepEqual([picked("leopard-airpods")[10], picked("leopard-airpods")[7]], [1, [2, 5]])
  assert.deepEqual([picked("moon")[10], picked("moon")[7]], [0, "designs/moon/signature/iphone-17/1-01JABCDEF.webp"])
  assert.deepEqual([picked("star")[10], picked("star")[7]], ["designs/star", "https://cdn.other.test/star.jpg"])
  assert.equal(picked("gap")[10], 0)
  assert.equal(picked("gap")[7], "gap/signature/iphone-17/1.webp", "no renders known: the thumbnail stays a path")
  assert.equal(picked("mixed")[10], 0)
  assert.deepEqual([picked("no-card")[10], picked("no-card")[7]], [0, "no-card/signature/iphone-17/1.webp"])
})

test("thumbnails are relative to img, other hosts stay absolute, placeholders and blanks are ''", () => {
  const index = build({
    products: [
      product("a", { design_slug: "a" }, { thumbnail: `${IMG}/a/signature/iphone-17/1.webp` }),
      product("b", { design_slug: "b" }, { thumbnail: "https://cdn.other.test/b.jpg" }),
      product("c", { design_slug: "c" }, { thumbnail: "data:image/svg+xml;base64,AAAA" }),
      product("d", { design_slug: "d" }, { thumbnail: null }),
      product("e", { design_slug: "e" }, { thumbnail: `${IMG}.evil.test/e.webp` }),
    ],
  })
  assert.deepEqual(index.p.map((p) => p[7]), ["a/signature/iphone-17/1.webp", "https://cdn.other.test/b.jpg", "", "", `${IMG}.evil.test/e.webp`])
  assert.deepEqual(index.col.map((c) => c[2]), ["site/collections/blooms.webp", "checkmate/signature/iphone-17/1.webp", "https://cdn.other.test/legacy.jpg", ""], "a card image, else its artwork")
  assert.equal(indexImagePath("/images/local.webp", IMG), "", "a path the storefront cannot resolve against img is dropped")
})

test("colIdx is the collection page with the same collection_id, or -1", () => {
  const index = build({
    products: [
      product("a", { design_slug: "a" }, { collection_id: "pcol_check" }),
      product("b", { design_slug: "b" }, { collection_id: "pcol_nopage" }),
      product("c", { design_slug: "c" }),
      product("d", { design_slug: "d" }, { collection_id: "pcol_blooms" }),
    ],
  })
  assert.deepEqual(index.p.map((p) => p[6]), [1, -1, -1, 0])
})

test("case types merge the manifest, saved slugs and card names, keep this form's, in case-type order", () => {
  const index = build({
    caseTypeNames: [{ slug: "armor-black", name: "Armor Black" }],
    designCaseTypes: new Map([["legacy", ["signature", "alcantara"]]]),
    products: [
      product("new", { design_slug: "new", form: "phone", case_type_slugs: ["alcantara", "essentials", "made-up"] }),
      product("legacy", { design_slug: "legacy", form: "phone", card: { caseTypes: ["Essentials", "Armor Black", "Unknown"] } }),
      // The legacy manifest says Signature for the whole design; AirPods sell Signature Earbuds.
      product("legacy-airpods", { design_slug: "legacy", form: "airpods", card: { caseTypes: ["Signature Earbuds"] } }),
      product("simple", {}, { title: "Simple" }),
    ],
  })
  const slugs = (p) => p[5].map((i) => index.ct[i][0])
  assert.deepEqual(slugs(index.p[0]), ["essentials", "alcantara"])
  assert.deepEqual(slugs(index.p[1]), ["essentials", "signature", "alcantara"], "an inactive case type (Armor Black) is dropped")
  assert.deepEqual(slugs(index.p[2]), ["signature-earbuds", "alcantara"])
  assert.deepEqual(index.p[3][5], [])
})

test("fromPrice is the card's, else the lowest price of its case types for its form", () => {
  const index = build({
    products: [
      product("carded", { design_slug: "carded", form: "phone", case_type_slugs: ["alcantara"], card: { fromPrice: 1450 } }),
      product("phone", { design_slug: "phone", form: "phone", case_type_slugs: ["alcantara"] }),
      product("airpods", { design_slug: "airpods", form: "airpods", case_type_slugs: ["alcantara", "signature-earbuds"] }),
      product("wallet", { design_slug: "wallet", form: "wallet", case_type_slugs: ["alcantara"], card: { fromPrice: 0 } }),
      product("simple", {}, { title: "Simple" }),
    ],
  })
  assert.deepEqual(index.p.map((p) => p[8]), [1450, 3800, 750, 1900, null])
})

test("cat: link sections with an href, one per href, with who they are for", () => {
  const women = [
    { label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", kind: "devices", position: 0 },
    { label: "StickPad", href: "/product/stickpad-pro/", image_url: `${IMG}/site/menu/stickpad.webp`, position: 1 },
    { label: "Phone Charm", href: "/product/phone-charm/", kind: "links", position: 2 },
    { label: "Heading only", href: null, kind: "links", position: 3 },
    { label: "Hidden", href: "/product/hidden/", is_visible: false, position: 4 },
    { label: "StickPad again", href: "/product/stickpad-pro/", position: 5 },
    { label: "Women gifts", href: "/collection/gifts/", position: 6 },
  ]
  const men = [
    { label: "StickPad", href: "/men/product/stickpad-pro/", position: 0 },
    { label: "Charms for him", href: "/product/phone-charm/", kind: null, position: 1 },
    { label: "Wallets", href: "/product/card-wallet/", position: 2 },
  ]
  const index = build({ menus: { women, men } })
  assert.deepEqual(index.cat, [
    ["StickPad", "/product/stickpad-pro/", "site/menu/stickpad.webp", 3],
    ["Phone Charm", "/product/phone-charm/", "", 3],
    ["Women gifts", "/collection/gifts/", "", 1],
    ["Wallets", "/product/card-wallet/", "", 2],
  ])
  const hiddenMen = build({ menus: { women, men: men.map((s) => ({ ...s, is_visible: false })) } })
  assert.ok(hiddenMen.cat.every((c) => c[3] === 3), "with no visible Men menu the Men site shows the Women one")
})

// --- The route ---------------------------------------------------------------

function routeScope({ fail = false, env = {} } = {}) {
  const calls = {}
  const products = [
    product("leopard", { design_slug: "leopard", design_name: "Leopard", form: "phone", audience: "women", card: { fromPrice: 1400, devices: ["iPhone 17 Pro Max"], caseTypes: ["Signature"] } }, { thumbnail: "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/leopard/signature/iphone-17-pro-max/1.webp", collection_id: "pcol_wild" }),
  ]
  const services = {
    product: {
      listProducts: async (filter, options) => {
        if (filter.status) {
          calls.products = plain({ filter, options })
          if (fail) throw new Error("database is down")
          return plain(products)
        }
        return []
      },
      listProductCollections: async () => [{ id: "pcol_wild", handle: "wild", title: "Wild" }],
    },
    catalog: {
      listDevices: async (filter, options) => {
        calls.devices = plain({ filter, options })
        return plain([
          { slug: "iphone-16", name: "iPhone 16", family: "iphone" },
          { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", badge: "New" },
          { slug: "airpods-4", name: "AirPods 4", family: "airpods" },
        ])
      },
      listCaseTypes: async (filter, options) => {
        calls.caseTypes = plain({ filter, options })
        return plain([
          { slug: "signature", name: "Signature", price: 1400, price_groups: null, devices: [{ slug: "iphone-16", family: "iphone" }] },
          { slug: "alcantara", name: "Alcantara", price: 3800, price_groups: null, devices: [{ slug: "iphone-16", family: "iphone" }, { slug: "card-wallet", family: "wallet" }] },
        ])
      },
    },
    content: {
      listCollectionPages: async () => [{ id: "cp1", collection_slug: "wild", title: "Wild ones", card_image_url: "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/site/wild.webp", is_visible: true, position: 0 }],
      createCollectionPages: async () => [],
      listMenuSections: async (filter, options) => {
        calls.menus = plain({ filter, options })
        return [
          { menu: "primary", label: "StickPad", href: "/product/stickpad-pro/", kind: "links", image_url: "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/site/menu/stickpad.webp", position: 0, is_visible: true },
          { menu: "primary", label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", kind: "devices", position: 1, is_visible: true },
          { menu: "primary-men", label: "StickPad", href: "/product/stickpad-pro/", position: 0, is_visible: true },
        ]
      },
    },
    store: { listStores: async () => [{ id: "store", metadata: { florayn_presentation: { search: { ...DEFAULT_PRESENTATION.search, placeholder: "Find a case" } } } }] },
    pg: null,
    logger: { error: (message) => { calls.logged = message } },
  }
  return { calls, scope: { resolve: (key) => services[key] }, env }
}
async function callRoute(options = {}) {
  const { calls, scope, env } = routeScope(options)
  const route = loader(env)("api/store/search-index/route.ts")
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = plain(value) },
  }
  await route.GET({ query: {}, scope }, res)
  return { res, calls }
}

test("GET /store/search-index reads product-level rows only and serves a short-cached index", async () => {
  const { res, calls } = await callRoute()
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers["cache-control"], "public, max-age=60")
  assert.deepEqual(calls.products.filter, { status: "published" })
  assert.deepEqual(calls.products.options, { select: ["handle", "title", "thumbnail", "collection_id", "metadata"], order: { created_at: "DESC" }, take: 10000 }, "no variants, no prices")
  assert.deepEqual(calls.devices.filter, { is_active: true })
  assert.deepEqual(calls.caseTypes, { filter: { is_active: true }, options: { order: { sort_order: "ASC" }, relations: ["devices"] } })
  assert.deepEqual(calls.menus.filter, { menu: ["primary", "primary-men"] })
  const index = res.body
  assert.equal(index.img, "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev", "the default R2 base")
  assert.deepEqual(index.dv.map((d) => d[1]), ["iPhone 17 Pro Max", "iPhone 16", "AirPods 4"], "each family newest first")
  // dv: 0 iPhone 17 Pro Max, 1 iPhone 16, 2 AirPods 4
  assert.deepEqual(index.ct[1], ["alcantara", "Alcantara", 1900, ["phone", "wallet"], [1], 3800, [[2100, [2]]], ""], "unsaved per-device prices fall back to the seed's")
  assert.deepEqual(index.col, [["wild", "Wild ones", "site/wild.webp", 3]])
  // A card without pairs (built before them): no renders promised, no facts.
  assert.deepEqual(index.p, [["leopard", "Leopard", "leopard", "phone", 1, [0], 0, "leopard/signature/iphone-17-pro-max/1.webp", 1400, [1], 0, []]])
  assert.deepEqual(index.cat, [["StickPad", "/product/stickpad-pro/", "site/menu/stickpad.webp", 3]], "raw menu rows: image_url, and only the links kind")
  assert.equal(index.ph, "Find a case", "Admin > Search is read from the store")
})

test("the image base comes from IMAGE_BASE_URL, then R2_PUBLIC_URL", async () => {
  assert.equal((await callRoute({ env: { IMAGE_BASE_URL: "https://images.test/", R2_PUBLIC_URL: "https://r2.test" } })).res.body.img, "https://images.test")
  assert.equal((await callRoute({ env: { R2_PUBLIC_URL: "https://r2.test/" } })).res.body.img, "https://r2.test")
})

test("a failed read is a 500 with a message, never a partial index", async () => {
  const { res, calls } = await callRoute({ fail: true })
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, { message: "Could not build the search index." })
  assert.equal(res.headers["cache-control"], "no-store")
  assert.match(calls.logged, /database is down/)
})

// --- The size budget ----------------------------------------------------------

test("budget: 400 products x 45 devices x 8 case types x 15 collections stay <= 60,000 bytes and <= 14,000 gzipped", () => {
  const { DESIGNS } = load("modules/catalog/data/designs.ts")
  const { DEVICES: SEED_DEVICES } = load("modules/catalog/data/devices.ts")
  const { CASE_TYPES: SEED_CASE_TYPES, priceForDevice } = load("modules/catalog/data/case-types.ts")
  const { devicesFor, CASE_TYPE_DEVICES } = load("modules/catalog/data/design-devices.ts")
  const { sortNewestFirst } = load("lib/device-order.ts")
  const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"

  // 45 real devices (the seed's 49 less the four oldest), newest first.
  const dropped = new Set(["iphone-11", "iphone-11-pro", "iphone-11-pro-max", "iphone-12-mini"])
  const devices = sortNewestFirst(SEED_DEVICES.filter((d) => !dropped.has(d.slug)), (d) => d.name, (d) => d.family)
    .map((d, i) => ({ slug: d.slug, name: d.name, family: d.family, badge: i % 6 === 0 ? "New" : null }))
  assert.equal(devices.length, 45)
  const deviceBySlug = new Map(devices.map((d) => [d.slug, d]))
  const formOf = (family) => (family === "iphone" || family === "samsung" ? "phone" : family)

  // The seed's seven case types plus one more.
  const caseTypes = [...SEED_CASE_TYPES, { slug: "magsafe-clear", name: "MagSafe Clear", price: 2200 }].map((c) => ({
    slug: c.slug, name: c.name, price: c.price, price_groups: c.price_groups ?? null,
    devices: (CASE_TYPE_DEVICES[c.slug] ?? CASE_TYPE_DEVICES["elite-clear"]).filter((s) => deviceBySlug.has(s)).map((s) => ({ slug: s, family: deviceBySlug.get(s).family })),
  }))
  assert.equal(caseTypes.length, 8)

  // 15 collection pages named after the designs' themes, with R2 card images.
  const themes = [...new Set(DESIGNS.map((d) => d.theme).filter(Boolean))]
  while (themes.length < 15) themes.push(`Theme ${themes.length + 1}`)
  const collections = themes.slice(0, 15).map((theme, i) => {
    const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    return { slug, collection_id: `pcol_01J${String(i).padStart(23, "0")}`, title: theme, image: `${R2}/site/collections/${slug}/card-${(0x1a2b3c4d + i).toString(16)}.webp`, audiences: i % 3 ? ["women", "men"] : ["women"] }
  })
  const collectionId = new Map(collections.map((c) => [c.title, c.collection_id]))

  // Real designs, one product per form each is sold in (devices from the live
  // sweep), topped up to 400 with copies as new designs would be. Each card is
  // what buildCard writes: a "<device>|<case type>" pair per variant with its
  // price and render (AirPods sell Signature Earbuds, rendered under signature).
  const products = []
  for (let round = 0; products.length < 400; round++) {
    for (const design of DESIGNS) {
      if (products.length >= 400) break
      const slug = round ? `${design.slug}-${round + 1}` : design.slug
      const byForm = new Map()
      for (const ctSlug of design.case_types) {
        for (const deviceSlug of devicesFor(design.slug, ctSlug)) {
          const d = deviceBySlug.get(deviceSlug)
          if (!d) continue
          const form = formOf(d.family)
          const sells = caseTypes.find((c) => c.slug === (form === "airpods" && ctSlug === "signature" ? "signature-earbuds" : ctSlug))
          const entry = byForm.get(form) ?? { devices: new Set(), caseTypes: new Set(), first: `${ctSlug}/${deviceSlug}`, pairs: {} }
          entry.devices.add(d.name)
          entry.caseTypes.add(sells.name)
          entry.pairs[`${d.name}|${sells.name}`] = {
            variantId: `variant_${slug}_${sells.slug}_${deviceSlug}`,
            price: priceForDevice(sells, deviceSlug),
            image: `${R2}/${slug}/${ctSlug}/${deviceSlug}/1.webp`,
            inStock: true,
          }
          byForm.set(form, entry)
        }
      }
      for (const [form, entry] of byForm) {
        if (products.length >= 400) break
        products.push({
          handle: form === "phone" ? slug : `${slug}-${form}`,
          title: form === "phone" ? design.name : `${design.name} - ${form}`,
          thumbnail: `${R2}/${slug}/${entry.first}/1.webp`,
          collection_id: collectionId.get(design.theme) ?? null,
          metadata: {
            design_slug: slug, design_name: design.name, form,
            ...(products.length % 4 === 0 ? { audience: products.length % 8 ? "women" : "men" } : {}),
            case_type_slugs: [...entry.caseTypes].map((name) => caseTypes.find((c) => c.name === name).slug),
            card: {
              fromPrice: Math.min(...Object.values(entry.pairs).map((pair) => pair.price)),
              devices: [...entry.devices], caseTypes: [...entry.caseTypes], pairs: entry.pairs,
            },
          },
        })
      }
    }
  }
  assert.equal(products.length, 400)

  const menus = {
    women: ["StickPad", "Phone Charm", "Card Wallet", "Watch Bands"].map((label, i) => ({ label, href: `/product/${label.toLowerCase().replace(/ /g, "-")}/`, image_url: `${R2}/site/menu/${i}.webp`, position: i })),
    men: [],
  }
  const index = buildSearchIndex({ img: R2, products, devices, caseTypes, collections, menus, search: DEFAULT_PRESENTATION.search, caseTypeNames: SEED_CASE_TYPES })
  const json = JSON.stringify(index)
  const gzip = zlib.gzipSync(json).length
  console.log(`search index: ${json.length} bytes, ${gzip} gzipped, ${index.p.length} products, notSold total ${index.p.reduce((n, p) => n + p[9].length, 0)}`)
  assert.equal(index.p.length, 400)
  assert.equal(index.dv.length, 45)
  assert.equal(index.ct.length, 8)
  assert.equal(index.col.length, 15)
  assert.ok(index.p.every((p) => typeof p[7] !== "string" || !p[7].startsWith("http")), "every thumbnail is relative")
  assert.ok(index.p.every((p) => p[10] === 1), "every render is <design>/<ct folder>/<device>/1.webp")
  assert.equal(index.ct.find((c) => c[0] === "signature-earbuds")[7], "signature", "the earbuds renders are in signature")
  // game-night: Signature has no Plus phones, Elite Clear does (the review's case).
  const dvAt = (slug) => index.dv.findIndex((d) => d[0] === slug)
  const ctAt = (slug) => index.ct.findIndex((c) => c[0] === slug)
  const gameNight = index.p.find((p) => p[0] === "game-night")
  const signatureFacts = gameNight[11].find((f) => f[0] === ctAt("signature"))
  for (const plus of ["iphone-14-plus", "iphone-15-plus", "iphone-16-plus"]) {
    assert.ok(signatureFacts[1].includes(dvAt(plus)), `no ${plus} in its Signature`)
    assert.ok(!gameNight[9].includes(dvAt(plus)), `${plus} is sold (in Elite Clear)`)
  }
  assert.ok(!gameNight[11].some((f) => f[0] === ctAt("elite-clear") && f[1].includes(dvAt("iphone-16-plus"))))
  assert.ok(Buffer.byteLength(json) <= 60000, `JSON is ${Buffer.byteLength(json)} bytes`)
  assert.ok(gzip <= 14000, `gzip is ${gzip} bytes`)
})
