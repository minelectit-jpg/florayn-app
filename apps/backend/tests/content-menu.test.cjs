const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Load real sources (and their relative imports); only Medusa itself is stubbed.
const EXTERNAL = {
  "@medusajs/framework/utils": {
    Modules: { PRODUCT: "product", STORE: "store" },
    ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query", PG_CONNECTION: "pg" },
  },
}
const STUBS = {
  [path.join(__dirname, "../src/modules/content/index.ts")]: { CONTENT_MODULE: "content" },
  [path.join(__dirname, "../src/modules/catalog/index.ts")]: { CATALOG_MODULE: "catalog" },
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
      exports: module.exports, module, console, process: { env: {} }, URL, URLSearchParams,
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

/** An in-memory content module with the service method names used. */
function contentService(state) {
  let n = 0
  const match = (row, filter) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)
  const list = (key) => async (filter = {}, options = {}) => {
    let rows = state[key].filter((row) => match(row, filter))
    if (options.order?.position) rows = [...rows].sort((a, b) => a.position - b.position)
    return plain(options.take ? rows.slice(0, options.take) : rows)
  }
  const create = (key, prefix) => async (data) => {
    const made = (Array.isArray(data) ? data : [data]).map((row) => ({ id: `${prefix}_${++n}`, ...plain(row) }))
    state[key].push(...made)
    return Array.isArray(data) ? made : made[0]
  }
  const update = (key) => async (patch) => Object.assign(state[key].find((row) => row.id === patch.id), plain(patch))
  return {
    listHomeSections: list("home"), createHomeSections: create("home", "homesec"),
    listMenuSections: list("menus"), createMenuSections: create("menus", "menusec"), updateMenuSections: update("menus"),
    listMenuItems: list("items"), createMenuItems: create("items", "menuitem"),
    listCollectionPages: list("pages"), createCollectionPages: create("pages", "colpage"), updateCollectionPages: update("pages"),
  }
}

function seededState() {
  return {
    home: [{ id: "w1", key: "hero", type: "hero", position: 0, is_visible: true, config: {} }],
    menus: [
      // An old row from before the migration: no kind, placement, image or badge.
      { id: "ms1", menu: "primary", label: "Styles", href: null, position: 2, is_visible: true },
      { id: "ms2", menu: "primary", label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", position: 0, is_visible: true,
        kind: "devices", image_url: "https://r2.example/phone.webp", badge: "New", placement: "all", config: { families: ["iphone", "samsung"], case_type: "signature" } },
      { id: "ms3", menu: "primary", label: "Case styles", href: null, position: 1, is_visible: true,
        kind: "case_types", image_url: null, badge: null, placement: "bar", config: { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/" } } },
      { id: "ms4", menu: "primary", label: "Collections", href: null, position: -1, is_visible: true,
        kind: "collections", image_url: null, badge: null, placement: "drawer", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } },
      { id: "ms5", menu: "primary", label: "Hidden", href: null, position: 3, is_visible: false, kind: "links", placement: "all" },
      { id: "ms6", menu: "footer", label: "About", href: null, position: 0, is_visible: true, kind: "links", placement: "all" },
    ],
    items: [
      // Legacy links of sections that now fill themselves: kept, never served.
      { id: "mi1", section_id: "ms2", group: "iPhone 17 Series", label: "iPhone 17 Pro Max", href: "/shop/iphone-17-pro-max/signature/", badge: "New", position: 0, is_visible: true },
      { id: "mi2", section_id: "ms3", group: null, label: "Alcantara", href: "/collection/alcantara/", badge: null, position: 0, is_visible: true },
      { id: "mi3", section_id: "ms4", group: null, label: "Leopard", href: "/collection/leopard/", badge: null, position: 0, is_visible: true },
      { id: "mi4", section_id: "ms1", group: null, label: "Essentials", href: "/collection/essentials/", badge: null, position: 1, is_visible: true },
      { id: "mi5", section_id: "ms1", group: null, label: "Alcantara", href: "/collection/alcantara/", badge: "Hot", position: 0, is_visible: true },
      { id: "mi6", section_id: "ms1", group: null, label: "Old", href: "/old/", badge: null, position: 2, is_visible: false },
      { id: "mi7", section_id: "ms6", group: null, label: "Terms", href: "/terms/", badge: null, position: 0, is_visible: true },
    ],
    pages: [
      { id: "cp1", collection_slug: "leopard", title: "Leopard", card_image_url: "https://r2.example/leopard.webp", is_visible: true, position: 0 },
      { id: "cp2", collection_slug: "bug-life", title: "Bug Life", card_image_url: "https://r2.example/bug.webp", is_visible: true, show_in_menu: false, position: 1 },
      { id: "cp3", collection_slug: "hidden", title: "Hidden", is_visible: false, position: 2 },
    ],
  }
}

test("buildMenu returns the typed fields; only links sections carry groups", () => {
  const { buildMenu } = loader()("modules/content/config.ts")
  const state = seededState()
  const menu = plain(buildMenu(state.menus, state.items, "primary"))
  assert.deepEqual(menu.map((s) => s.id), ["ms4", "ms2", "ms3", "ms1"], "position order; hidden sections left out")
  for (const section of menu) {
    assert.deepEqual(Object.keys(section), ["id", "label", "href", "kind", "image", "badge", "placement", "config", "groups"])
  }
  const [collections, phone, styles, legacy] = menu
  assert.deepEqual(phone.groups, [], "devices: legacy links stay in the database only")
  assert.deepEqual(styles.groups, [], "case_types")
  assert.deepEqual(collections.groups, [], "collections")
  assert.equal(phone.kind, "devices")
  assert.equal(phone.image, "https://r2.example/phone.webp")
  assert.equal(phone.badge, "New")
  assert.deepEqual(phone.config, { families: ["iphone", "samsung"], case_type: "signature" })
  assert.equal(styles.placement, "bar")
  assert.deepEqual(styles.config.links, { alcantara: "/collection/alcantara/" })
  assert.equal(collections.placement, "drawer")
  assert.deepEqual(legacy, {
    id: "ms1", label: "Styles", href: null, kind: "links", image: null, badge: null, placement: "all", config: null,
    groups: [{ heading: null, links: [
      { id: "mi5", label: "Alcantara", href: "/collection/alcantara/", badge: "Hot" },
      { id: "mi4", label: "Essentials", href: "/collection/essentials/", badge: null },
    ] }],
  }, "a pre-migration row reads as links shown everywhere, hidden links left out")
  const all = plain(buildMenu(state.menus, state.items, "primary", { visibleOnly: false }))
  assert.equal(all.length, 5)
  assert.equal(all.find((s) => s.id === "ms1").groups[0].links.length, 3)
  assert.deepEqual(all.find((s) => s.id === "ms2").groups, [], "admin reads keep automatic sections empty too")
})

test("copyMenu copies the typed fields with the sections and their links", async () => {
  const { copyMenu, MEN_MENU } = loader()("modules/content/config.ts")
  const state = seededState()
  const service = contentService(state)
  assert.equal(await copyMenu(service, "primary", MEN_MENU), 5)
  const copies = state.menus.filter((s) => s.menu === MEN_MENU)
  const phone = copies.find((s) => s.label === "Phone Case")
  assert.equal(phone.kind, "devices")
  assert.equal(phone.image_url, "https://r2.example/phone.webp")
  assert.equal(phone.badge, "New")
  assert.equal(phone.placement, "all")
  assert.deepEqual(phone.config, { families: ["iphone", "samsung"], case_type: "signature" })
  assert.equal(copies.find((s) => s.label === "Case styles").placement, "bar")
  assert.equal(copies.find((s) => s.label === "Collections").kind, "collections")
  const old = copies.find((s) => s.label === "Styles")
  assert.deepEqual([old.kind, old.image_url, old.badge, old.placement, old.config], ["links", null, null, "all", null], "pre-migration rows copy as links")
  assert.equal(state.items.filter((i) => i.section_id === phone.id).length, 1, "legacy links are copied as well")
  phone.config.families.push("airpods")
  assert.deepEqual(state.menus.find((s) => s.id === "ms2").config.families, ["iphone", "samsung"], "the copy is its own")
  assert.equal(await copyMenu(service, "primary", MEN_MENU), 0)
})

test("collection cards say whether they show in the menu", async () => {
  const { getCollectionCards } = loader()("modules/content/config.ts")
  const state = seededState()
  const productModule = {
    listProductCollections: async () => [{ id: "pcol_1", handle: "leopard", title: "Leopard" }, { id: "pcol_2", handle: "bug-life", title: "Bug Life" }],
    listProducts: async () => [],
  }
  const cards = plain(await getCollectionCards(contentService(state), productModule, null))
  assert.deepEqual(cards.map((c) => [c.slug, c.in_menu]), [["leopard", true], ["bug-life", false]])
})

test("/store/content adds the Navigation and Search settings, without the synonyms", async () => {
  const route = loader()("api/store/content/route.ts")
  const state = seededState()
  const service = contentService(state)
  const saved = {
    navigation: { family_labels: { samsung: "Galaxy" }, drawer_links: [{ label: "Track order", href: "/account/" }], remember_device: false },
    search: { placeholder: "Find a case", suggest_women: ["iPhone 17"], suggest_men: [], help_label: "Ask us", help_href: "/contact/", synonyms: [{ words: ["chita"], means: "leopard" }] },
  }
  const scope = {
    resolve(key) {
      if (key === "content") return service
      if (key === "pg") return null
      if (key === "store") return { listStores: async () => [{ id: "store_1", metadata: { florayn_presentation: saved } }] }
      return { listProductCollections: async () => [], listProducts: async () => [] }
    },
  }
  let json
  await route.GET({ query: {}, scope }, { json: (value) => { json = plain(value) } })
  assert.equal(json.navigation.family_labels.samsung, "Galaxy")
  assert.equal(json.navigation.family_labels.iphone, "iPhone", "missing brand names use the defaults")
  assert.deepEqual(json.navigation.drawer_links, [{ label: "Track order", href: "/account/" }])
  assert.equal(json.navigation.remember_device, false)
  assert.deepEqual(json.search, { placeholder: "Find a case", suggest_women: ["iPhone 17"], suggest_men: [], help_label: "Ask us", help_href: "/contact/" })
  assert.ok(!JSON.stringify(json).includes("chita"), "synonyms only go into the search index")
  assert.deepEqual(json.primary.map((s) => s.kind), ["collections", "devices", "case_types", "links"])
  assert.deepEqual(json.primary[1].groups, [])
  assert.equal(json.footer[0].kind, "links")
})

function adminHarness(state, caseTypes = [{ slug: "signature" }, { slug: "signature-earbuds" }]) {
  const service = contentService(state)
  const caseTypeCalls = []
  const devices = [{ id: "dev_1", slug: "iphone-17", name: "iPhone 17", badge: null }]
  const catalog = {
    listCaseTypes: async (filter, options) => { caseTypeCalls.push({ filter, options }); return caseTypes },
    updateDevices: async (rows) => rows.map((row) => Object.assign(devices.find((d) => d.id === row.id), row)),
  }
  const scope = { resolve: (key) => (key === "catalog" ? catalog : service) }
  const call = async (route, method, { body, params = {} } = {}) => {
    let status = 200
    let json
    const res = { status(code) { status = code; return this }, json(value) { json = plain(value); return this } }
    await route[method]({ body, params, scope }, res)
    return { status, json }
  }
  return { service, catalog, caseTypeCalls, devices, call }
}

test("admin: a section is created with a kind, and edited with checked typed fields", async () => {
  const load = loader()
  const create = load("api/admin/content/menu-sections/route.ts")
  const edit = load("api/admin/content/menu-sections/[id]/route.ts")
  const state = seededState()
  const admin = adminHarness(state)

  const made = await admin.call(create, "POST", { body: { menu: "primary-men", label: "Collections", kind: "collections", placement: "drawer" } })
  assert.equal(made.status, 200)
  const row = state.menus.at(-1)
  assert.deepEqual([row.menu, row.kind, row.placement, row.position], ["primary-men", "collections", "drawer", 0])
  assert.deepEqual(row.config, { title: "Collections", view_all_href: "/collections/", limit: 8 })
  assert.ok(made.json.menuSections.some((s) => s.id === row.id && s.kind === "collections"), "the admin read returns the new columns")
  assert.equal(admin.caseTypeCalls.length, 0, "no case-type read without a devices config")

  const plainNew = await admin.call(create, "POST", { body: { menu: "primary", label: "Sale", href: "/collection/sale/" } })
  assert.equal(plainNew.status, 200)
  assert.equal(state.menus.at(-1).kind, undefined, "a plain new section keeps the column default (links)")
  const footer = await admin.call(create, "POST", { body: { menu: "footer", label: "Help", kind: "devices" } })
  assert.equal(footer.status, 200)
  assert.deepEqual([state.menus.at(-1).kind, state.menus.at(-1).placement], ["links", "all"])
  const badKind = await admin.call(create, "POST", { body: { menu: "primary", label: "X", kind: "mega" } })
  assert.equal(badKind.status, 400)
  assert.equal(badKind.json.message, "Type must be Links, Device models, Case styles or Collections row.")

  const ok = await admin.call(edit, "POST", { params: { id: "ms1" }, body: {
    label: " Shop by style ", kind: "devices", badge: " New ", image_url: "https://r2.example/earbuds.webp", placement: "drawer",
    config: { families: ["airpods"], case_type: "signature-earbuds" },
  } })
  assert.equal(ok.status, 200)
  const edited = state.menus.find((s) => s.id === "ms1")
  assert.deepEqual([edited.label, edited.kind, edited.badge, edited.image_url, edited.placement], ["Shop by style", "devices", "New", "https://r2.example/earbuds.webp", "drawer"])
  assert.deepEqual(edited.config, { families: ["airpods"], case_type: "signature-earbuds" })
  assert.deepEqual(plain(admin.caseTypeCalls[0].filter), { is_active: true })
  assert.equal(state.items.filter((i) => i.section_id === "ms1").length, 3, "legacy links are kept for a rollback")

  for (const [body, message] of [
    [{ badge: "1234567890123" }, "Badge must be 12 characters or fewer."],
    [{ image_url: "http://r2.example/a.webp" }, "Use an https image link (pick one from the media library)."],
    [{ config: { families: [] } }, "Pick at least one brand."],
    [{ config: { families: ["iphone"], case_type: "leather" } }, "That case type does not exist."],
    [{ kind: "case_types", config: { links: { alcantara: "javascript:alert(1)" } } }, "Use a site path like /collection/leopard/ or a full https link."],
    [{ kind: "collections", config: { limit: 13 } }, "Show between 1 and 12 collections."],
  ]) {
    const before = JSON.stringify(state.menus)
    const refused = await admin.call(edit, "POST", { params: { id: "ms1" }, body: { label: "Changed", ...body } })
    assert.equal(refused.status, 400, JSON.stringify(body))
    assert.equal(refused.json.message, message)
    assert.equal(JSON.stringify(state.menus), before, "nothing is saved when a field is refused")
  }

  const back = await admin.call(edit, "POST", { params: { id: "ms1" }, body: { kind: "links" } })
  assert.equal(back.status, 200)
  assert.deepEqual([edited.kind, edited.config], ["links", null], "Type back to Links is the rollback")
  await admin.call(edit, "POST", { params: { id: "ms6" }, body: { kind: "collections", placement: "bar" } })
  const about = state.menus.find((s) => s.id === "ms6")
  assert.deepEqual([about.kind, about.placement, about.config], ["links", "all", null], "the footer stays links")
  const missing = await admin.call(edit, "POST", { params: { id: "nope" }, body: { label: "x" } })
  assert.equal(missing.status, 404)
})

test("admin: a device badge and a collection page's Show in menu are saved", async () => {
  const load = loader()
  const state = seededState()
  const admin = adminHarness(state)
  const device = load("api/admin/devices/[id]/route.ts")
  const saved = await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: " New " } })
  assert.equal(saved.status, 200)
  assert.equal(admin.devices[0].badge, "New")
  assert.equal(saved.json.device.badge, "New")
  const refused = await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: "Brand new model" } })
  assert.equal(refused.status, 400)
  assert.equal(refused.json.message, "Badge must be 12 characters or fewer.")
  assert.equal(admin.devices[0].badge, "New")
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: "" } })
  assert.equal(admin.devices[0].badge, null, "blank clears it")
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: "Hot" } })
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: null } })
  assert.equal(admin.devices[0].badge, null)
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { is_active: false } })
  assert.equal(admin.devices[0].is_active, false, "the other fields still save")
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { badge: "New" } })
  await admin.call(device, "POST", { params: { id: "dev_1" }, body: { name: "iPhone 17", badge: 5 } })
  assert.equal(admin.devices[0].badge, "New", "a save without a text badge leaves it alone")

  const page = load("api/admin/content/collection-pages/[id]/route.ts")
  const off = await admin.call(page, "POST", { params: { id: "cp1" }, body: { show_in_menu: false } })
  assert.equal(off.status, 200)
  assert.equal(state.pages[0].show_in_menu, false)
  assert.equal(off.json.pages.find((p) => p.id === "cp1").show_in_menu, false, "the admin list returns it")
  await admin.call(page, "POST", { params: { id: "cp1" }, body: { show_in_menu: "yes", title: "Leopard Print" } })
  assert.equal(state.pages[0].show_in_menu, false, "only a real true/false changes it")
  assert.equal(state.pages[0].title, "Leopard Print")
})

test("a fresh database seeds the typed header menu, shaped like the live one after the data move", async () => {
  const { getContent, buildMenu } = loader()("modules/content/config.ts")
  const state = { home: [], menus: [], items: [], pages: [] }
  const content = await getContent(contentService(state))
  const primary = plain(buildMenu(content.menuSections, content.items, "primary"))
  assert.deepEqual(primary.map((s) => [s.label, s.kind, s.placement]), [
    ["Collections", "collections", "drawer"],
    ["Phone Case", "devices", "all"],
    ["Earbuds Cases", "devices", "all"],
    ["Styles", "case_types", "all"],
  ])
  assert.deepEqual(primary[1].config, { families: ["iphone", "samsung"], case_type: "signature" })
  assert.deepEqual(primary[2].config, { families: ["airpods"], case_type: "signature-earbuds" })
  assert.equal(primary[2].href, "/shop/airpods-pro-3/signature-earbuds/")
  assert.deepEqual(primary[3].config.links, { alcantara: "/collection/alcantara/", essentials: "/collection/essentials/" })
  assert.ok(primary.every((s) => s.groups.length === 0), "the automatic sections serve no hand-made links")
  const footer = plain(buildMenu(content.menuSections, content.items, "footer"))
  assert.ok(footer.length > 0 && footer.every((s) => s.kind === "links" && s.placement === "all" && s.groups.length > 0))
})

test("/store/case-types fills unsaved per-device prices from the seed, like /admin/case-types", async () => {
  const route = loader()("api/store/case-types/route.ts")
  const calls = []
  const rows = [
    { slug: "alcantara", name: "Alcantara", price: 4200, price_groups: null, devices: [{ slug: "iphone-17-pro-max", family: "iphone" }] },
    { slug: "signature", name: "Signature", price: 1400, price_groups: [{ label: "All", price: 1300, devices: ["iphone-17"] }], devices: [] },
    { slug: "new-style", name: "New style", price: 900, price_groups: null, devices: [] },
  ]
  const scope = { resolve: () => ({ listCaseTypes: async (filter, options) => { calls.push({ filter, options }); return rows } }) }
  let json
  await route.GET({ scope }, { json: (value) => { json = plain(value) } })
  assert.deepEqual(plain(calls[0].filter), { is_active: true })
  assert.deepEqual(plain(calls[0].options.relations), ["devices"])
  const alcantara = json.case_types.find((c) => c.slug === "alcantara")
  assert.ok(Array.isArray(alcantara.price_groups) && alcantara.price_groups.some((g) => g.price < 4200), "the seed's cheaper groups")
  assert.deepEqual(json.case_types.find((c) => c.slug === "signature").price_groups, [{ label: "All", price: 1300, devices: ["iphone-17"] }], "saved groups win")
  assert.equal(json.case_types.find((c) => c.slug === "new-style").price_groups, null)
  assert.equal(json.count, 3)
})
