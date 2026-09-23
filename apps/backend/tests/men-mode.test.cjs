const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Load real sources (and their relative imports); only Medusa itself is stubbed.
const EXTERNAL = {
  "@medusajs/framework/utils": {
    Modules: { PRODUCT: "product" },
    ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query", PG_CONNECTION: "pg" },
    ProductStatus: { PUBLISHED: "published", DRAFT: "draft" },
  },
}
const STUBS = {
  [path.join(__dirname, "../src/modules/content/index.ts")]: { CONTENT_MODULE: "content" },
  [path.join(__dirname, "../src/modules/catalog/index.ts")]: { CATALOG_MODULE: "catalog" },
}
function loader(external = {}) {
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
      exports: module.exports, module, console, process: { env: {} }, URLSearchParams,
      require(name) {
        if (Object.hasOwn(external, name)) return external[name]
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
const logger = { info() {}, warn() {}, error() {} }

/** An in-memory content module with the service method names used. */
function contentService(state) {
  let n = 0
  const match = (row, filter) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)
  const list = (key) => async (filter = {}, options = {}) => {
    let rows = state[key].filter((row) => match(row, filter))
    if (options.order?.position) rows = [...rows].sort((a, b) => a.position - b.position)
    return plain(rows)
  }
  const create = (key, prefix) => async (data) => {
    const made = (Array.isArray(data) ? data : [data]).map((row) => ({ id: `${prefix}_${++n}`, ...plain(row) }))
    state[key].push(...made)
    return Array.isArray(data) ? made : made[0]
  }
  const update = (key) => async (patch) => Object.assign(state[key].find((row) => row.id === patch.id), plain(patch))
  return {
    listHomeSections: list("home"), createHomeSections: create("home", "homesec"), updateHomeSections: update("home"),
    listMenuSections: list("menus"), createMenuSections: create("menus", "menusec"),
    listMenuItems: list("items"), createMenuItems: create("items", "menuitem"),
    listCollectionPages: async () => [], createCollectionPages: async () => [],
  }
}

function seededState() {
  return {
    home: [
      { id: "w1", key: "hero", type: "hero", position: 0, is_visible: true, config: { slides: [] } },
      { id: "w2", key: "testimonials", type: "testimonials", position: 1, is_visible: true, title: "Customer Say!", config: { quotes: [{ name: "Owner edit", body: "Kept" }] } },
      { id: "w3", key: "hidden", type: "banner", position: 2, is_visible: false, config: {} },
    ],
    menus: [
      { id: "ms1", menu: "primary", label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", position: 0, is_visible: true },
      { id: "ms2", menu: "footer", label: "About", href: null, position: 0, is_visible: true },
    ],
    items: [
      { id: "mi1", section_id: "ms1", group: "iPhone 17 Series", label: "iPhone 17 Pro Max", href: "/shop/iphone-17-pro-max/signature/", badge: "New", position: 0, is_visible: true },
      { id: "mi2", section_id: "ms2", group: null, label: "Terms", href: "/terms/", badge: null, position: 0, is_visible: true },
    ],
  }
}

test("the store content route serves each mode its own home page and menu", async () => {
  const load = loader({ "../../../lib/read-storefront-presentation": { readStorefrontPresentation: async () => ({ settings: { footer: { note: "© {year}", social: [] } } }) } })
  const route = load("api/store/content/route.ts")
  const state = seededState()
  state.home.push({ id: "m1", key: "men-hero", audience: "men", type: "hero", position: 0, is_visible: true, config: {} })
  const service = contentService(state)
  const scope = { resolve: (key) => (key === "content" ? service : key === "pg" ? null : { listProductCollections: async () => [] }) }
  const get = async (query) => {
    let json
    await route.GET({ query, scope }, { json: (value) => { json = value } })
    return plain(json)
  }

  const women = await get({})
  assert.deepEqual(women.sections.map((s) => s.key), ["hero", "testimonials"], "hidden and Men sections stay off the Women page")
  const men = await get({ audience: "men" })
  assert.deepEqual(men.sections.map((s) => s.key), ["men-hero"])
  assert.equal(men.primary[0].label, "Phone Case", "an empty Men menu falls back to the Women one")
  assert.equal(women.primaryMen[0].label, "Phone Case")
  assert.equal(women.footer[0].label, "About")

  const { copyMenu, MEN_MENU } = load("modules/content/config.ts")
  assert.equal(await copyMenu(service, "primary", MEN_MENU), 1)
  assert.equal(await copyMenu(service, "primary", MEN_MENU), 0, "never copies over an existing Men menu")
  const copiedSection = state.menus.find((m) => m.menu === MEN_MENU)
  const copiedLink = state.items.find((i) => i.section_id === copiedSection.id)
  assert.equal(copiedLink.href, "/shop/iphone-17-pro-max/signature/", "links stay plain; the Men site adds /men")
  assert.equal(copiedLink.badge, "New")
  state.items.find((i) => i.id === copiedLink.id).label = "Men only link"
  const after = await get({ audience: "men" })
  assert.equal(after.primary[0].groups[0].links[0].label, "Men only link")
  assert.equal((await get({})).primary[0].groups[0].links[0].label, "iPhone 17 Pro Max")
})

test("collection audiences come from one grouped read; untagged products count for both", async () => {
  const { collectionAudiences } = loader()("modules/content/config.ts")
  const calls = []
  const rows = [
    { collection_id: "blooms", audience: "women" },
    { collection_id: "checkmate", audience: "men" },
    { collection_id: "checkmate", audience: "women" },
    { collection_id: "legacy", audience: null },
  ]
  const builder = {
    select(...args) { calls.push(["select", ...args]); return builder },
    whereIn(...args) { calls.push(["whereIn", ...args]); return builder },
    andWhere(...args) { calls.push(["andWhere", ...args]); return builder },
    whereNull(...args) { calls.push(["whereNull", ...args]); return builder },
    groupBy(...args) { calls.push(["groupBy"]); return Promise.resolve(rows) },
  }
  const knex = Object.assign(() => builder, { raw: (sql) => sql })
  const result = await collectionAudiences(knex, ["blooms", "checkmate", "legacy"])
  assert.deepEqual(plain(result.get("blooms")), ["women"])
  assert.deepEqual(plain(result.get("checkmate")), ["women", "men"])
  assert.deepEqual(plain(result.get("legacy")), ["women", "men"])
  assert.ok(calls.some(([name, ...args]) => name === "andWhere" && args[0] === "status" && args[1] === "published"))
  assert.equal((await collectionAudiences(null, ["x"])).size, 0, "no connection: nothing is hidden")
})

test("admin sections are added and copied per home page", async () => {
  const route = loader()("api/admin/content/home-sections/route.ts")
  const state = seededState()
  const service = contentService(state)
  const post = async (body) => {
    let json
    await route.POST({ body, scope: { resolve: () => service } }, { status() { return this }, json: (value) => { json = value } })
    return plain(json)
  }
  const created = await post({ action: "create", type: "marquee", audience: "men" })
  const row = state.home.find((s) => s.id === created.created_id)
  assert.equal(row.audience, "men")
  assert.equal(row.key, "men-marquee")
  assert.equal(row.position, 0, "first on the Men page, not after the Women sections")
  assert.equal(row.is_visible, false)
  assert.deepEqual(state.home.filter((s) => s.audience !== "men").map((s) => s.position), [0, 1, 2], "the Women order is untouched")

  const copied = await post({ action: "duplicate", id: "w2", audience: "men" })
  const copy = state.home.find((s) => s.id === copied.created_id)
  assert.equal(copy.audience, "men")
  assert.equal(copy.key, "men-testimonials")
  assert.equal(copy.config.quotes[0].name, "Owner edit")
  assert.equal(copy.position, 1, "copied to the end of the Men page")
})

function productModule(products, variants) {
  const upserts = []
  return {
    upserts,
    listProducts: async () => plain(products),
    upsertProducts: async (rows) => { upserts.push(...plain(rows)); for (const row of rows) Object.assign(products.find((p) => p.id === row.id), plain(row)) },
    listProductVariants: async ({ product_id }) => plain(variants.filter((v) => v.product_id === product_id)),
    upsertProductVariants: async (rows) => { for (const row of rows) Object.assign(variants.find((v) => v.id === row.id), plain(row)) },
  }
}

test("the men-mode migration tags designs, StickPad colours, the Men menu and home once, never over owner choices", async () => {
  const load = loader()
  const seed = load("lib/design-audience-seed.ts")
  const run = load("migration-scripts/men-mode-2026-09-24.ts").default
  const menSlug = seed.MEN_DESIGNS[0]
  const womenSlug = seed.WOMEN_DESIGNS[0]
  const products = [
    { id: "p1", handle: menSlug, metadata: { design_slug: menSlug, form: "phone", card: { keep: true } } },
    { id: "p2", handle: `${menSlug}-airpods`, metadata: { design_slug: menSlug, form: "airpods" } },
    { id: "p3", handle: womenSlug, metadata: { design_slug: womenSlug, form: "phone" } },
    { id: "p4", handle: "unknown", metadata: { design_slug: "unknown" } },
    { id: "p5", handle: "owner-set", metadata: { design_slug: menSlug, audience: "both" } },
    { id: "sp", handle: "stickpad-pro", metadata: { form: "stickpad" } },
  ]
  const variants = [
    { id: "v1", product_id: "sp", title: "Magenta", metadata: { images: ["m.webp"] } },
    { id: "v2", product_id: "sp", title: "Black", metadata: {} },
    { id: "v3", product_id: "sp", title: "Pink", metadata: { audience: "both" } },
  ]
  const products$ = productModule(products, variants)
  const state = seededState()
  const service = contentService(state)
  const container = { resolve: (key) => (key === "logger" ? logger : key === "product" ? products$ : service) }

  await run({ container })
  const tag = (id) => products.find((p) => p.id === id).metadata.audience
  assert.equal(tag("p1"), "men")
  assert.equal(tag("p2"), "men")
  assert.equal(tag("p3"), "women")
  assert.equal(tag("p4"), "both")
  assert.equal(tag("p5"), "both", "an owner's choice is kept")
  assert.equal(tag("sp"), undefined, "StickPad is listed in both; its colours carry the choice")
  assert.equal(products[0].metadata.card.keep, true, "other metadata is kept")
  assert.equal(variants[0].metadata.audience, "women")
  assert.deepEqual(variants[0].metadata.images, ["m.webp"])
  assert.equal(variants[1].metadata.audience, undefined)
  assert.equal(variants[2].metadata.audience, "both")

  const menHome = state.home.filter((s) => s.audience === "men")
  assert.ok(menHome.length >= 7)
  assert.ok(menHome.every((s) => s.key.startsWith("men-")))
  assert.equal(menHome.find((s) => s.type === "testimonials").config.quotes[0].name, "Owner edit", "the live quotes are copied")
  const pills = menHome.find((s) => s.type === "category_pills").config.items
  assert.ok(pills.every((p) => p.image && p.image.includes("/site/home/men/")))
  assert.ok(!pills.some((p) => /charm|ring|nail/i.test(p.label)))
  assert.ok(JSON.stringify(menHome).includes("/collection/card-wallets/?device=MagSafe%20Wallet"))
  const hrefs = menHome.flatMap((s) => [s.cta_href, ...[...(s.config.items ?? []), ...(s.config.tiles ?? []), ...(s.config.slides ?? [])].filter((i) => typeof i === "object").map((i) => i.href)].filter(Boolean))
  assert.ok(hrefs.length > 10)
  assert.ok(hrefs.every((href) => href.startsWith("/") && !href.startsWith("/men")), "links stay plain")
  assert.equal(state.menus.filter((m) => m.menu === "primary-men").length, 1)

  const before = JSON.stringify({ products, variants, state })
  products$.upserts.length = 0
  await run({ container })
  assert.equal(JSON.stringify({ products, variants, state }), before, "a second run changes nothing")
  assert.equal(products$.upserts.length, 0)
})

test("the audience seed covers florayn.com's tags without overlap", () => {
  const seed = loader()("lib/design-audience-seed.ts")
  assert.equal(seed.MEN_DESIGNS.length, 42)
  assert.equal(seed.WOMEN_DESIGNS.length, 83)
  const both = seed.MEN_DESIGNS.filter((slug) => seed.WOMEN_DESIGNS.includes(slug))
  assert.equal(both.length, 0)
  const { mergeAudienceTags, readAudienceTag, isAudienceTag } = loader()("lib/audience.ts")
  assert.equal(mergeAudienceTags(["men", "men"]), "men")
  assert.equal(mergeAudienceTags(["men", "women"]), "both")
  assert.equal(readAudienceTag({ audience: "kids" }), "both")
  assert.ok(!isAudienceTag("kids"))
})
