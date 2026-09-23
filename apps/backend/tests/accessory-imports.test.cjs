const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, URLSearchParams, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

const utils = {
  ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query" },
  ProductStatus: { PUBLISHED: "published" },
}
const logger = { info: () => {}, warn: () => {} }
const siteImages = load("modules/content/site-images.ts")
const defaults = load("modules/content/defaults.ts", { "./site-images": siteImages })

function charmImport() {
  const created = []
  const rebuilt = []
  const products = [{ id: "prod_stickpad", handle: "stickpad-pro", shipping_profile: { id: "sp_1" }, sales_channels: [{ id: "sc_1" }] }]
  const query = {
    graph: async ({ filters }) => ({ data: plain(products.filter((p) => p.handle === filters.handle)) }),
  }
  const run = load("migration-scripts/import-phone-charm-2026-09-24.ts", {
    "@medusajs/framework/utils": utils,
    "@medusajs/medusa/core-flows": {
      createProductsWorkflow: () => ({ run: async ({ input }) => {
        const result = input.products.map((p, i) => ({ id: `prod_new_${i}`, ...p }))
        created.push(...plain(input.products))
        products.push(...result)
        return { result }
      } }),
    },
    "../lib/rebuild-cards": { rebuildCards: async (_container, opts) => { rebuilt.push(...opts.productIds); return opts.productIds.length } },
  })
  const container = { resolve: (key) => (key === "logger" ? logger : query) }
  return { run: () => run.default({ container }), created, rebuilt, module: run }
}

test("the phone charm imports once as a simple Color product, like StickPad", async () => {
  const charm = charmImport()
  await charm.run()
  assert.equal(charm.created.length, 1)
  const [product] = charm.created
  assert.equal(product.handle, "leather-chain-phone-charm")
  assert.equal(product.status, "published")
  assert.deepEqual(product.metadata, { form: "charm", design_name: "Leather Chain Phone Charm", design_slug: "leather-chain-phone-charm" })
  assert.equal(product.shipping_profile_id, "sp_1")
  assert.deepEqual(product.sales_channels, [{ id: "sc_1" }])
  assert.equal(product.options.length, 1, "one option makes it a simple product")
  assert.equal(product.options[0].title, "Color")
  assert.ok(!product.options[0].values.includes("Lavender"), "the sold-out colour stays out")
  assert.equal(product.variants.length, 7)
  assert.equal(new Set(product.variants.map((v) => v.sku)).size, 7)
  for (const variant of product.variants) {
    assert.equal(variant.manage_inventory, false)
    assert.deepEqual(variant.prices, [{ amount: 350, currency_code: "bdt" }])
    assert.equal(variant.options.Color, variant.title)
    assert.match(variant.metadata.images[0], /^https:\/\/pub-[a-f0-9]+\.r2\.dev\/phone-charms\/[a-z]+-[a-f0-9]{8}\.webp$/)
  }
  assert.equal(product.thumbnail, product.variants[0].metadata.images[0])
  assert.equal(product.images.length, 7)
  assert.deepEqual(charm.rebuilt, ["prod_new_0"], "its card is precomputed for the strips")

  await charm.run()
  assert.equal(charm.created.length, 1, "a second run does nothing")
})

function contentState() {
  const state = {
    home: [
      { id: "p", key: "category-pills", type: "category_pills", config: { items: [
        { label: "Phone Case", href: "/shop/?filter_device=iphone-17-pro-max&filter_case-type=signature&filter=1" },
        { label: "Earbuds Case", href: "/shop/?filter_device=airpods-pro-3&filter_case-type=signature&filter=1" },
        { label: "Watch Bands", href: "/collection/signature/" },
        { label: "Card Holder", href: "/collection/signature/" },
        { label: "Phone Charms", href: "/collection/signature/" },
        { label: "StickPad", href: "/product/stickpad-pro/" },
        { label: "Ring Holder", href: null, note: "Coming Soon" },
      ] } },
      { id: "m", key: "delivery-marquee", type: "marquee", title: "3 To 5 Days Delivery", config: { items: ["3 To 5 Days Delivery", "Cash On Delivery Across Bangladesh"] } },
      { id: "t", key: "secondary-tiles", type: "tile_grid", config: { columns: 4, tiles: [
        { label: "Magsafe Wallets", href: "/collection/signature/", image: "w" },
        { label: "Watch Bands", href: "/collection/owner-picked/" },
        { label: "Mystery", href: "/collection/signature/" },
      ] } },
      { id: "b", key: "airpods-banner", type: "banner", cta_href: "/shop/airpods-pro-3/signature-earbuds/", config: {} },
    ],
    contacts: [{ id: "contactset_default", faqs: [
      { id: "delivery", question: "How long?", answer: "Three to five days across Bangladesh. Delivery is 60৳ inside Dhaka." },
      { id: "returns", question: "Returns?", answer: "Within seven days." },
    ] }],
  }
  const update = (key) => async (patch) => Object.assign(state[key].find((row) => row.id === patch.id), plain(patch))
  const service = {
    listHomeSections: async () => plain(state.home),
    updateHomeSections: update("home"),
    listContactSettings: async () => plain(state.contacts),
    updateContactSettings: update("contacts"),
  }
  return { state, container: { resolve: (key) => (key === "logger" ? logger : service) } }
}

test("home accessory links, legacy shop links and delivery copy are fixed once, leaving owner edits alone", async () => {
  const migration = load("migration-scripts/accessory-links-and-delivery-2026-09-24.ts", {
    "@medusajs/framework/utils": utils,
    "../modules/content": { CONTENT_MODULE: "content" },
    "../modules/content/defaults": defaults,
  })
  const { state, container } = contentState()
  await migration.default({ container })

  const pills = state.home[0].config.items
  assert.equal(pills[0].href, "/shop/iphone-17-pro-max/signature/")
  assert.equal(pills[1].href, "/shop/airpods-pro-3/signature-earbuds/", "AirPods use their own case type")
  assert.equal(pills[2].href, "/collection/watch-bands/")
  assert.equal(pills[3].href, "/collection/card-wallets/?device=Card%20Wallet")
  assert.equal(pills[4].href, "/product/leather-chain-phone-charm/")
  assert.equal(pills[5].href, "/product/stickpad-pro/")
  assert.equal(pills[6].href, null)

  assert.equal(state.home[1].title, "1–3 Days Delivery")
  assert.deepEqual(state.home[1].config.items, ["1–3 Days Delivery", "Cash On Delivery Across Bangladesh"])

  const tiles = state.home[2].config.tiles
  assert.equal(tiles[0].href, "/collection/card-wallets/?device=MagSafe%20Wallet")
  assert.equal(tiles[0].image, "w")
  assert.equal(tiles[1].href, "/collection/owner-picked/", "an owner's own link is kept")
  assert.equal(tiles[2].href, "/collection/signature/", "an unknown label is left for the owner")
  assert.equal(state.home[2].config.columns, 4)

  assert.equal(state.contacts[0].faqs[0].answer, "One to three days across Bangladesh. Delivery is 60৳ inside Dhaka.")
  assert.equal(state.contacts[0].faqs[1].answer, "Within seven days.")

  const before = JSON.stringify(state)
  await migration.default({ container })
  assert.equal(JSON.stringify(state), before, "a second run changes nothing")
})

test("clean shop links keep anything that is not the legacy filter form", () => {
  const { cleanShopHref } = load("migration-scripts/accessory-links-and-delivery-2026-09-24.ts", {
    "@medusajs/framework/utils": utils,
    "../modules/content": { CONTENT_MODULE: "content" },
    "../modules/content/defaults": defaults,
  })
  assert.equal(cleanShopHref("/shop/?filter_device=galaxy-s25&filter_case-type=armor-clear&filter=1"), "/shop/galaxy-s25/armor-clear/")
  assert.equal(cleanShopHref("/shop/?filter_device=iphone-16"), "/shop/iphone-16/")
  assert.equal(cleanShopHref("/shop/?filter_device=../../x"), "/shop/?filter_device=../../x")
  assert.equal(cleanShopHref("/shop/?sort=new"), "/shop/?sort=new")
  assert.equal(cleanShopHref("https://example.com/shop/?filter_device=a"), "https://example.com/shop/?filter_device=a")
  assert.equal(cleanShopHref(null), null)
})

test("fresh seeds link accessories to real pages and use clean shop paths", () => {
  const seeded = JSON.stringify(defaults.DEFAULT_HOME_SECTIONS) + JSON.stringify(defaults.DEFAULT_MENU ?? "")
  assert.ok(!seeded.includes("filter_device"), "no redirecting legacy shop links")
  assert.ok(!seeded.includes("/collection/signature/"), "no placeholder links")
  const pills = defaults.DEFAULT_HOME_SECTIONS.find((s) => s.key === "category-pills").config.items
  const tiles = defaults.DEFAULT_HOME_SECTIONS.find((s) => s.key === "secondary-tiles").config.tiles
  for (const item of [...pills, ...tiles].filter((i) => i.href && !i.href.startsWith("/shop/"))) {
    assert.equal(item.href, defaults.ACCESSORY_LINKS[item.label.toLowerCase()], item.label)
  }
  assert.equal(defaults.DEFAULT_HOME_SECTIONS.find((s) => s.key === "delivery-marquee").title, "1–3 Days Delivery")
})
