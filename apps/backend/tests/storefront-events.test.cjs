const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(file, dependencies, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, ...globals,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

// Workflow constants come from the installed Medusa release, without booting
// Medusa. Module constants below are the verified 2.19 public event names.
const workflowEvents = require(path.join(path.dirname(require.resolve("@medusajs/utils")), "core-flows/events.js"))
const actions = ["CREATED", "UPDATED", "DELETED", "RESTORED", "ATTACHED", "DETACHED"]
const moduleEvents = (prefix, entities) => Object.fromEntries(entities.flatMap(([key, entity]) => actions.map((action) => [
  `${key}_${action}`, `${prefix}.${entity}.${action.toLowerCase()}`,
])))
const utils = {
  ...workflowEvents,
  Modules: { PRODUCT: "product" },
  ContainerRegistrationKeys: { QUERY: "query" },
  ProductEvents: moduleEvents("product", [
    ["PRODUCT", "product"], ["PRODUCT_VARIANT", "product-variant"], ["PRODUCT_OPTION", "product-option"],
    ["PRODUCT_COLLECTION", "product-collection"], ["PRODUCT_CATEGORY", "product-category"],
  ]),
  InventoryEvents: moduleEvents("inventory", [
    ["INVENTORY_ITEM", "inventory-item"], ["INVENTORY_LEVEL", "inventory-level"], ["RESERVATION_ITEM", "reservation-item"],
  ]),
}

function harness({ variants = {}, options = {}, rebuild, delivery = async () => true } = {}) {
  const timers = new Map()
  const rebuilt = []
  const invalidated = []
  const lookups = []
  const warnings = []
  const waits = []
  let timerId = 0
  const list = (kind, values) => async (filter, config) => {
    lookups.push({ kind, filter: plain(filter), config: plain(config) })
    assert.equal(config.withDeleted, true)
    assert.ok(config.take <= 100)
    return filter.id.flatMap((id) => values[id] ? [{ id, product_id: values[id] }] : [])
  }
  const productService = {
    listProductVariants: list("variant", variants),
    listProductOptions: list("option", options),
  }
  const container = { resolve: (name) => {
    assert.equal(name, "product")
    return productService
  } }
  const api = load("lib/storefront-events.ts", {
    "@medusajs/framework/utils": utils,
    "./rebuild-cards": { rebuildCards: async (scope, opts) => {
      assert.equal(scope, container)
      rebuilt.push(opts ? plain(opts) : null)
      return rebuild?.(opts)
    } },
    "./revalidate-storefront": { queueStorefrontRevalidation: async (input) => {
      invalidated.push(plain(input))
      return delivery(input)
    } },
  }, {
    console: { warn: (message) => warnings.push(message) },
    setTimeout: (fn, wait) => { const id = timerId++; timers.set(id, fn); waits.push(wait); return id },
  })
  return {
    ...api, container, timers, rebuilt, invalidated, lookups, warnings, waits,
    send: (name, data = { id: "item" }) => api.queueStorefrontEvent(container, name, data),
    async tick() {
      const entry = timers.entries().next().value
      assert.ok(entry, "expected a scheduled batch")
      timers.delete(entry[0])
      entry[1]()
      await new Promise(setImmediate)
    },
  }
}

test("workflow and direct module events coalesce affected cards before one invalidation", async () => {
  const h = harness({ variants: { v1: "p2", v2: "p2" } })
  const work = [
    h.send("product.updated", { id: "p1" }),
    h.send("product.product.updated", { id: "p1" }),
    h.send("product-variant.created", [{ id: "v1" }, { id: "v2" }]),
    h.send("product-category.created"),
    h.send("inventory.reservation-item.updated"),
  ]
  assert.equal(h.timers.size, 1)
  await h.tick()
  await Promise.all(work)
  assert.deepEqual(h.rebuilt, [{ productIds: ["p1", "p2"] }])
  assert.deepEqual(h.invalidated, [{ tags: ["products", "catalog", "stock"] }])
  assert.equal(h.lookups.length, 1)
})

test("soft-deleted variants and options resolve their original parent without rebuilding the catalogue", async () => {
  const h = harness({ variants: { removed: "parent" }, options: { option: "other" } })
  const work = [h.send("product-variant.deleted", { id: "removed" }), h.send("product-option.updated", { id: "option" })]
  await h.tick()
  await Promise.all(work)
  assert.deepEqual(h.rebuilt, [{ productIds: ["parent", "other"] }])
  assert.equal(h.lookups.length, 2)
})

test("unrecoverable variant parents cause one full paginated repair per coalesced batch", async () => {
  const h = harness()
  const work = Array.from({ length: 205 }, (_, i) => h.send("product.product-variant.deleted", { id: `missing-${i}` }))
  await h.tick()
  await Promise.all(work)
  assert.deepEqual(h.lookups.map((lookup) => lookup.config.take), [100, 100, 5])
  assert.deepEqual(h.rebuilt, [null])
  assert.equal(h.invalidated.length, 1)
})

test("deletions and collection/category membership expire readers; inventory does not reprice products", async () => {
  const h = harness()
  const work = [h.send("product.deleted"), h.send("product-collection.updated"), h.send("product.product-category.detached")]
  await h.tick()
  await Promise.all(work)
  assert.deepEqual(h.rebuilt, [])
  assert.deepEqual(h.invalidated[0], { tags: ["products", "catalog"] })
  const stock = h.send("inventory-level.updated")
  await h.tick()
  await stock
  assert.deepEqual(h.invalidated[1], { tags: ["stock"] })
  assert.equal(h.rebuilt.length, 0)
})

test("events arriving during a rebuild form a later batch without concurrent writers", async () => {
  let release
  let calls = 0
  const h = harness({ rebuild: () => ++calls === 1 ? new Promise((resolve) => { release = resolve }) : undefined })
  const first = h.send("product.updated", { id: "first" })
  await h.tick()
  const second = h.send("product.updated", { id: "second" })
  assert.equal(h.timers.size, 0)
  assert.equal(h.rebuilt.length, 1)
  release()
  await new Promise(setImmediate)
  await h.tick()
  await second
  assert.deepEqual(h.rebuilt, [{ productIds: ["first"] }, { productIds: ["second"] }])
})

test("failed batches retain affected IDs and merge later changes before their bounded retry", async () => {
  let calls = 0
  const h = harness({ rebuild: () => { if (++calls === 1) throw new Error("database unavailable") } })
  h.send("product.updated", { id: "failed-product" })
  await h.tick()
  assert.equal(h.invalidated.length, 0)
  assert.equal(h.warnings.length, 1)
  assert.equal(h.waits.at(-1), 60_000)
  h.send("product.updated", { id: "new-product" })
  h.send("inventory-level.updated")
  assert.equal(h.timers.size, 1)
  await h.tick()
  assert.deepEqual(h.rebuilt[1], { productIds: ["failed-product", "new-product"] })
  assert.equal(h.invalidated.length, 1)
  assert.deepEqual(h.invalidated[0].tags, ["products", "catalog", "stock"])
  assert.equal(h.timers.size, 0)
  let deliveries = 0
  const unavailable = harness({ delivery: async () => ++deliveries > 1 })
  unavailable.send("product-category.updated")
  await unavailable.tick()
  assert.equal(unavailable.warnings.length, 1)
  assert.equal(unavailable.waits.at(-1), 60_000)
  await unavailable.tick()
  assert.equal(unavailable.invalidated.length, 2)
  assert.equal(unavailable.timers.size, 0)
})

test("sequential Medusa subscriber invocations return before one shared background flush", async () => {
  const h = harness()
  const subscriber = load("subscribers/storefront-refresh.ts", { "../lib/storefront-events": h })
  await subscriber.default({ container: h.container, event: { name: "product.updated", data: { id: "first" } } })
  await subscriber.default({ container: h.container, event: { name: "product.updated", data: { id: "second" } } })
  assert.equal(h.rebuilt.length, 0)
  assert.equal(h.timers.size, 1)
  await h.tick()
  assert.deepEqual(h.rebuilt, [{ productIds: ["first", "second"] }])
})

test("a very large burst collapses ID tracking into one full paginated repair", async () => {
  const h = harness()
  for (let i = 0; i < 6000; i++) assert.equal(h.send("product-variant.updated", { id: `variant-${i}` }), undefined)
  await h.tick()
  assert.equal(h.lookups.length, 0)
  assert.deepEqual(h.rebuilt, [null])
  assert.equal(h.invalidated.length, 1)
})

test("subscriber covers create/update/delete and restoration without consuming unrelated events", async () => {
  const h = harness()
  for (const name of ["product.created", "product.product.updated", "product-variant.deleted", "product.product-variant.restored", "product-collection.updated", "product-category.deleted", "inventory-level.created", "inventory.reservation-item.deleted"]) {
    assert.ok(h.storefrontEventNames.includes(name), name)
  }
  await h.send("order.notification-sent")
  assert.equal(h.timers.size, 0)
})

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]))
  return value
}

test("card repair pages large catalogues and is idempotent after JSONB key reordering", async () => {
  const { buildCard } = load("lib/build-card-metadata.ts", {})
  const rows = Array.from({ length: 61 }, (_, i) => ({
    id: `p${String(i).padStart(3, "0")}`, metadata: { keep: "existing metadata" },
    options: [{ id: "device", title: "Device" }, { id: "case", title: "Case Type" }],
    variants: [{ id: `v${i}`, title: "Alcantara / Model 1", options: [{ option_id: "device", value: "Model 1" }, { option_id: "case", value: "Alcantara" }], metadata: { images: ["https://images.invalid/front.webp"] }, prices: [{ amount: 2100 + i, currency_code: "bdt" }] }],
  }))
  const reads = []
  const writes = []
  const { rebuildCards } = load("lib/rebuild-cards.ts", {
    "@medusajs/framework/utils": utils,
    "./build-card-metadata": { buildCard },
  })
  const container = { resolve: (name) => name === "query" ? { graph: async (query) => {
    reads.push(plain(query))
    assert.equal(query.pagination.take, 25)
    assert.deepEqual(plain(query.pagination.order), { id: "ASC" })
    const matching = query.filters?.id ? rows.filter((row) => query.filters.id.includes(row.id)) : rows
    return { data: matching.slice(query.pagination.skip, query.pagination.skip + query.pagination.take) }
  } } : { upsertProducts: async (updates) => {
    writes.push(plain(updates))
    for (const update of updates) rows.find((row) => row.id === update.id).metadata = reverseObjectKeys(plain(update.metadata))
  } } }
  assert.equal(await rebuildCards(container), 61)
  assert.deepEqual(writes.map((batch) => batch.length), [25, 25, 11])
  assert.equal(rows[0].metadata.keep, "existing metadata")
  assert.equal(await rebuildCards(container), 0, "its own metadata update must not trigger another card write")
  assert.equal(writes.length, 3)
  rows[0].variants[0].prices[0].amount = 2700
  assert.equal(await rebuildCards(container, { productIds: ["p000", "p000"] }), 1)
  assert.equal(rows[0].metadata.card.pairs["Model 1|Alcantara"].price, 2700)
  rows[0].variants = []
  assert.equal(await rebuildCards(container, { productIds: ["p000"] }), 1)
  assert.deepEqual(plain(rows[0].metadata.card.pairs), {})
  const previousReads = reads.length
  assert.equal(await rebuildCards(container, { productIds: [] }), 0)
  assert.equal(reads.length, previousReads, "an empty targeted repair must never mean the entire catalogue")
})
