const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "@medusajs/framework/utils") return { Modules: { PRODUCT: "product" }, ContainerRegistrationKeys: { LOGGER: "logger", PG_CONNECTION: "pg" } }
    if (name === "../modules/content") return { CONTENT_MODULE: "content" }
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return exports
}

test("florayn.com reviews land approved on their designs with their original dates, once", async () => {
  const script = load("migration-scripts/import-florayn-reviews-2026-09-24.ts")
  const products = [
    { id: "p-grape", handle: "grape-goo", metadata: { design_slug: "grape-goo", form: "phone" } },
    { id: "p-leopard", handle: "shadow-leopard-airpods", metadata: { design_slug: "shadow-leopard", form: "airpods" } },
    { id: "p-sonar", handle: "sonar", metadata: { design_slug: "sonar", form: "phone" } },
  ]
  const reviews = []
  const dates = {}
  const content = {
    listProductReviews: async ({ review_key, customer_id }) => reviews.filter((r) => r.review_key === review_key && r.customer_id === customer_id),
    createProductReviews: async (row) => { const made = { id: `review_${reviews.length + 1}`, ...row }; reviews.push(made); return made },
  }
  const knex = (table) => ({ where: ({ id }) => ({ update: async ({ created_at }) => { assert.equal(table, "product_review"); dates[id] = created_at } }) })
  const warnings = []
  const logger = { info() {}, warn: (m) => warnings.push(m) }
  const container = { resolve: (key) => ({ logger, product: { listProducts: async () => products }, content, pg: knex })[key] }

  await script.default({ container })
  assert.equal(reviews.length, 4, "Grape Goo twice, Shadow Leopard AirPods and Sonar; the rest are not in this store")
  assert.equal(warnings.length, 2)
  for (const r of reviews) {
    assert.equal(r.status, "approved")
    assert.equal(r.title, "")
    assert.match(r.customer_id, /^florayn-review-\d+$/)
    assert.ok(!/<[a-z]/.test(r.body), "no HTML")
  }
  const grape = reviews.filter((r) => r.review_key === "design:grape-goo")
  assert.equal(grape.length, 2)
  assert.ok(grape.every((r) => r.product_id === "p-grape"))
  const leopard = reviews.find((r) => r.review_key === "design:shadow-leopard")
  assert.equal(leopard.product_id, "p-leopard", "the AirPods review goes on the AirPods product")
  assert.equal(leopard.rating, 4)
  assert.equal(dates[leopard.id].toISOString(), "2026-05-19T10:30:02.000Z")

  await script.default({ container })
  assert.equal(reviews.length, 4, "a second run adds nothing")
})

test("the imported reviews get florayn.com's photos and verified marks once, keeping admin edits", async () => {
  const filename = require("node:path").join(__dirname, "../src/migration-scripts/florayn-review-photos-2026-09-25.ts")
  const code = require("typescript").transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { target: 7, module: 1 } }).outputText
  const exports = {}
  require("node:vm").runInNewContext(code, { exports, require(name) {
    if (name === "@medusajs/framework/utils") return { ContainerRegistrationKeys: { LOGGER: "logger" } }
    if (name === "../modules/content") return { CONTENT_MODULE: "content" }
    if (name === "./import-florayn-reviews-2026-09-24") return { importedReviewCustomer: (id) => `florayn-review-${id}` }
    throw new Error(name)
  } }, { filename })
  const rows = [
    { id: "r1", customer_id: "florayn-review-6872", images: null, verified: false },
    { id: "r2", customer_id: "florayn-review-6021", images: ["https://owner/replaced.webp"], verified: false },
    { id: "r3", customer_id: "florayn-review-148", images: null, verified: false },
  ]
  const content = {
    listProductReviews: async ({ customer_id }) => rows.filter((r) => r.customer_id === customer_id).map((r) => ({ ...r })),
    updateProductReviews: async (patch) => Object.assign(rows.find((r) => r.id === patch.id), patch),
  }
  const container = { resolve: (key) => (key === "logger" ? { info() {} } : content) }
  await exports.default({ container })
  assert.match(rows[0].images[0], /reviews\/florayn\/6872-/)
  assert.equal(rows[0].verified, true)
  assert.deepEqual(rows[1].images, ["https://owner/replaced.webp"], "an admin's own photos are kept")
  assert.equal(rows[1].verified, true)
  assert.equal(rows[2].images, null)
  assert.equal(rows[2].verified, false)
  const before = JSON.stringify(rows)
  await exports.default({ container })
  assert.equal(JSON.stringify(rows), before)
})
