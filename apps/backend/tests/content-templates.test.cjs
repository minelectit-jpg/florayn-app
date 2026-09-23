const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Load real source files (and their relative imports) into a sandbox. Only the
// Medusa framework is stubbed; no database, admin session or network is used.
const EXTERNAL = {
  "@medusajs/framework/utils": {
    Modules: { PRODUCT: "product" },
    ContainerRegistrationKeys: { LOGGER: "logger" },
  },
}
// The module index pulls in Medusa's model DSL; routes only need its name.
const STUBS = {
  [path.join(__dirname, "../src/modules/content/index.ts")]: { CONTENT_MODULE: "content" },
}
function loader() {
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
      exports: module.exports, module, console, process: { env: {} },
      require(name) {
        if (Object.hasOwn(EXTERNAL, name)) return EXTERNAL[name]
        if (name.startsWith(".")) {
          const base = path.resolve(path.dirname(file), name)
          for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
            if (fs.existsSync(candidate)) return load(candidate)
          }
        }
        throw new Error(`Unexpected dependency ${name}`)
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  return (relative) => load(path.join(__dirname, "../src", relative))
}
const load = loader()
const plain = (value) => JSON.parse(JSON.stringify(value))

/** An in-memory content module with the MedusaService method names used. */
function contentService(state) {
  let n = 0
  const match = (row, filter) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)
  const list = (key) => async (filter = {}, options = {}) => {
    let rows = state[key].filter((row) => match(row, filter))
    if (options.order?.position) rows = [...rows].sort((a, b) => a.position - b.position)
    if (options.take) rows = rows.slice(0, options.take)
    return plain(rows)
  }
  const create = (key, prefix) => async (data) => {
    const made = (Array.isArray(data) ? data : [data]).map((row) => ({ id: `${prefix}_${++n}`, ...plain(row) }))
    state[key].push(...made)
    return Array.isArray(data) ? made : made[0]
  }
  const update = (key) => async (patch) => Object.assign(state[key].find((row) => row.id === patch.id), plain(patch))
  const remove = (key) => async (id) => { state[key] = state[key].filter((row) => row.id !== id) }
  return {
    listHomeSections: list("home"), createHomeSections: create("home", "homesec"),
    updateHomeSections: update("home"), deleteHomeSections: remove("home"),
    listCollectionPages: list("pages"), createCollectionPages: create("pages", "colpage"),
    updateCollectionPages: update("pages"), deleteCollectionPages: remove("pages"),
    listMenuSections: async () => [{ id: "menu", menu: "primary", position: 0, is_visible: true }],
    createMenuSections: async () => { throw new Error("menus already exist") },
    listMenuItems: async () => [],
  }
}

function call(handler, { params = {}, body, scope = {} } = {}) {
  let status = 200, json
  const res = { status(code) { status = code; return res }, json(value) { json = value; return res } }
  return handler({ params, body, scope: { resolve: (key) => scope[key] } }, res).then(() => ({ status, json }))
}

test("themes and blocks keep only valid colours and safe links", () => {
  const { normaliseTheme, normaliseBlocks, safeUrl, DEFAULT_THEME } = load("modules/content/collection-templates.ts")
  const theme = normaliseTheme({
    bg: "#0B1033", text: "red", accent: "javascript:alert(1)", card_border: "transparent",
    card_radius: 99, heading_size: "huge",
    decor: ["https://cdn.example/bee.svg", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "/local.svg"],
  })
  assert.equal(theme.bg, "#0b1033")
  assert.equal(theme.text, DEFAULT_THEME.text, "a named colour is not a stored theme value")
  assert.equal(theme.accent, DEFAULT_THEME.accent)
  assert.equal(theme.card_border, "transparent")
  assert.equal(theme.card_radius, 32)
  assert.equal(theme.heading_size, "md")
  assert.equal(theme.decor.join(","), "https://cdn.example/bee.svg,/local.svg")
  assert.equal(normaliseTheme(null).bg, DEFAULT_THEME.bg)

  const blocks = normaliseBlocks([
    { type: "banner", heading: " AirPods ", image: "https://img.example/a.webp", cta_href: "javascript:alert(1)" },
    { type: "script", html: "<script>" },
    { type: "text", heading: "About", copy: "Copy" },
    "nope",
  ])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].heading, "AirPods")
  assert.equal(blocks[0].cta_href, null)
  assert.equal(blocks[1].type, "text")
  assert.equal(safeUrl("//evil.example/x"), null, "protocol-relative URLs are not site paths")
})

test("home section configs are cleaned per type before they are stored", () => {
  const { normaliseHomeConfig, blankHomeSection, isHomeSectionType } = load("modules/content/home-sections.ts")
  const hero = normaliseHomeConfig("hero", { slides: [
    { heading: "Hi", href: "javascript:alert(1)", image: "https://img.example/h.webp", mobile_image: "ftp://x" },
  ], extra: true })
  assert.equal(hero.slides[0].href, "/")
  assert.equal(hero.slides[0].mobile_image, null)
  assert.equal(hero.extra, undefined)
  const pills = normaliseHomeConfig("category_pills", { items: [{ label: "Ring", href: null, note: "Coming Soon" }] })
  assert.equal(pills.items[0].href, null, "a pill without a link stays a coming-soon label")
  assert.equal(normaliseHomeConfig("product_carousel", { limit: 999 }).limit, 12)
  assert.equal(normaliseHomeConfig("tile_grid", { columns: 7 }).columns, 2)
  assert.equal(normaliseHomeConfig("testimonials", { quotes: [{ name: "A", body: "B", rating: 9 }] }).quotes[0].rating, 5)
  assert.ok(isHomeSectionType("collection_grid"))
  assert.ok(!isHomeSectionType("html"))
  assert.equal(blankHomeSection("banner").config.image, null)
})

test("home sections can be added after a section, duplicated hidden, and deleted", async () => {
  const state = {
    home: [
      { id: "a", key: "hero", type: "hero", position: 0, is_visible: true, config: { slides: [] } },
      { id: "b", key: "new-releases", type: "product_carousel", position: 1, is_visible: true, title: "New", config: { limit: 5 } },
      { id: "c", key: "testimonials", type: "testimonials", position: 2, is_visible: true, config: { quotes: [] } },
    ],
    pages: [],
  }
  const scope = { content: contentService(state) }
  const collection = load("api/admin/content/home-sections/route.ts")
  const item = load("api/admin/content/home-sections/[id]/route.ts")

  const created = await call(collection.POST, { scope, body: { action: "create", type: "banner", after_id: "a" } })
  const order = () => [...state.home].sort((x, y) => x.position - y.position).map((s) => s.key).join(",")
  assert.equal(order(), "hero,banner,new-releases,testimonials")
  const banner = state.home.find((s) => s.id === created.json.created_id)
  assert.equal(banner.is_visible, false, "new sections start hidden")

  await call(collection.POST, { scope, body: { action: "duplicate", id: "b" } })
  assert.equal(order(), "hero,banner,new-releases,new-releases-copy,testimonials")
  const copy = state.home.find((s) => s.key === "new-releases-copy")
  assert.equal(copy.title, "New")
  assert.equal(copy.config.limit, 5)
  assert.equal(copy.is_visible, false)

  assert.equal((await call(collection.POST, { scope, body: { action: "create", type: "iframe" } })).status, 400)

  await call(item.POST, { scope, params: { id: "b" }, body: { config: { limit: 3, collection: "bug-life", evil: 1 } } })
  assert.deepEqual(plain(state.home.find((s) => s.id === "b").config), { limit: 3, collection: "bug-life" })

  await call(item.DELETE, { scope, params: { id: copy.id } })
  assert.ok(!state.home.some((s) => s.id === copy.id))
})

test("collection pages are created from a template or duplicated onto another collection", async () => {
  const load2 = loader()
  const { TEMPLATE_PRESETS } = load2("modules/content/collection-templates.ts")
  const state = {
    home: [],
    pages: [{
      id: "vg", collection_slug: "van-gogh-dreams", title: null, template: "split", position: 0, is_visible: true,
      theme: { bg: "#0b1033", accent: "#f2c744" }, hero_image_url: "https://img.example/vg.webp",
      hero_heading: "Van Gogh Dreams", intro_heading: "Van Gogh Dreams Phone Cases",
      cta_href: "/collection/van-gogh-dreams/", design_slugs: ["starry"],
      blocks: [{ type: "banner", heading: "Van Gogh AirPods Cases", cta_href: "/collection/van-gogh-dreams/?form=airpods#shop" }],
    }],
  }
  const product = {
    listProductCollections: async () => [
      { id: "c1", handle: "van-gogh-dreams", title: "Van Gogh Dreams" },
      { id: "c2", handle: "monet-mornings", title: "Monet Mornings" },
    ],
    listProductCategories: async () => [{ id: "k1", handle: "signature", name: "Signature" }],
    listProducts: async () => [],
  }
  const scope = { content: contentService(state), product }
  const route = load2("api/admin/content/collection-pages/route.ts")

  const copy = await call(route.POST, { scope, body: { action: "duplicate", id: "vg", collection_slug: "monet-mornings" } })
  const page = state.pages.find((p) => p.id === copy.json.created_id)
  assert.equal(page.collection_slug, "monet-mornings")
  assert.equal(page.template, "split")
  assert.equal(page.theme.bg, "#0b1033")
  assert.equal(page.hero_image_url, "https://img.example/vg.webp")
  assert.equal(page.hero_heading, "Monet Mornings")
  assert.equal(page.intro_heading, "Monet Mornings Phone Cases")
  assert.equal(page.cta_href, "/collection/monet-mornings/")
  assert.equal(page.blocks[0].heading, "Monet Mornings AirPods Cases")
  assert.equal(page.blocks[0].cta_href, "/collection/monet-mornings/?form=airpods#shop")
  assert.equal(page.design_slugs.length, 0, "designs belong to the source collection")
  assert.equal(page.is_visible, false, "a copy is a draft until switched on")

  const again = await call(route.POST, { scope, body: { action: "duplicate", id: "vg", collection_slug: "monet-mornings" } })
  assert.equal(again.status, 400, "one page per collection")
  const missing = await call(route.POST, { scope, body: { action: "create", collection_slug: "no-such-thing" } })
  assert.equal(missing.status, 400, "the URL would 404 without a real collection or category")

  const fresh = await call(route.POST, { scope, body: { action: "create", collection_slug: "signature", preset: "forest" } })
  const made = state.pages.find((p) => p.id === fresh.json.created_id)
  const forest = TEMPLATE_PRESETS.find((p) => p.id === "forest")
  assert.equal(made.template, forest.template)
  assert.equal(made.theme.bg, forest.theme.bg)
  assert.equal(made.hero_heading, "Signature")

  const listed = await call(route.GET, { scope })
  assert.ok(listed.json.presets.length >= 6)
  assert.equal(listed.json.targets.map((t) => t.handle).join(","), "van-gogh-dreams,monet-mornings,signature")
  assert.equal(listed.json.pages[0].theme.card_radius, 10, "old rows come back with a complete theme")
})

test("collection page edits validate URLs and normalise the look", async () => {
  const state = { home: [], pages: [
    { id: "p1", collection_slug: "leopard", position: 0, is_visible: true },
    { id: "p2", collection_slug: "garage", position: 1, is_visible: true },
  ] }
  const scope = { content: contentService(state) }
  const route = load("api/admin/content/collection-pages/[id]/route.ts")
  const bad = await call(route.POST, { scope, params: { id: "p1" }, body: { hero_image_url: "javascript:alert(1)" } })
  assert.equal(bad.status, 400)
  const ok = await call(route.POST, { scope, params: { id: "p1" }, body: {
    hero_image_url: "https://img.example/h.webp", template: "diagonal", theme: { bg: "#FFF" }, blocks: [{ type: "text", heading: "Hi" }],
    hero_copy: "  Copy  ", card_image_url: "",
  } })
  assert.equal(ok.status, 200)
  const row = state.pages.find((p) => p.id === "p1")
  assert.equal(row.template, "overlay")
  assert.equal(row.theme.bg, "#fff")
  assert.equal(row.hero_copy, "Copy")
  assert.equal(row.card_image_url, null)
  assert.equal(ok.json.pages[0].blocks[0].heading, "Hi")

  await call(route.DELETE, { scope, params: { id: "p2" } })
  const last = await call(route.DELETE, { scope, params: { id: "p1" } })
  assert.equal(last.status, 400, "deleting every page would reseed the defaults")
})

test("the content upgrade fills pictures and looks without overwriting owner edits, once", async () => {
  const load3 = loader()
  const { SITE_IMAGES } = load3("modules/content/site-images.ts")
  const state = {
    home: [
      { id: "p", key: "category-pills", type: "category_pills", position: 0, config: { items: [
        { label: "Phone Case", href: "/shop/" },
        { label: "StickPad", href: "/product/stickpad-pro/", image: "https://owner.example/own.webp" },
        { label: "Something New", href: "/x/" },
      ] } },
      { id: "h", key: "hero", type: "hero", position: 1, config: { slides: [{ heading: "Bug Life", href: "/collection/bug-life/" }] } },
      { id: "m", key: "delivery-marquee", type: "marquee", position: 2, title: "Fast Delivery", config: {} },
      { id: "r", key: "new-releases", type: "product_carousel", position: 3, config: { limit: 5 } },
      { id: "t", key: "testimonials", type: "testimonials", position: 4, config: { quotes: [] } },
    ],
    pages: [
      { id: "bl", collection_slug: "bug-life", theme: null, hero_image_url: null, blocks: null },
      { id: "lp", collection_slug: "leopard", theme: { bg: "#123456" }, hero_image_url: "https://owner.example/leo.webp", hero_mobile_image_url: null, blocks: [] },
      { id: "xx", collection_slug: "not-seeded", theme: null },
    ],
  }
  const logs = []
  const container = { resolve: (key) => key === "logger" ? { info: (m) => logs.push(m) } : contentService(state) }
  const service = contentService(state)
  const run = load3("migration-scripts/home-and-collection-looks.ts").default
  await run({ container: { resolve: (key) => key === "logger" ? { info: (m) => logs.push(m) } : service } })

  const pills = state.home.find((s) => s.id === "p").config.items
  assert.equal(pills[0].image, SITE_IMAGES.iconPhoneCase)
  assert.equal(pills[1].image, "https://owner.example/own.webp", "an owner's picture is kept")
  assert.equal(pills[2].image, undefined)
  const slides = state.home.find((s) => s.id === "h").config.slides
  assert.equal(slides[0].heading, "Built for the Newest")
  assert.equal(slides[1].image, SITE_IMAGES.heroBugLife)
  assert.equal(state.home.find((s) => s.id === "m").config.items[0], "Fast Delivery")
  const order = [...state.home].sort((a, b) => a.position - b.position).map((s) => s.key).join(",")
  assert.equal(order, "category-pills,hero,delivery-marquee,new-releases,shop-by-collection,airpods-banner,testimonials")

  const bug = state.pages.find((p) => p.id === "bl")
  assert.equal(bug.template, "split")
  assert.equal(bug.theme.bg, "#efebdd")
  assert.equal(bug.hero_image_url, SITE_IMAGES.heroBugLife)
  assert.equal(bug.blocks[0].cta_href, "/collection/bug-life/?form=airpods#shop")
  const leopard = state.pages.find((p) => p.id === "lp")
  assert.equal(leopard.theme.bg, "#123456", "a styled page keeps its theme")
  assert.equal(leopard.hero_image_url, "https://owner.example/leo.webp")
  assert.equal(leopard.hero_mobile_image_url, SITE_IMAGES.leopardHeroMobile, "empty fields are still filled")
  assert.equal(state.pages.find((p) => p.id === "xx").theme, null)

  const before = JSON.stringify(state)
  await run({ container: { resolve: (key) => key === "logger" ? { info: () => {} } : service } })
  assert.equal(JSON.stringify(state), before, "a second run changes nothing")
})
