// Phone colour pictures (PHONE_COLOURS.md): input rules, the save workflow, the
// store projections, shop cards, uploads, design delete and the Mockup set
// palette checks. The real-database path is in verify-product-manager-isolated.ts.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(file, dependencies = {}, options = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true, ...options },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, console, URL, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

class MedusaError extends Error {
  static Types = { INVALID_DATA: "invalid_data", NOT_FOUND: "not_found" }
  constructor(type, message) { super(message); this.type = type }
}
const utils = {
  Modules: { PRODUCT: "product", STORE: "store", FILE: "file" },
  ContainerRegistrationKeys: { QUERY: "query", LOGGER: "logger" },
  ProductStatus: { PUBLISHED: "published" },
  MedusaError,
}
const settingsLib = load("lib/mockup-settings.ts", { "@medusajs/framework/utils": utils })
const inputLib = load("lib/phone-colour-input.ts", { "@medusajs/framework/utils": utils, "./mockup-settings": settingsLib, "./product-manager-input": load("lib/product-manager-input.ts") })
const coloursLib = load("lib/phone-colours.ts", { "./mockup-settings": settingsLib })
const catalogModule = { CATALOG_MODULE: "catalog" }
const steps = {}
load("workflows/phone-colours.ts", {
  "@medusajs/framework/utils": utils,
  "@medusajs/framework/workflows-sdk": {
    createStep: (name, fn, compensate) => { steps[name] = { fn, compensate }; return fn },
    createWorkflow: () => ({}),
    StepResponse: class { constructor(value, compensateInput) { this.value = value; this.compensateInput = compensateInput } },
    WorkflowResponse: class {},
  },
  "../modules/catalog": catalogModule,
  "../lib/mockup-settings": settingsLib,
  "../lib/phone-colour-input": inputLib,
})
const routeDeps = (depth) => {
  const up = "../".repeat(depth)
  return {
    "@medusajs/framework/utils": utils,
    [`${up}modules/catalog`]: catalogModule,
    [`${up}lib/mockup-settings`]: settingsLib,
    [`${up}lib/phone-colours`]: coloursLib,
  }
}
const paletteRoute = load("api/store/phone-colours/route.ts", routeDeps(3))
const productRoute = load("api/store/phone-colours/product/route.ts", routeDeps(4))
const variantRoute = load("api/store/phone-colours/variant/[id]/route.ts", routeDeps(5))
const cardsRoute = load("api/store/shop-cards/route.ts", routeDeps(3))
const uploadRoute = load("api/admin/designs/upload/route.ts", {
  "@medusajs/framework/utils": utils,
  "../../../../lib/create-uploaded-design": { slugify: (s) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") },
  "../../../../lib/mockup-settings": settingsLib,
})
const designRoute = load("api/admin/designs/[slug]/route.ts", {
  "@medusajs/framework/utils": utils,
  "../../../../modules/catalog": catalogModule,
  "../../../../lib/design-admin": { getDesignDetail: async () => null },
  "../../../../lib/edit-design": { editDesignMeta: async () => ({}) },
  "../../../../lib/audience": load("lib/audience.ts"),
})
const mockupsRoute = load("api/admin/mockups/route.ts", {
  "@medusajs/medusa/core-flows": { updateStoresWorkflow: () => ({ run: async () => ({}) }) },
  "../../../modules/catalog": catalogModule,
  "../../../lib/mockup-settings": settingsLib,
  "../../../lib/phone-colours": coloursLib,
})

// --- fixtures ----------------------------------------------------------------------------------------
const id = (prefix, n) => `${prefix}_${String(n).padStart(26, "0")}`
const P1 = id("prod", 1)
const P2 = id("prod", 2)
const V18 = id("variant", 18)
const V18_ALC = id("variant", 181)
const V17 = id("variant", 17)
const V_GONE = id("variant", 99)
const V_NO_MAIN = id("variant", 182)
const V_PINK = id("variant", 183)
const IMG = "https://img.florayn.com/designs/muse/signature/iphone-18-pro-max"
const SILVER = [`${IMG}/silver/1-01KA.webp`, `${IMG}/silver/2-01KB.webp`]
const GLACIER = [`${IMG}/glacier/1-01KC.webp`]
const SETS = [
  { device: "iphone-18-pro-max", base_url: "https://img.florayn.com/mockups/iphone-18-pro-max/v1", colours: ["Black", "Silver", "Burgundy", "Glacier"], default_colour: "Black", enabled: true, swatches: { Silver: "#E3E4E5" } },
  { device: "iphone-17-pro-max", base_url: "https://img.florayn.com/mockups/iphone-17-pro-max/v1", colours: ["Black", "Deep Blue", "Cosmic Orange"], default_colour: "Deep Blue", enabled: false, swatches: { Black: "#000000" } },
]
const row = (n, variant_id, product_id, device_slug, colour_slug, is_main, images = null, case_type_slug = "signature") => ({ id: `pcgal_${n}`, product_id, variant_id, device_slug, case_type_slug, colour_slug, is_main, images, source: "mockup_studio" })
const ROWS = () => [
  row(1, V18, P1, "iphone-18-pro-max", "black", true),
  row(2, V18, P1, "iphone-18-pro-max", "silver", false, SILVER),
  row(3, V18, P1, "iphone-18-pro-max", "glacier", false, GLACIER),
  row(4, V18, P1, "iphone-18-pro-max", "pink", false, ["https://img.florayn.com/pink.webp"]),
  row(5, V18_ALC, P1, "iphone-18-pro-max", "silver", true, null, "alcantara"),
  row(6, V17, P1, "iphone-17-pro-max", "deep-blue", true),
  row(7, V17, P1, "iphone-17-pro-max", "black", false, ["https://img.florayn.com/designs/muse/signature/iphone-17-pro-max/black/1-01KD.webp"]),
  row(8, V_GONE, P1, "iphone-18-pro-max", "black", true),
  row(9, V_GONE, P1, "iphone-18-pro-max", "silver", false, ["https://img.florayn.com/orphan.webp"]),
  row(10, V_NO_MAIN, P1, "iphone-18-pro-max", "silver", false, ["https://img.florayn.com/no-main.webp"]),
  row(11, V_NO_MAIN, P1, "iphone-18-pro-max", "glacier", false, ["https://img.florayn.com/no-main-2.webp"]),
  row(12, V_PINK, P1, "iphone-18-pro-max", "pink", true),
  row(13, V_PINK, P1, "iphone-18-pro-max", "silver", false, ["https://img.florayn.com/pink-main.webp"]),
  row(14, id("variant", 201), P2, "iphone-18-pro-max", "burgundy", true),
]

function fakeCatalog(rows = [], { devices = [], caseTypes = [] } = {}) {
  let next = 100
  const calls = []
  // Set to "delete", "update" or "create" to make that write fail (a database error).
  const faults = { write: null }
  const matches = (r, filter) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v))
  const pick = (r, select) => (select ? Object.fromEntries(select.map((k) => [k, r[k] ?? null])) : { ...r })
  const checkIndexes = (list) => {
    const keys = new Set()
    const mains = new Set()
    for (const r of list) {
      const key = `${r.variant_id}|${r.colour_slug}`
      if (keys.has(key)) throw new Error(`duplicate ${key}`)
      keys.add(key)
      if (r.is_main && mains.has(r.variant_id)) throw new Error(`two main rows for ${r.variant_id}`)
      if (r.is_main) mains.add(r.variant_id)
    }
  }
  const fail = (kind) => { if (faults.write === kind) throw new Error("database went away") }
  // The module's writes on one list of rows: the stored rows, or a transaction's copy.
  const writes = (list) => ({
    create: async (data) => {
      calls.push(["create", plain(data)])
      fail("create")
      for (const d of data) list.push({ ...d, id: d.id ?? `pcgal_${next++}` })
      checkIndexes(list)
    },
    update: async (data) => {
      calls.push(["update", plain(data)])
      fail("update")
      for (const d of data) Object.assign(list.find((r) => r.id === d.id), d)
      checkIndexes(list)
    },
    delete: async (selector) => {
      calls.push(["delete", plain(selector)])
      fail("delete")
      const gone = (r) => (Array.isArray(selector) ? selector.includes(r.id) : matches(r, selector))
      for (let i = list.length - 1; i >= 0; i--) if (gone(list[i])) list.splice(i, 1)
    },
  })
  const stored = writes(rows)
  // One module transaction: the writes go to a copy that replaces the rows only
  // when every write succeeded (commit); any error leaves them as they were (rollback).
  const transaction = async (fn) => {
    const copy = rows.map((r) => ({ ...r, images: r.images ? [...r.images] : r.images }))
    const result = await fn(writes(copy), copy)
    rows.splice(0, rows.length, ...copy)
    return result
  }
  const ROW_FIELDS = ["id", "product_id", "variant_id", "device_slug", "case_type_slug", "colour_slug", "is_main", "images", "source"]
  return {
    rows, calls, faults,
    listPhoneColourGalleries: async (filter = {}, config = {}) => {
      calls.push(["list", plain(filter), plain(config)])
      return rows.filter((r) => matches(r, filter)).slice(0, config.take ?? Infinity).map((r) => pick(r, config.select))
    },
    createPhoneColourGalleries: (data) => stored.create(data),
    updatePhoneColourGalleries: (data) => stored.update(data),
    deletePhoneColourGalleries: (selector) => stored.delete(selector),
    // The catalog service's savePhoneColourRows: lock, read, plan and write in one transaction.
    savePhoneColourRows: (variants, source) => transaction(async (tx, copy) => {
      const ids = [...new Set(variants.map((v) => v.variantId))]
      calls.push(["save", ids, source])
      const snapshot = copy.filter((r) => ids.includes(r.variant_id)).map((r) => pick(r, ROW_FIELDS))
      const plan = inputLib.planColourRows(snapshot, variants, source)
      if (plan.remove.length) await tx.delete(plan.remove)
      if (plan.update.length) await tx.update(plan.update)
      if (plan.promote.length) await tx.update(plan.promote)
      if (plan.create.length) await tx.create(plan.create)
      return { plan, snapshot }
    }),
    restorePhoneColourRows: (variantIds, snapshot) => transaction(async (tx, copy) => {
      calls.push(["restore", [...variantIds]])
      const now = copy.filter((r) => variantIds.includes(r.variant_id)).map((r) => r.id)
      if (now.length) await tx.delete(now)
      if (snapshot.length) await tx.create(snapshot.map((r) => ({ ...r, images: r.images ?? null })))
    }),
    listDevices: async ({ slug }) => devices.filter((d) => slug.includes(d.slug)),
    listCaseTypes: async ({ slug }) => caseTypes.filter((c) => slug.includes(c.slug)),
  }
}
const storeWith = (sets) => ({ listStores: async () => [{ id: "store", metadata: { florayn_mockups: { sets } } }] })
function productModule(products, variants) {
  const calls = []
  const byId = (filter, value) => (Array.isArray(filter) ? filter.includes(value) : filter === value)
  return {
    calls,
    listProducts: async (filter, config) => {
      calls.push(["products", plain(filter), plain(config)])
      return products.filter((p) => byId(filter.id, p.id) && (!filter.status || p.status === filter.status)).map((p) => ({ id: p.id }))
    },
    listProductVariants: async (filter, config) => {
      calls.push(["variants", plain(filter), plain(config)])
      return variants.filter((v) => (filter.id ? byId(filter.id, v.id) : v.product_id === filter.product_id)).map((v) => ({ id: v.id, product_id: v.product_id }))
    },
  }
}
async function call(handler, req, services) {
  const res = {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = plain(value); return this },
  }
  await handler({ query: {}, params: {}, body: {}, scope: { resolve: (k) => { if (!services[k]) throw new Error(`Unexpected resolve ${k}`); return services[k] } }, ...req }, res)
  return res
}

// --- input -------------------------------------------------------------------------------------------
const good = () => ({ source: "mockup_studio", variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "black", galleries: { silver: SILVER, glacier: GLACIER }, replace: true }] })

test("colourGalleriesInput accepts Studio's body and fills the defaults", () => {
  assert.deepEqual(plain(inputLib.colourGalleriesInput(good())), plain(good()))
  const manual = plain(inputLib.colourGalleriesInput({ variants: [{ variantId: V18, main: "deep-blue" }] }))
  assert.deepEqual(manual, { source: "manual", variants: [{ variantId: V18, main: "deep-blue", galleries: {}, replace: false }] }, "a single-colour marker has no galleries")
})

test("colourGalleriesInput: slugs start with a letter (never all digits), main is not an extra, 11 extras at most", () => {
  const withMain = (main) => ({ variants: [{ variantId: V18, main }] })
  for (const slug of ["Black", "12", "1black", "-black", "black-", "deep--blue", "deep_blue", "a".repeat(41), "", null, 7]) {
    assert.throws(() => inputLib.colourGalleriesInput(withMain(slug)), /main colour/, String(slug))
  }
  for (const slug of ["black", "deep-blue", "a1", "a".repeat(40)]) assert.doesNotThrow(() => inputLib.colourGalleriesInput(withMain(slug)), slug)
  const withExtra = (galleries) => ({ variants: [{ variantId: V18, main: "black", galleries }] })
  assert.throws(() => inputLib.colourGalleriesInput(withExtra({ 2026: SILVER })), /not a colour web name/)
  assert.throws(() => inputLib.colourGalleriesInput(withExtra({ black: SILVER })), /black is the main colour/)
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${String.fromCharCode(97 + i)}`, SILVER]))
  assert.doesNotThrow(() => inputLib.colourGalleriesInput(withExtra(many(11))))
  assert.throws(() => inputLib.colourGalleriesInput(withExtra(many(12))), /up to 11 extra/)
  assert.throws(() => inputLib.colourGalleriesInput(withExtra([])), /colour galleries/)
})

test("colourGalleriesInput: galleries are 1-30 HTTPS URLs; variants are 1-100, unique, addressed one way", () => {
  const withExtra = (urls) => ({ variants: [{ variantId: V18, main: "black", galleries: { silver: urls } }] })
  assert.doesNotThrow(() => inputLib.colourGalleriesInput(withExtra(Array.from({ length: 30 }, (_, i) => `${IMG}/silver/${i}.webp`))))
  assert.throws(() => inputLib.colourGalleriesInput(withExtra(Array.from({ length: 31 }, (_, i) => `${IMG}/silver/${i}.webp`))), /up to 30/)
  assert.throws(() => inputLib.colourGalleriesInput(withExtra(["http://img.florayn.com/x.webp"])), /HTTPS/)
  assert.throws(() => inputLib.colourGalleriesInput(withExtra([`https://img.florayn.com/${"x".repeat(2040)}`])), /HTTPS/)
  assert.throws(() => inputLib.colourGalleriesInput(withExtra([])), /at least one picture/)
  const entry = { caseType: "signature", device: "iphone-18-pro-max", main: "black" }
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [] }), /1 to 100/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: Array.from({ length: 101 }, (_, i) => ({ ...entry, device: `phone-${i}` })) }), /1 to 100/)
  assert.doesNotThrow(() => inputLib.colourGalleriesInput({ variants: Array.from({ length: 100 }, (_, i) => ({ ...entry, device: `phone-${i}` })) }))
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [entry, { ...entry }] }), /listed twice/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [{ variantId: V18, main: "black" }, { variantId: V18, main: "silver" }] }), /listed twice/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [{ ...entry, variantId: V18 }] }), /not both/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [{ main: "black" }] }), /variant ID, or its case type/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [{ ...entry, device: "iPhone 18" }] }), /web names/)
  assert.throws(() => inputLib.colourGalleriesInput({ variants: [{ ...entry, replace: "yes" }] }), /replace/)
  assert.throws(() => inputLib.colourGalleriesInput({ source: "feed", variants: [entry] }), /mockup_studio or manual/)
  assert.throws(() => inputLib.colourGalleriesInput(null), /Send the phone colour/)
})

// --- the row plan --------------------------------------------------------------------------------------
const resolved = (patch = {}) => ({ variantId: V18, productId: P1, deviceSlug: "iphone-18-pro-max", caseTypeSlug: "signature", main: "black", galleries: { silver: SILVER }, replace: true, ...patch })
const applyPlan = (rows, plan) => {
  let next = 1
  const out = rows.filter((r) => !plan.remove.includes(r.id)).map((r) => ({ ...r }))
  for (const u of [...plan.update, ...plan.promote]) Object.assign(out.find((r) => r.id === u.id), u)
  for (const c of plan.create) out.push({ id: `new_${next++}`, ...c })
  return out
}

test("planColourRows creates the main marker and extras, and the same input again writes nothing", () => {
  const plan = plain(inputLib.planColourRows([], [resolved()], "mockup_studio"))
  assert.deepEqual(plan.create.map((r) => [r.colour_slug, r.is_main, r.images]), [["silver", false, SILVER], ["black", true, null]], "extras first is fine: creates run last")
  assert.equal(plan.saved, 2)
  const after = applyPlan([], plan)
  assert.deepEqual(plain(inputLib.planColourRows(after, [resolved()], "mockup_studio")), { remove: [], update: [], promote: [], create: [], saved: 2 })
})

test("planColourRows moves the main colour without two main rows, and replace removes unlisted colours", () => {
  const rows = [
    row(1, V18, P1, "iphone-18-pro-max", "black", true),
    row(2, V18, P1, "iphone-18-pro-max", "silver", false, SILVER),
    row(3, V18, P1, "iphone-18-pro-max", "glacier", false, GLACIER),
    row(4, V17, P1, "iphone-17-pro-max", "black", true),
  ]
  const plan = plain(inputLib.planColourRows(rows, [resolved({ main: "silver", galleries: { black: ["https://img.florayn.com/black.webp"] } })], "manual"))
  assert.deepEqual(plan.remove, ["pcgal_3"], "replace removes glacier")
  assert.deepEqual(plan.update, [{ id: "pcgal_1", is_main: false, images: ["https://img.florayn.com/black.webp"], source: "manual" }], "the old main is demoted first")
  assert.deepEqual(plan.promote, [{ id: "pcgal_2", is_main: true, images: null, source: "manual" }])
  assert.deepEqual(plan.create, [])
  const after = applyPlan(rows, plan)
  assert.deepEqual(after.filter((r) => r.variant_id === V18 && r.is_main).map((r) => r.colour_slug), ["silver"])
  assert.ok(after.some((r) => r.id === "pcgal_4"), "other variants are untouched")
  // Without replace, unlisted extras stay; an unlisted old main (no pictures of its own) still goes.
  const keep = plain(inputLib.planColourRows(rows, [resolved({ main: "silver", galleries: {}, replace: false })], "manual"))
  assert.deepEqual(keep.remove, ["pcgal_1"])
  assert.deepEqual(keep.promote.map((r) => r.id), ["pcgal_2"])
  assert.equal(applyPlan(rows, keep).filter((r) => r.variant_id === V18).length, 2, "glacier kept")
})

// --- the workflow steps -------------------------------------------------------------------------------
function workflowContainer({ products, rows = [], sets = SETS } = {}) {
  const catalog = fakeCatalog(rows, {
    devices: [{ slug: "iphone-18-pro-max", name: "iPhone 18 Pro Max" }, { slug: "iphone-16", name: "iPhone 16" }, { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max" }],
    caseTypes: [{ slug: "signature", name: "Signature" }, { slug: "alcantara", name: "Alcantara" }],
  })
  const graphs = []
  const query = { graph: async (q) => { graphs.push(plain(q)); return { data: plain(products ?? designProducts()) } } }
  const services = { query, catalog, store: storeWith(sets) }
  return { container: { resolve: (k) => services[k] }, catalog, graphs }
}
const variant = (vid, device, caseType, images = 13) => ({ id: vid, metadata: { device_slug: device, case_type_slug: caseType, images: Array.from({ length: images }, (_, i) => `${IMG}/${i + 1}.webp`) } })
const designProducts = () => [
  { id: P1, handle: "muse", metadata: { design_slug: "muse", form: "phone" }, variants: [variant(V18, "iphone-18-pro-max", "signature"), variant(V18_ALC, "iphone-18-pro-max", "alcantara"), variant(id("variant", 16), "iphone-16", "signature")] },
  { id: P2, handle: "muse-airpods", metadata: { design_slug: "someone-else", form: "airpods" }, variants: [variant(id("variant", 300), "iphone-18-pro-max", "signature")] },
]
const resolve = (container, body, designSlug = "muse") => steps["resolve-colour-variants"].fn({ designSlug, ...body }, { container }).then((r) => plain(r.value))

test("resolve-colour-variants maps inputs to owned variants and reads the design like getDesignDetail", async () => {
  const { container, graphs } = workflowContainer()
  const out = await resolve(container, good())
  assert.deepEqual(graphs[0].filters, { handle: ["muse", "muse-airpods", "muse-watch", "muse-wallet"] })
  assert.deepEqual(out.variants, [{ variantId: V18, productId: P1, deviceSlug: "iphone-18-pro-max", caseTypeSlug: "signature", main: "black", galleries: { silver: SILVER, glacier: GLACIER }, replace: true }])
  assert.deepEqual(out.warnings, [
    "iPhone 18 Pro Max: Silver has 2 pictures, the main colour has 13. Shoppers switching colour start at picture 1.",
    "iPhone 18 Pro Max: Glacier has 1 picture, the main colour has 13. Shoppers switching colour start at picture 1.",
  ], "a length difference is a warning, never a rejection")
  const byId = await resolve(container, { source: "manual", variants: [{ variantId: V18_ALC, main: "silver" }] })
  assert.equal(byId.variants[0].caseTypeSlug, "alcantara", "the table accepts any case type")
})

test("resolve-colour-variants refuses another design's variant, unknown pairs, models without a set and colours not in the palette", async () => {
  const { container } = workflowContainer()
  const refuse = (body, pattern, type = "invalid_data", slug) => assert.rejects(resolve(container, body, slug), (error) => { assert.equal(error.type, type); assert.match(error.message, pattern); return true })
  await refuse({ variants: [{ variantId: id("variant", 300), main: "black" }] }, /Variant 1 is not part of this design/)
  await refuse({ variants: [{ caseType: "alcantara", device: "iphone-16", main: "black" }] }, /^iPhone 16 has no Alcantara case in this design\. Add the model first\.$/)
  await refuse({ variants: [{ caseType: "signature", device: "iphone-16", main: "black" }] }, /^iPhone 16 has no phone colours\. Add them in Mockup sets\.$/)
  await refuse({ variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "deep-blue" }] }, /deep-blue is not a phone colour of iPhone 18 Pro Max/)
  await refuse({ variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "black", galleries: { pink: SILVER } }] }, /pink is not a phone colour/)
  await refuse({ variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "black" }, { variantId: V18, main: "black" }] }, /listed twice/)
  await refuse({ variants: [{ variantId: V18, main: "Black" }] }, /main colour/)
  await refuse(good(), /No design found/, "not_found", "missing")
})

test("upsert-colour-galleries writes the plan in a safe order, in one module save, reports saved/removed and can be undone", async () => {
  const existing = [row(1, V18, P1, "iphone-18-pro-max", "black", true), row(2, V18, P1, "iphone-18-pro-max", "glacier", false, GLACIER), row(3, V17, P1, "iphone-17-pro-max", "black", true)]
  const { container, catalog } = workflowContainer({ rows: existing.map((r) => ({ ...r })) })
  const input = { source: "manual", warnings: ["w"], variants: [resolved({ main: "silver", galleries: { black: SILVER } })] }
  const response = await steps["upsert-colour-galleries"].fn(input, { container })
  assert.deepEqual(plain(response.value), { saved: 2, removed: 1, warnings: ["w"] })
  assert.deepEqual(catalog.calls[0], ["save", [V18], "manual"], "the step reads, plans and writes through one transactional module call")
  assert.deepEqual(catalog.calls.map((c) => c[0]), ["save", "delete", "update", "create"], "old rows go and the old main is demoted before a new main appears")
  assert.deepEqual(plain(response.compensateInput), { variantIds: [V18], snapshot: plain(existing.slice(0, 2)) }, "the undo input is the snapshot read inside the transaction")
  const mine = () => plain(catalog.rows.filter((r) => r.variant_id === V18).map(({ colour_slug, is_main, images }) => ({ colour_slug, is_main, images })).sort((a, b) => a.colour_slug.localeCompare(b.colour_slug)))
  assert.deepEqual(mine(), [{ colour_slug: "black", is_main: false, images: SILVER }, { colour_slug: "silver", is_main: true, images: null }])
  await steps["upsert-colour-galleries"].compensate(response.compensateInput, { container })
  assert.deepEqual(catalog.calls.slice(4).map((c) => c[0]), ["restore", "delete", "create"], "the undo is one transactional module call too")
  assert.deepEqual(plain(catalog.rows).sort((a, b) => a.id.localeCompare(b.id)), plain(existing), "compensation recreates the snapshot, IDs included")
})

test("upsert-colour-galleries: a failed save changes nothing and never touches another writer's rows", async () => {
  // Another save (e.g. the console's retry of this request) already committed these rows.
  const theirs = [row(1, V18, P1, "iphone-18-pro-max", "black", true), row(2, V18, P1, "iphone-18-pro-max", "silver", false, SILVER), row(3, V18, P1, "iphone-18-pro-max", "glacier", false, GLACIER)]
  const { container, catalog } = workflowContainer({ rows: theirs.map((r) => ({ ...r })) })
  catalog.faults.write = "create"
  const input = { source: "manual", warnings: [], variants: [resolved({ main: "burgundy", galleries: { silver: GLACIER } })] }
  await assert.rejects(steps["upsert-colour-galleries"].fn(input, { container }), /^Error: database went away$/, "the original error surfaces unchanged")
  assert.deepEqual(catalog.calls.map((c) => c[0]), ["save", "delete", "update", "create"], "no restore, list, delete or create of its own after the failure")
  assert.deepEqual(plain(catalog.rows), plain(theirs), "the transaction rolled back: the other writer's rows survive exactly")
  // A failing write anywhere in the plan rolls back the earlier ones too.
  for (const write of ["delete", "update"]) {
    catalog.faults.write = write
    await assert.rejects(steps["upsert-colour-galleries"].fn(input, { container }), /database went away/)
    assert.deepEqual(plain(catalog.rows), plain(theirs), write)
  }
  catalog.faults.write = null
  await steps["upsert-colour-galleries"].fn(input, { container })
  assert.deepEqual(catalog.rows.filter((r) => r.is_main).map((r) => r.colour_slug), ["burgundy"], "the same save succeeds once the database is back")
})

test("POST /admin/designs/:slug/colours: refusals are 400/404 with their message, a server failure is a 500 the console retries", async () => {
  let outcome
  const coloursRoute = load("api/admin/designs/[slug]/colours/route.ts", {
    "@medusajs/framework/utils": utils,
    "../../../../../workflows/phone-colours": { savePhoneColourGalleriesWorkflow: () => ({ run: async ({ input }) => { if (outcome instanceof Error) throw outcome; return { result: { ...outcome, input } } } }) },
  })
  const logged = []
  const services = { logger: { error: (message) => logged.push(message) } }
  const post = (slug = "muse") => call(coloursRoute.POST, { params: { slug }, body: good() }, services)
  outcome = { saved: 3, removed: 0, warnings: [] }
  let res = await post()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.input, { designSlug: "muse", source: "mockup_studio", variants: good().variants })
  outcome = new MedusaError("invalid_data", "pink is not a phone colour of iPhone 18 Pro Max. Choose one from its Mockup set.")
  res = await post()
  assert.deepEqual([res.statusCode, res.body], [400, { message: outcome.message }])
  outcome = new MedusaError("not_found", "No design found for \"muse\".")
  res = await post()
  assert.deepEqual([res.statusCode, res.body], [404, { message: outcome.message }])
  assert.deepEqual(logged, [], "refusals are not logged")
  outcome = new Error("Connection terminated unexpectedly")
  res = await post()
  assert.deepEqual([res.statusCode, res.body], [500, { message: "Could not save the phone colour pictures. Try again." }], "the cause stays in the server log")
  assert.deepEqual(logged, ["[design-colours muse] Connection terminated unexpectedly"])
  assert.equal((await post("../x")).statusCode, 400)
})

// The real catalog service methods, with the Medusa decorators replaced by a recording transaction.
function catalogService(rows) {
  const events = []
  const tx = { execute: async (sql, params = []) => { events.push(["sql", sql, plain(params)]) } }
  const inTx = (context) => context?.transactionManager === tx
  const InjectTransactionManager = () => (target, key, descriptor) => {
    const original = descriptor.value
    descriptor.value = async function (...args) {
      events.push(["begin", key])
      args[2] = { transactionManager: tx }
      try {
        const result = await original.apply(this, args)
        events.push(["commit"])
        return result
      } catch (error) {
        events.push(["rollback"])
        throw error
      }
    }
  }
  const { default: Service } = load("modules/catalog/service.ts", {
    "@medusajs/framework/utils": { MedusaContext: () => () => {}, InjectManager: () => () => {}, InjectTransactionManager, MedusaService: () => class {} },
    "../../lib/phone-colour-input": inputLib,
    "./models/case-type": {}, "./models/design": {}, "./models/device": {}, "./models/phone-colour-gallery": {},
  }, { experimentalDecorators: true })
  const service = new Service()
  const faults = { write: null }
  const record = (kind) => async (data, context) => {
    events.push([kind, plain(data), inTx(context)])
    if (faults.write === kind) throw new Error("database went away")
  }
  Object.assign(service, {
    listPhoneColourGalleries: async (filter, config, context) => {
      events.push(["list", plain(filter), plain(config), inTx(context)])
      return rows.filter((r) => filter.variant_id.includes(r.variant_id)).map((r) => ({ ...r }))
    },
    deletePhoneColourGalleries: record("delete"),
    updatePhoneColourGalleries: record("update"),
    createPhoneColourGalleries: record("create"),
  })
  return { service, events, faults }
}

test("catalog service: a save locks its variants (sorted), then reads, plans and writes inside one transaction", async () => {
  const existing = [row(1, V18, P1, "iphone-18-pro-max", "black", true), row(2, V18, P1, "iphone-18-pro-max", "glacier", false, GLACIER), row(3, V17, P1, "iphone-17-pro-max", "deep-blue", true)]
  const { service, events, faults } = catalogService(existing)
  const variants = [resolved({ main: "silver", galleries: { black: SILVER } }), resolved({ variantId: V17, deviceSlug: "iphone-17-pro-max", main: "deep-blue", galleries: {} })]
  const { plan, snapshot } = await service.savePhoneColourRows(variants, "manual")
  const lock = (vid) => ["sql", "select pg_advisory_xact_lock(hashtext('phone_colour_gallery'), hashtext(?))", [vid]]
  assert.deepEqual(events.map((e) => e[0]), ["begin", "sql", "sql", "sql", "list", "delete", "update", "update", "create", "commit"])
  assert.deepEqual(events[1], ["sql", "set local lock_timeout = '30s'", []], "a stuck save fails instead of waiting forever")
  assert.deepEqual(events.slice(2, 4), [lock(V17), lock(V18)], "one lock per variant, in ID order, so two saves never deadlock")
  assert.deepEqual(events[4], ["list", { variant_id: [V18, V17] }, { select: ["id", "product_id", "variant_id", "device_slug", "case_type_slug", "colour_slug", "is_main", "images", "source"], take: 10000 }, true], "the plan is made from rows read under the lock")
  assert.ok(events.slice(4, 9).every((e) => e[e.length - 1] === true), "every read and write uses the transaction")
  assert.deepEqual(plain(snapshot), plain(existing))
  assert.deepEqual(plain(plan), plain(inputLib.planColourRows(existing, variants, "manual")))
  // A failing write rolls the whole save back and surfaces its own error.
  events.length = 0
  faults.write = "create"
  await assert.rejects(service.savePhoneColourRows(variants, "manual"), /^Error: database went away$/)
  assert.deepEqual(events.map((e) => e[0]), ["begin", "sql", "sql", "sql", "list", "delete", "update", "update", "create", "rollback"])
  // The undo is atomic and locked too.
  events.length = 0
  faults.write = null
  await service.restorePhoneColourRows([V18, V18], snapshot.filter((r) => r.variant_id === V18))
  assert.deepEqual(events.map((e) => e[0]), ["begin", "sql", "sql", "list", "delete", "create", "commit"])
  assert.deepEqual(events[2], lock(V18), "a variant listed twice is locked once")
  assert.deepEqual(events[3], ["list", { variant_id: [V18] }, { select: ["id"], take: 10000 }, true])
  assert.deepEqual(events[5][1].map((r) => r.id), ["pcgal_1", "pcgal_2"], "IDs included")
})

// --- store projections ----------------------------------------------------------------------------------
const LIVE = [V18, V18_ALC, V17, V_NO_MAIN, V_PINK].map((vid) => ({ id: vid, product_id: P1 }))
function storeServices({ published = true, rows = ROWS(), sets = SETS } = {}) {
  const product = productModule([{ id: P1, status: published ? "published" : "draft" }, { id: P2, status: "draft" }], [...LIVE, { id: id("variant", 201), product_id: P2 }])
  const catalog = fakeCatalog(rows)
  return { product, catalog, store: storeWith(sets) }
}

test("product payload: palette order, main first, base + tails round trip, galleries only for the requested model", async () => {
  const services = storeServices()
  const res = await call(productRoute.GET, { query: { product_id: P1, device: "iphone-18-pro-max" } }, services)
  assert.equal(res.statusCode, 200)
  const body = res.body
  assert.deepEqual(body.colours, [
    ["black", "Black", "#1d1d1f"], ["silver", "Silver", "#e3e4e5"], ["glacier", "Glacier", "#dbe7ee"],
    ["black", "Black", "#000000"], ["deep-blue", "Deep Blue", "#34405a"],
  ], "only used colours; the 17's Black has its own dot, so it is its own entry")
  assert.deepEqual(body.variants, { [V18]: [0, 1, 2], [V17]: [4, 3] }, "pink (not in the palette), a main-only pair, an orphan, no main row and a main outside the palette are all left out")
  assert.equal(body.base, `${IMG}/`)
  assert.deepEqual(Object.keys(body.galleries), [V18], "the 17 Pro Max galleries load lazily")
  assert.deepEqual(body.galleries[V18].silver, ["silver/1-01KA.webp", "silver/2-01KB.webp"])
  assert.deepEqual(body.galleries[V18].silver.map((t) => coloursLib.expandTail(body.base, t)), SILVER)
  assert.deepEqual(body.galleries[V18].glacier.map((t) => coloursLib.expandTail(body.base, t)), GLACIER)
  assert.equal(body.galleries[V18].pink, undefined)
  // No image columns in the matrix read; the image read is the one model's extra rows.
  const lists = services.catalog.calls.filter((c) => c[0] === "list")
  assert.deepEqual(lists[0], ["list", { product_id: P1 }, { select: ["variant_id", "device_slug", "colour_slug", "is_main"], take: 5000 }])
  assert.deepEqual(lists[1], ["list", { product_id: P1, device_slug: "iphone-18-pro-max", is_main: false }, { select: ["variant_id", "colour_slug", "is_main", "images"], take: 1000 }])
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 1200)
})

test("product payload is {} for a draft, a product without colours or bad input is a 400", async () => {
  assert.deepEqual((await call(productRoute.GET, { query: { product_id: P1, device: "iphone-18-pro-max" } }, storeServices({ published: false }))).body, {})
  assert.deepEqual((await call(productRoute.GET, { query: { product_id: P1, device: "iphone-18-pro-max" } }, storeServices({ rows: [] }))).body, {})
  assert.deepEqual((await call(productRoute.GET, { query: { product_id: P1, device: "iphone-18-pro-max" } }, storeServices({ sets: [] }))).body, {}, "colours only for models with a set")
  for (const query of [{ device: "iphone-18-pro-max" }, { product_id: "prod_1", device: "x" }, { product_id: P1 }, { product_id: P1, device: "iPhone 18" }, { product_id: [P1], device: "x" }]) {
    const services = storeServices()
    assert.equal((await call(productRoute.GET, { query }, services)).statusCode, 400, JSON.stringify(query))
    assert.equal(services.catalog.calls.length, 0)
  }
})

test("variant payload: extra colours of one published variant only", async () => {
  let res = await call(variantRoute.GET, { params: { id: V18 } }, storeServices())
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.base, `${IMG}/`)
  assert.deepEqual(Object.keys(res.body.galleries), ["silver", "glacier"])
  assert.deepEqual(res.body.galleries.silver.map((t) => coloursLib.expandTail(res.body.base, t)), SILVER)
  res = await call(variantRoute.GET, { params: { id: V18_ALC } }, storeServices())
  assert.deepEqual(res.body, { base: "", galleries: {} }, "a main-only variant has nothing to load")
  assert.equal((await call(variantRoute.GET, { params: { id: V18 } }, storeServices({ published: false }))).statusCode, 404)
  assert.equal((await call(variantRoute.GET, { params: { id: V_GONE } }, storeServices())).statusCode, 404, "a deleted variant's rows are inert")
  for (const bad of ["variant_1", `variant_${"a".repeat(26)}`, "prod_x", "../x"]) assert.equal((await call(variantRoute.GET, { params: { id: bad } }, storeServices())).statusCode, 400, bad)
})

test("shop palette: palette order with availability from published products; sets switched off still count", async () => {
  let res = await call(paletteRoute.GET, { query: { device: "iphone-18-pro-max", case_type: "signature" } }, storeServices())
  assert.deepEqual(res.body, { caseType: "signature", default: "black", colours: [
    ["black", "Black", "#1d1d1f", 1], ["silver", "Silver", "#e3e4e5", 1], ["burgundy", "Burgundy", "#c9c9cf", 0], ["glacier", "Glacier", "#dbe7ee", 1],
  ] }, "Burgundy's only row is a draft product's")
  res = await call(paletteRoute.GET, { query: { device: "iphone-17-pro-max", case_type: "signature" } }, storeServices())
  assert.equal(res.body.default, "deep-blue")
  assert.deepEqual(res.body.colours.map((c) => [c[0], c[3]]), [["black", 1], ["deep-blue", 1], ["cosmic-orange", 0]])
  res = await call(paletteRoute.GET, { query: { device: "iphone-16", case_type: "signature" } }, storeServices())
  assert.deepEqual(res.body, { caseType: "signature", default: null, colours: [] })
  for (const query of [{ device: "iphone-16" }, { device: "iPhone 16", case_type: "signature" }, { device: "x", case_type: ["a"] }]) {
    assert.equal((await call(paletteRoute.GET, { query }, storeServices())).statusCode, 400, JSON.stringify(query))
  }
})

test("shop palette: a deleted variant's rows never make a colour available, even on a published product", async () => {
  const rows = [...ROWS(), row(15, V_GONE, P1, "iphone-18-pro-max", "burgundy", false, ["https://img.florayn.com/orphan-burgundy.webp"])]
  const services = storeServices({ rows })
  const res = await call(paletteRoute.GET, { query: { device: "iphone-18-pro-max", case_type: "signature" } }, services)
  assert.deepEqual(res.body.colours.map((c) => [c[0], c[3]]), [["black", 1], ["silver", 1], ["burgundy", 0], ["glacier", 1]], "Burgundy's rows are a deleted variant's (published P1) and a draft's")
  const variantRead = services.product.calls.find((c) => c[0] === "variants")
  assert.deepEqual(variantRead[2], { select: ["id"], take: variantRead[1].id.length }, "one ID-only variant read")
  assert.ok(variantRead[1].id.includes(V_GONE) && new Set(variantRead[1].id).size === variantRead[1].id.length)
  assert.deepEqual(services.catalog.calls[0], ["list", { device_slug: "iphone-18-pro-max", case_type_slug: "signature" }, { select: ["colour_slug", "product_id", "variant_id"], take: 50000 }])
  // No rows: no product reads at all.
  const empty = storeServices({ rows: [] })
  assert.equal((await call(paletteRoute.GET, { query: { device: "iphone-18-pro-max", case_type: "signature" } }, empty)).body.colours.every((c) => c[3] === 0), true)
  assert.equal(empty.product.calls.length, 0)
})

test("commonBase keeps a / ending and the reader rule rebuilds every URL", () => {
  for (const urls of [
    [`${IMG}/silver/1.webp`, `${IMG}/glacier/2.webp`],
    [`${IMG}/silver/1.webp`],
    ["https://a.test/x/1.webp", "https://b.test/y/2.webp"],
    ["https://a.test/1.webp", "http://a.test/2.webp"],
  ]) {
    const base = coloursLib.commonBase(urls)
    assert.ok(base === "" || base.endsWith("/"), base)
    assert.deepEqual(urls.map((u) => coloursLib.expandTail(base, u.slice(base.length))), urls)
  }
  assert.equal(coloursLib.commonBase([]), "")
})

test("colour_usage counts rows per model and colour", () => {
  assert.deepEqual(plain(coloursLib.colourUsage(ROWS())), {
    "iphone-18-pro-max": { black: 2, silver: 5, glacier: 2, pink: 2, burgundy: 1 },
    "iphone-17-pro-max": { "deep-blue": 1, black: 1 },
  })
})

test("GET /admin/mockups adds colour_usage from one two-column read", async () => {
  const catalog = fakeCatalog(ROWS())
  catalog.listDevices = async () => [{ slug: "iphone-18-pro-max", name: "iPhone 18 Pro Max", family: "iphone" }]
  catalog.listCaseTypes = async () => [{ slug: "signature", name: "Signature", price: 1500 }]
  const res = await call(mockupsRoute.GET, {}, { catalog, store: storeWith(SETS) })
  assert.deepEqual(res.body.colour_usage["iphone-18-pro-max"].silver, 5)
  assert.deepEqual(catalog.calls[0], ["list", {}, { select: ["device_slug", "colour_slug"], take: 100000 }])
  assert.deepEqual(res.body.settings.sets[0].swatches, { Silver: "#e3e4e5" })
})

// --- shop cards ------------------------------------------------------------------------------------------
const card = (handle, variantId) => ({ handle, status: "published", metadata: { card: { pairs: { "iPhone 18 Pro Max|Signature": { variantId, image: `https://img.florayn.com/${handle}.webp` }, "iPhone 18 Pro Max|Alcantara": { variantId: "x", image: `https://img.florayn.com/${handle}-alc.webp` } } } } })
function cardServices(rows = ROWS()) {
  const products = [card("muse", V18), card("pink", V_PINK), card("legacy", id("variant", 400)), card("alc", V18_ALC)]
  return {
    product: { listProducts: async (filter) => products.filter((p) => filter.handle.includes(p.handle)) },
    catalog: fakeCatalog(rows),
  }
}
const cardQuery = (colour) => ({ handles: "muse,pink,legacy,alc", device: "iPhone 18 Pro Max", case_type: "Signature", ...(colour === undefined ? {} : { colour }) })

test("shop cards: colourImage from an extra row only; the card's own image never changes", async () => {
  const services = cardServices()
  const res = await call(cardsRoute.GET, { query: cardQuery("silver") }, services)
  assert.equal(res.statusCode, 200)
  const byHandle = Object.fromEntries(res.body.cards.map((c) => [c.handle, c]))
  assert.equal(byHandle.muse.colourImage, SILVER[0])
  assert.equal(byHandle.muse.image, "https://img.florayn.com/muse.webp")
  assert.equal(byHandle.pink.colourImage, "https://img.florayn.com/pink-main.webp")
  assert.equal(byHandle.legacy.colourImage, undefined, "no rows: the card keeps its own picture")
  assert.equal(byHandle.alc.colourImage, undefined, "a main row gives no colourImage")
  assert.equal(res.body.cards.length, 4, "colour never filters")
  const lists = services.catalog.calls
  assert.equal(lists.length, 1, "one query")
  assert.deepEqual(lists[0][1], { variant_id: [V18, V_PINK, id("variant", 400), V18_ALC], colour_slug: "silver", is_main: false })
  assert.deepEqual(lists[0][2], { select: ["variant_id", "images"], take: 4 })
  const black = await call(cardsRoute.GET, { query: cardQuery("black") }, cardServices())
  assert.equal(black.body.cards.find((c) => c.handle === "muse").colourImage, undefined, "the main colour's row has no pictures of its own")
})

test("shop cards: no colour means no colour read, and a bad colour is refused before any query", async () => {
  const services = cardServices()
  const res = await call(cardsRoute.GET, { query: cardQuery() }, services)
  assert.equal(services.catalog.calls.length, 0)
  assert.ok(res.body.cards.every((c) => !("colourImage" in c)))
  for (const colour of ["Silver", "12", "", ["silver"], "silver|x"]) {
    const s = cardServices()
    let reads = 0
    s.product.listProducts = async () => { reads++; return [] }
    assert.equal((await call(cardsRoute.GET, { query: cardQuery(colour) }, s)).statusCode, 400, JSON.stringify(colour))
    assert.equal(reads + s.catalog.calls.length, 0)
  }
  const many = Array.from({ length: 32 }, (_, i) => card(`d${i}`, id("variant", 500 + i)))
  const big = { product: { listProducts: async () => many }, catalog: fakeCatalog([]) }
  await call(cardsRoute.GET, { query: { handles: many.map((p) => p.handle).join(","), device: "iPhone 18 Pro Max", case_type: "Signature", colour: "silver" } }, big)
  assert.equal(big.catalog.calls.length, 1)
  assert.equal(big.catalog.calls[0][1].variant_id.length, 32, "at most 32 IDs in one query")
})

// --- uploads and delete ------------------------------------------------------------------------------
async function upload(body) {
  const files = []
  const res = await call(uploadRoute.POST, { body: { designSlug: "muse", caseTypeSlug: "signature", deviceSlug: "iphone-18-pro-max", index: 3, filename: "3.webp", mimeType: "image/webp", contentBase64: "AAAA", ...body } }, {
    file: { createFiles: async (file) => { files.push(file); return { url: `https://img.florayn.com/${file.filename}` } } },
    logger: { error: () => {} },
  })
  return { res, files }
}

test("upload: the colour folder only with colourSlug; invalid slugs are refused", async () => {
  let { res, files } = await upload({ colourSlug: "deep-blue" })
  assert.equal(res.body.key, "designs/muse/signature/iphone-18-pro-max/deep-blue/3.webp")
  assert.equal(files[0].filename, res.body.key)
  for (const none of [{}, { colourSlug: null }, { colourSlug: "" }]) {
    ;({ res } = await upload(none))
    assert.equal(res.body.key, "designs/muse/signature/iphone-18-pro-max/3.webp", "without it the key is unchanged")
  }
  for (const colourSlug of ["Silver", "12", "../x", "deep blue", 7]) {
    ;({ res, files } = await upload({ colourSlug }))
    assert.equal(res.statusCode, 400, String(colourSlug))
    assert.equal(files.length, 0)
  }
})

test("deleting a design also deletes its phone colour rows", async () => {
  const products = [
    { id: P1, handle: "muse", metadata: { design_slug: "muse" } },
    { id: P2, handle: "muse-airpods", metadata: { design_slug: "muse" } },
    { id: "prod_other", handle: "other", metadata: { design_slug: "other" } },
  ]
  const deleted = []
  const catalog = fakeCatalog([...ROWS(), row(50, "variant_other", "prod_other", "iphone-18-pro-max", "black", true)])
  const services = {
    product: { listProducts: async () => products, deleteProducts: async (ids) => { deleted.push(...ids) } },
    catalog,
    logger: { warn: () => {}, error: () => {} },
  }
  const res = await call(designRoute.DELETE, { params: { slug: "muse" } }, services)
  assert.deepEqual(res.body, { ok: true, deleted: 2 })
  assert.deepEqual(deleted, [P1, P2])
  assert.deepEqual(catalog.calls.find((c) => c[0] === "delete"), ["delete", { product_id: [P1, P2] }])
  assert.deepEqual(plain(catalog.rows.map((r) => r.product_id)), ["prod_other"])
  // A failed row cleanup never fails the delete: the rows are inert.
  const failing = { ...services, catalog: { deletePhoneColourGalleries: async () => { throw new Error("down") } } }
  assert.equal((await call(designRoute.DELETE, { params: { slug: "muse" } }, failing)).statusCode, 200)
})

// --- Mockup set palette checks -----------------------------------------------------------------------
const caseTypes = [{ slug: "signature" }]
const devices = [{ slug: "iphone-18-pro-max" }, { slug: "iphone-17-pro-max" }]
const settings = (patch = {}) => ({ case_type: "signature", shots: [1, 2], image_size: 1200, quality: 92, sets: [{ ...SETS[0], ...patch }] })

test("Mockup sets: swatches are #rrggbb for the set's own colours, saved lower-case", () => {
  const saved = plain(settingsLib.validateMockupSettings(settings({ swatches: { Silver: "#E3E4E5", Glacier: "#dbe7ee" } }), caseTypes, devices))
  assert.deepEqual(saved.sets[0].swatches, { Silver: "#e3e4e5", Glacier: "#dbe7ee" })
  assert.equal(plain(settingsLib.validateMockupSettings(settings({ swatches: undefined }), caseTypes, devices)).sets[0].swatches, undefined)
  assert.equal(plain(settingsLib.validateMockupSettings(settings({ swatches: {} }), caseTypes, devices)).sets[0].swatches, undefined)
  for (const swatches of [{ Pink: "#ffffff" }, { Silver: "e3e4e5" }, { Silver: "#e3e" }, { Silver: "#e3e4e5ff" }, { Silver: 123 }, ["#fff"], "#fff"]) {
    assert.throws(() => settingsLib.validateMockupSettings(settings({ swatches }), caseTypes, devices), /dot colour|colour dots/, JSON.stringify(swatches))
  }
})

test("Mockup sets: two colours with one web name, or a name without a leading letter, are refused", () => {
  assert.throws(() => settingsLib.validateMockupSettings({ ...settings(), sets: [SETS[0], { ...SETS[1], colours: ["Deep Blue", "Deep-Blue"], default_colour: "Deep Blue", swatches: undefined }] }, caseTypes, devices),
    /^Error: Mockup set 2: two colours make the same web name \(deep-blue\)\. Rename one\.$/)
  assert.throws(() => settingsLib.validateMockupSettings(settings({ colours: ["Black", "2026"], default_colour: "Black", swatches: undefined }), caseTypes, devices), /"2026" needs a name that starts with a letter/)
  assert.throws(() => settingsLib.validateMockupSettings(settings({ colours: ["Black", "5G Blue"], default_colour: "Black", swatches: undefined }), caseTypes, devices), /starts with a letter/)
  assert.doesNotThrow(() => settingsLib.validateMockupSettings(settings({ colours: ["Black", "Natural Titanium", "Blue (2)"], default_colour: "Black", swatches: undefined }), caseTypes, devices))
  // a plain object already has a "constructor" key: slug-keyed maps would read a function
  assert.throws(() => settingsLib.validateMockupSettings(settings({ colours: ["Black", "Constructor"], default_colour: "Black", swatches: undefined }), caseTypes, devices), /^Error: Mockup set 1: "Constructor" cannot be a phone colour name\. Rename it\.$/)
})

test("Mockup sets: old saved sets stay valid, cleanSet keeps swatches, readers skip clashing colours", () => {
  const old = { device: "iphone-18-pro-max", base_url: "https://x.test/v1", colours: ["Black", "Silver"], default_colour: "Black", enabled: true }
  assert.deepEqual(plain(settingsLib.mockupSettings({ sets: [old] }).sets[0]), old, "no swatches key appears")
  const kept = plain(settingsLib.mockupSettings({ sets: [{ ...old, swatches: { Silver: "#AABBCC", Pink: "#ffffff", Black: "nope" } }] }).sets[0])
  assert.deepEqual(kept.swatches, { Silver: "#aabbcc" })
  const clash = settingsLib.mockupSettings({ sets: [{ ...old, colours: ["Deep Blue", "Deep-Blue", "2026", "Constructor", "Mystery"], default_colour: "Deep Blue" }] }).sets[0]
  assert.deepEqual(plain(settingsLib.setPalette(clash)), [["deep-blue", "Deep Blue", "#34405a"], ["mystery", "Mystery", "#c9c9cf"]], "the first of two clashing names wins; invalid, reserved and unknown fall back")
  assert.equal(settingsLib.swatchHex({}, "constructor"), "#c9c9cf")
})

test("colourSlug is the console's slugify", () => {
  const console = fs.readFileSync(path.join(__dirname, "../console/src/ui.tsx"), "utf8").match(/export const slugify = \(s: string\) => (.+)\n/)[1]
  const slugify = new Function("s", `return ${console}`)
  for (const name of ["Black", "Deep Blue", "Natural Titanium", "Blue (2)", "Pro+ Max", " Space Black ", "A.B-C"]) assert.equal(settingsLib.colourSlug(name), slugify(name), name)
  assert.equal(settingsLib.colourSlug("Deep Blue"), "deep-blue")
})
