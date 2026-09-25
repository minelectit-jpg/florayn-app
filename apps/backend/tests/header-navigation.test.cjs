const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Load real sources (and their relative imports); only Medusa itself is stubbed.
const WORKFLOWS = new Map()
/** Each core flow records its input and answers with that input's rows, given ids. */
const coreFlows = new Proxy({}, {
  get(_target, name) {
    return () => ({
      run: async ({ input }) => {
        const calls = WORKFLOWS.get(name) ?? []
        calls.push(plain(input))
        WORKFLOWS.set(name, calls)
        const rows = Array.isArray(input) ? input : Object.values(input ?? {}).find(Array.isArray)
        return { result: (rows ?? []).map((row, i) => ({ id: `${String(name)}_${calls.length}_${i}`, ...row })) }
      },
    })
  },
})
const EXTERNAL = {
  "@medusajs/framework/utils": {
    Modules: {
      PRODUCT: "product", STORE: "store", FULFILLMENT: "fulfillment", SALES_CHANNEL: "sales_channel",
      API_KEY: "api_key", REGION: "region", TAX: "tax", STOCK_LOCATION: "stock_location",
    },
    ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query", PG_CONNECTION: "pg", LINK: "link" },
    ProductStatus: { PUBLISHED: "published" },
  },
  "@medusajs/medusa/core-flows": coreFlows,
}
/** What the script asks the storefront to refresh, and what the storefront answers. */
const refresh = { calls: [], answer: async () => true }
const STUBS = {
  [path.join(__dirname, "../src/modules/content/index.ts")]: { CONTENT_MODULE: "content" },
  [path.join(__dirname, "../src/modules/catalog/index.ts")]: { CATALOG_MODULE: "catalog" },
  [path.join(__dirname, "../src/lib/revalidate-storefront.ts")]: {
    revalidateStorefront: async (input) => {
      refresh.calls.push(plain(input))
      return refresh.answer(input)
    },
  },
}
const ENV = {}
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
      exports: module.exports, module, console, process: { env: ENV }, URL, URLSearchParams,
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
const defaults = load("modules/content/defaults.ts")
const script = load("migration-scripts/header-navigation-2026-09-27.ts")
const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"

const DEVICE_SLUGS = [
  "iphone-11", "iphone-11-pro", "iphone-11-pro-max", "iphone-12-mini", "iphone-12", "iphone-12-pro", "iphone-12-pro-max",
  "iphone-13-mini", "iphone-13", "iphone-13-pro", "iphone-13-pro-max", "iphone-14", "iphone-14-plus", "iphone-14-pro", "iphone-14-pro-max",
  "iphone-15", "iphone-15-plus", "iphone-15-pro", "iphone-15-pro-max", "iphone-16", "iphone-16-plus", "iphone-16-pro", "iphone-16-pro-max",
  "iphone-17", "iphone-17-air", "iphone-17-pro", "iphone-17-pro-max",
  "samsung-s23", "samsung-s23-plus", "samsung-s23-ultra", "samsung-s24", "samsung-s24-plus", "samsung-s24-ultra",
  "samsung-s25", "samsung-s25-plus", "samsung-s25-ultra", "samsung-s26", "samsung-s26-plus", "samsung-s26-ultra",
  "airpods-1-2", "airpods-3", "airpods-4", "airpods-pro", "airpods-pro-2", "airpods-pro-3", "airpods-max",
  "apple-watch-band", "card-wallet", "magsafe-wallet",
]
const CASE_TYPES = [
  ["essentials", "Essentials"], ["signature", "Signature"], ["signature-earbuds", "Signature Earbuds"], ["elite-clear", "Elite Clear"],
  ["armor-black", "Armor Black"], ["armor-clear", "Armor Clear"], ["alcantara", "Alcantara"], ["watch-band", "Watch Band"],
]

/**
 * The live database today (read from /store/content on 2026-09-25): both
 * header menus hold Phone Case, Earbuds Cases and Styles as links (the seed,
 * with Earbuds still on the phone's /signature/ URLs), the footer has its four
 * columns, and the Women and Men home pages have their shortcut pills.
 */
function liveState() {
  let n = 0
  const id = (prefix) => `${prefix}_${++n}`
  const state = { home: [], menus: [], items: [], devices: [], caseTypes: [] }
  const header = defaults.DEFAULT_MENU.filter((m) => m.menu === "primary" && m.label !== "Collections")
  const footer = defaults.DEFAULT_MENU.filter((m) => m.menu === "footer")
  const live = (href) => href.replace(/^(\/shop\/airpods-[a-z0-9-]+\/)signature-earbuds\/$/, "$1signature/")
  for (const menu of ["primary", "primary-men", "footer"]) {
    for (const [position, seed] of (menu === "footer" ? footer : header).entries()) {
      const section = { id: id("menusec"), menu, label: seed.label, href: seed.href && live(seed.href), position, is_visible: true, kind: "links", image_url: null, badge: null, placement: "all", config: null }
      state.menus.push(section)
      for (const [i, item] of seed.items.entries()) {
        state.items.push({ id: id("menuitem"), section_id: section.id, group: item.group ?? null, label: item.label, href: live(item.href), badge: item.badge ?? null, position: i, is_visible: true })
      }
    }
  }
  for (const [audience, sections] of [["women", defaults.DEFAULT_HOME_SECTIONS], ["men", defaults.DEFAULT_MEN_HOME_SECTIONS]]) {
    for (const section of sections) state.home.push({ id: id("homesec"), audience, ...plain(section) })
  }
  for (const [i, slug] of DEVICE_SLUGS.entries()) {
    const family = slug.startsWith("iphone") ? "iphone" : slug.startsWith("samsung") ? "samsung" : slug.startsWith("airpods") ? "airpods" : slug.includes("watch") ? "watch" : "wallet"
    state.devices.push({ id: id("dev"), slug, name: slug, family, badge: null, sort_order: i, is_active: true })
  }
  for (const [i, [slug, name]] of CASE_TYPES.entries()) {
    state.caseTypes.push({ id: id("casetype"), slug, name, image_url: null, is_active: true, sort_order: i })
  }
  return state
}
const inputOf = (state) => ({ menuSections: state.menus, menuItems: state.items, homeSections: state.home, devices: state.devices, caseTypes: state.caseTypes })

/** What the script's writes do, applied to the in-memory rows. */
function apply(state, plan) {
  let n = 0
  for (const update of plan.sectionUpdates) Object.assign(state.menus.find((s) => s.id === update.id), plain(update))
  for (const row of plan.sectionCreates) state.menus.push({ id: `menusec_new_${++n}`, ...plain(row) })
  for (const { id, badge } of plan.deviceBadges) state.devices.find((d) => d.id === id).badge = badge
  for (const { id, image_url } of plan.caseTypeImages) state.caseTypes.find((c) => c.id === id).image_url = image_url
}

test("header navigation plan on today's live menus", () => {
  const state = liveState()
  const before = plain(state)
  const plan = plain(script.planHeaderNavigation(inputOf(state)))
  assert.deepEqual(plain(state), before, "planning writes nothing")

  for (const [menu, pills] of [["primary", "/site/home/icon-"], ["primary-men", "/site/home/men/icon-"]]) {
    const section = (label) => state.menus.find((s) => s.menu === menu && s.label === label)
    const update = (label) => plan.sectionUpdates.find((u) => u.id === section(label).id)

    const phone = update("Phone Case")
    assert.equal(phone.kind, "devices")
    assert.deepEqual(phone.config, { families: ["iphone", "samsung"], case_type: "signature" })
    assert.ok(phone.image_url.startsWith(`${R2}${pills}phone-case-`), `${menu}: the mode's Phone Case shortcut picture`)
    assert.equal(phone.href, undefined, "the Phone Case link is kept")

    const earbuds = update("Earbuds Cases")
    assert.equal(earbuds.kind, "devices")
    assert.deepEqual(earbuds.config, { families: ["airpods"], case_type: "signature-earbuds" })
    assert.equal(earbuds.href, "/shop/airpods-pro-3/signature-earbuds/")
    assert.ok(earbuds.image_url.startsWith(`${R2}${pills}earbuds-case-`))

    const styles = update("Styles")
    assert.equal(styles.kind, "case_types")
    assert.deepEqual(styles.config, { form: "phone", exclude: [], links: { alcantara: "/collection/alcantara/", essentials: "/collection/essentials/" } })
    assert.equal(styles.image_url, undefined)

    const created = plan.sectionCreates.filter((c) => c.menu === menu)
    const collections = created.filter((c) => c.kind === "collections")
    assert.equal(collections.length, 1)
    assert.deepEqual(collections[0], {
      menu, label: "Collections", href: null, kind: "collections", image_url: null, badge: null, placement: "drawer",
      position: -1, is_visible: true, config: { title: "Collections", view_all_href: "/collections/", limit: 8 },
    }, "at the top, phone menu only")
    const accessories = created.filter((c) => c.kind === "links")
    assert.equal(accessories.length, 4)
    assert.ok(accessories.every((c) => c.placement === "drawer" && c.is_visible && c.config === null && c.image_url.startsWith(`${R2}${pills}`)))
    assert.deepEqual(accessories.map((c) => c.position), [3, 4, 5, 6], "after the existing sections, in shortcut order")
  }
  const labels = (menu) => plan.sectionCreates.filter((c) => c.menu === menu && c.kind === "links").map((c) => [c.label, c.href])
  assert.deepEqual(labels("primary"), [
    ["Watch Bands", "/collection/watch-bands/"],
    ["Card Holder", "/collection/card-wallets/?device=Card%20Wallet"],
    ["Phone Charms", "/product/leather-chain-phone-charm/"],
    ["StickPad", "/product/stickpad-pro/"],
  ], "Ring Holder and Fake Nails (Coming Soon) are skipped")
  assert.deepEqual(labels("primary-men"), [
    ["Watch Bands", "/collection/watch-bands/"],
    ["Card Holder", "/collection/card-wallets/?device=Card%20Wallet"],
    ["StickPad", "/product/stickpad-pro/"],
    ["Wallet", "/collection/card-wallets/"],
  ])
  assert.equal(plan.sectionUpdates.length, 6, "the footer is untouched")
  assert.ok(!plan.sectionCreates.some((c) => c.menu === "footer"))

  const slugOf = (id) => state.devices.find((d) => d.id === id).slug
  assert.deepEqual(plan.deviceBadges.map((b) => [slugOf(b.id), b.badge]).sort(), [
    ["airpods-pro-3", "New"], ["iphone-17", "New"], ["iphone-17-air", "New"], ["iphone-17-pro", "New"],
    ["iphone-17-pro-max", "New"], ["samsung-s26", "New"], ["samsung-s26-plus", "New"], ["samsung-s26-ultra", "New"],
  ], "8 device badges, each once although both menus carry them")

  const images = Object.fromEntries(plan.caseTypeImages.map((c) => [state.caseTypes.find((t) => t.id === c.id).slug, c.image_url]))
  assert.deepEqual(Object.keys(images).sort(), ["alcantara", "armor-black", "armor-clear", "elite-clear", "essentials", "signature"])
  assert.equal(images["armor-black"], `${R2}/site/case-types/armor-black-5115f65d.webp`)
  assert.ok(Object.values(images).every((url) => url.startsWith(`${R2}/site/case-types/`)))
})

test("re-planning on the result changes nothing", () => {
  const state = liveState()
  apply(state, script.planHeaderNavigation(inputOf(state)))
  assert.deepEqual(plain(script.planHeaderNavigation(inputOf(state))), { sectionUpdates: [], sectionCreates: [], deviceBadges: [], caseTypeImages: [] })
  assert.equal(state.items.length, liveState().items.length, "legacy links are kept")
})

test("only empty or default values are filled", () => {
  const state = liveState()
  const phone = state.menus.find((s) => s.menu === "primary" && s.label === "Phone Case")
  Object.assign(phone, { image_url: "https://r2.example/owner.webp" })
  const styles = state.menus.find((s) => s.menu === "primary" && s.label === "Styles")
  Object.assign(styles, { kind: "case_types", config: { form: "phone", exclude: ["armor-black"], links: {} } })
  const watch = state.menus.find((s) => s.menu === "primary" && s.label === "Earbuds Cases")
  Object.assign(watch, { kind: "devices", config: { families: ["airpods", "watch"], case_type: null } })
  state.menus.push({ id: "own_collections", menu: "primary", label: "Shop collections", kind: "collections", placement: "all", position: 9, is_visible: true, config: { title: "Ours", view_all_href: "/collections/", limit: 4 } })
  state.menus.push({ id: "own_watch", menu: "primary", label: "watch bands", kind: "links", placement: "all", position: 10, is_visible: true })
  state.devices.find((d) => d.slug === "iphone-17").badge = "Hot"
  state.caseTypes.find((c) => c.slug === "signature").image_url = "https://r2.example/sig.webp"
  // A style link the owner hid stays out of the automatic list.
  const menStyles = state.menus.find((s) => s.menu === "primary-men" && s.label === "Styles")
  state.items.find((i) => i.section_id === menStyles.id && i.label === "Armor Clear").is_visible = false

  const plan = plain(script.planHeaderNavigation(inputOf(state)))
  const update = (id) => plan.sectionUpdates.find((u) => u.id === id)
  assert.deepEqual(update(phone.id), { id: phone.id, kind: "devices", config: { families: ["iphone", "samsung"], case_type: "signature" } }, "the owner's picture is kept")
  assert.equal(update(styles.id), undefined, "an already typed Styles is left alone")
  assert.deepEqual(Object.keys(update(watch.id)).sort(), ["href", "id", "image_url"], "a typed Earbuds keeps its settings")
  assert.ok(!plan.sectionCreates.some((c) => c.menu === "primary" && c.kind === "collections"), "a collections section already exists")
  assert.ok(!plan.sectionCreates.some((c) => c.menu === "primary" && /watch bands/i.test(c.label)), "a section with that label exists")
  assert.ok(plan.sectionCreates.some((c) => c.menu === "primary-men" && c.label === "Watch Bands"), "each menu is checked on its own")
  assert.ok(!plan.deviceBadges.some((b) => state.devices.find((d) => d.id === b.id).slug === "iphone-17"))
  assert.equal(plan.deviceBadges.length, 7)
  assert.ok(!plan.caseTypeImages.some((c) => state.caseTypes.find((t) => t.id === c.id).slug === "signature"))
  assert.deepEqual(update(menStyles.id).config.exclude, ["armor-clear"], "hidden style links stay hidden")
})

test("an empty Men menu is left alone (it borrows the Women one); a missing case type opens the device's first style", () => {
  const state = liveState()
  state.menus = state.menus.filter((s) => s.menu !== "primary-men")
  state.caseTypes = state.caseTypes.filter((c) => c.slug !== "signature-earbuds")
  const plan = plain(script.planHeaderNavigation(inputOf(state)))
  assert.ok(!plan.sectionCreates.some((c) => c.menu === "primary-men"))
  const earbuds = state.menus.find((s) => s.label === "Earbuds Cases")
  assert.deepEqual(plan.sectionUpdates.find((u) => u.id === earbuds.id).config, { families: ["airpods"], case_type: null })
})

/** The seed's old hand-made Collections column (every database seeded since 2026-09-02), last in the menu. */
function addSeededCollections(state, menu, patch = {}) {
  const section = { id: `seeded_collections_${menu}`, menu, label: "Collections", href: null, kind: "links", placement: "all", position: 3, is_visible: true, image_url: null, badge: null, config: null, ...patch }
  state.menus.push(section)
  for (const [i, [label, href]] of [["Leopard", "/collection/leopard/"], ["Muse Marvel", "/collection/muse-marvel/"], ["van Gogh Dreams", "/collection/van-gogh-dreams/"], ["Bug Life", "/collection/bug-life/"]].entries()) {
    state.items.push({ id: `${section.id}_item_${i}`, section_id: section.id, group: null, label, href, badge: null, position: i, is_visible: true })
  }
  return section
}
const COLLECTIONS_ROW = { kind: "collections", placement: "drawer", position: -1, is_visible: true, config: { title: "Collections", view_all_href: "/collections/", limit: 8 } }

test("a seeded Collections column, shown or hidden, becomes the phone-menu Collections row at the top", () => {
  const state = liveState()
  const women = addSeededCollections(state, "primary")
  // The owner hid the Men copy (the store's content read never shows hidden rows).
  const men = addSeededCollections(state, "primary-men", { is_visible: false })
  const plan = plain(script.planHeaderNavigation(inputOf(state)))
  assert.deepEqual(plan.sectionUpdates.find((u) => u.id === women.id), { id: women.id, ...COLLECTIONS_ROW })
  assert.deepEqual(plan.sectionUpdates.find((u) => u.id === men.id), { id: men.id, ...COLLECTIONS_ROW }, "shown, first, phone menu only")
  assert.ok(!plan.sectionCreates.some((c) => c.kind === "collections"), "Collections never shows twice")

  apply(state, plan)
  for (const menu of ["primary", "primary-men"]) {
    const shown = state.menus.filter((s) => s.menu === menu && s.is_visible).sort((a, b) => a.position - b.position)
    assert.equal(shown[0].kind, "collections", `${menu}: first`)
    assert.equal(shown[0].placement, "drawer")
    assert.equal(shown.filter((s) => s.kind === "collections").length, 1)
  }
  assert.equal(state.items.filter((i) => i.section_id === women.id).length, 4, "its old links are kept")
  assert.deepEqual(plain(script.planHeaderNavigation(inputOf(state))), { sectionUpdates: [], sectionCreates: [], deviceBadges: [], caseTypeImages: [] }, "a second run changes nothing")
})

test("a Collections section the owner made is left alone", () => {
  const state = liveState()
  // Own links (not only collection pages), and a column with a link of its own.
  const own = addSeededCollections(state, "primary")
  state.items.push({ id: "own_link", section_id: own.id, group: null, label: "Gift cards", href: "/product/gift-card/", badge: null, position: 4, is_visible: true })
  const linked = addSeededCollections(state, "primary-men", { href: "/collections/" })
  const plan = plain(script.planHeaderNavigation(inputOf(state)))
  assert.equal(plan.sectionUpdates.find((u) => u.id === own.id), undefined)
  assert.equal(plan.sectionUpdates.find((u) => u.id === linked.id), undefined)
  for (const menu of ["primary", "primary-men"]) {
    const created = plan.sectionCreates.filter((c) => c.menu === menu && c.kind === "collections")
    assert.equal(created.length, 1, `${menu}: the automatic row is added beside it`)
    assert.deepEqual(created[0], { menu, label: "Collections", href: null, image_url: null, badge: null, ...COLLECTIONS_ROW })
  }
})

/** A container whose content and catalog modules read and write `state`, as the script uses them. */
function containerFor(state, logs) {
  let n = 0
  const match = (row, filter) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)
  const list = (key) => async (filter = {}, options = {}) => {
    let rows = state[key].filter((row) => match(row, filter))
    if (options.order?.position) rows = [...rows].sort((a, b) => a.position - b.position)
    return plain(rows)
  }
  const content = {
    listHomeSections: list("home"), createHomeSections: async () => { throw new Error("no seeding on a live database") },
    listMenuSections: list("menus"), createMenuSections: async (rows) => { for (const row of [].concat(rows)) state.menus.push({ id: `menusec_run_${++n}`, ...plain(row) }) },
    updateMenuSections: async (patch) => Object.assign(state.menus.find((s) => s.id === patch.id), plain(patch)),
    listMenuItems: list("items"),
  }
  const catalog = {
    listDevices: list("devices"), listCaseTypes: list("caseTypes"),
    updateDevices: async (rows) => { for (const row of rows) Object.assign(state.devices.find((d) => d.id === row.id), plain(row)) },
    updateCaseTypes: async (rows) => { for (const row of rows) Object.assign(state.caseTypes.find((c) => c.id === row.id), plain(row)) },
  }
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) }
  return { resolve: (key) => (key === "logger" ? logger : key === "catalog" ? catalog : content) }
}

test("the script applies the plan through the module services, logs its counts, refreshes the storefront, and a second run changes nothing", async () => {
  const state = liveState()
  const logs = []
  const container = containerFor(state, logs)
  refresh.calls = []
  refresh.answer = async () => true

  await script.default({ container })
  assert.ok(logs.some((m) => /6 menu sections updated, 10 added, 8 device badges, 6 case-type pictures/.test(m)))
  assert.equal(state.menus.filter((s) => s.kind === "devices").length, 4)
  assert.equal(state.devices.filter((d) => d.badge === "New").length, 8)
  assert.deepEqual(refresh.calls, [{ tags: ["content", "catalog", "products"] }], "menus, devices and case types: header, search index and pages")
  assert.match(logs.at(-1), /storefront refreshed/)

  const after = JSON.stringify(state)
  await script.default({ container })
  assert.equal(JSON.stringify(state), after)
  assert.match(logs.at(-1), /0 menu sections updated, 0 added, 0 device badges, 0 case-type pictures/)
  assert.equal(refresh.calls.length, 1, "nothing changed, nothing to refresh")
})

test("a storefront that cannot be refreshed never fails the migration", async () => {
  for (const answer of [async () => false, async () => { throw new Error("ECONNREFUSED") }]) {
    const state = liveState()
    const logs = []
    refresh.calls = []
    refresh.answer = answer
    await script.default({ container: containerFor(state, logs) })
    assert.equal(refresh.calls.length, 1)
    assert.equal(state.devices.filter((d) => d.badge === "New").length, 8, "the writes stand")
    assert.match(logs.at(-1), /^WARN .*not refreshed.*Refresh storefront now/)
  }
  refresh.answer = async () => true
})

test("a fresh database gets the New badges and style photos whichever script runs first", async () => {
  const seed = load("migration-scripts/initial-data-seed.ts").default
  const deviceSeeds = load("modules/catalog/data/devices.ts").DEVICES
  // Only the catalogue matters here; one collection keeps the product build small.
  ENV.SEED_THEME = "Alcantara"
  try {
    for (const scriptFirst of [true, false]) {
      const state = { home: [], menus: [], items: [], devices: [], caseTypes: [] }
      const logs = []
      const nav = containerFor(state, logs)
      let n = 0
      const catalog = {
        ...nav.resolve("catalog"),
        listDesigns: async () => [],
        createDevices: async (rows) => rows.map((row) => { const device = { id: `dev_${++n}`, ...plain(row) }; state.devices.push(device); return device }),
        createCaseTypes: async (rows) => rows.map((row) => { const type = { id: `ct_${++n}`, is_active: true, ...plain(row) }; state.caseTypes.push(type); return type }),
        createDesigns: async (rows) => rows.map((row) => ({ id: `des_${++n}`, ...row })),
      }
      const modules = {
        catalog,
        link: { create: async () => {} },
        query: { graph: async () => ({ data: [{ id: "sp_1" }] }) },
        fulfillment: { createFulfillmentSets: async () => ({ id: "fset_1", service_zones: [{ id: "sz_1" }] }) },
        sales_channel: { listSalesChannels: async () => [] },
        api_key: { listApiKeys: async () => [] },
        region: { listRegions: async () => [] },
        tax: { listTaxRegions: async () => [] },
      }
      const container = { resolve: (key) => modules[key] ?? nav.resolve(key) }
      refresh.calls = []
      if (scriptFirst) {
        // Scripts run in name order: header-navigation-... before initial-data-seed.
        await script.default({ container })
        await seed({ container })
      } else {
        await seed({ container })
        await script.default({ container })
      }

      assert.equal(state.devices.length, deviceSeeds.length)
      const badges = state.devices.filter((d) => d.badge).map((d) => [d.slug, d.badge]).sort()
      assert.deepEqual(badges, [
        ["airpods-pro-3", "New"], ["iphone-17", "New"], ["iphone-17-air", "New"], ["iphone-17-pro", "New"],
        ["iphone-17-pro-max", "New"], ["samsung-s26", "New"], ["samsung-s26-plus", "New"], ["samsung-s26-ultra", "New"],
      ], `script first: ${scriptFirst}`)
      assert.ok(state.devices.filter((d) => !d.badge).every((d) => d.badge === null))
      const photos = Object.fromEntries(state.caseTypes.filter((c) => c.image_url).map((c) => [c.slug, c.image_url]))
      assert.deepEqual(photos, plain(script.STYLE_IMAGES))
      assert.equal(state.caseTypes.find((c) => c.slug === "signature-earbuds").image_url, null)
      assert.deepEqual(refresh.calls, [], "no menu yet and nothing left to fill: no refresh either way")
    }
  } finally {
    delete ENV.SEED_THEME
  }
})
