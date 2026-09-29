const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Scheduled jobs run side by side (medusa-config.ts jobWorkerOptions), so a
// review batch can overlap another batch: in this process, or in a second one.
// Each order must still be asked once.

const ENV = { JWT_SECRET: "fixture-secret", STOREFRONT_URL: "https://store.fixture", R2_PUBLIC_URL: "https://pub-fixture.r2.dev" }
const UTILS = { Modules: { STORE: "store", PROMOTION: "promotion", PRODUCT: "product" }, ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query", PG_CONNECTION: "pg" } }
const DAY = 86_400_000

/** Load a source file with its relative imports; each loader has its own module state (one "process"). */
function loader(stubs) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, Buffer, process: { env: ENV }, URLSearchParams, AbortController, setTimeout, clearTimeout,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name]
        if (name.startsWith("node:")) return require(name)
        if (name.startsWith(".")) {
          const base = path.resolve(path.dirname(file), name)
          if (fs.existsSync(`${base}.ts`)) return load(`${base}.ts`)
        }
        throw new Error(`Unexpected dependency ${name} in ${path.basename(file)}`)
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  return (relative) => load(path.join(__dirname, "../src", relative))
}

const order = (id) => ({
  id, display_id: Number(id.replace(/\D/g, "")) || 1, email: `${id}@example.com`, customer_id: null, metadata: {},
  shipping_address: { first_name: "Ayesha", last_name: "Khan", phone: "01712345678" },
  items: [{ product: { id: "p1", handle: "moon-drift", title: "Moon Drift Case", status: "published", metadata: { design_name: "Moon Drift", design_slug: "moon-drift" } } }],
})

/** One shared order_op table and mailbox, and a way to start a backend "process" on it. */
function shop(orderIds, { failFor = null } = {}) {
  const delivered = new Date(Date.now() - 5 * DAY).toISOString()
  const rows = new Map(orderIds.map((id, i) => [`oop_${i}`, {
    id: `oop_${i}`, order_id: id, workflow_status: "delivered", status_changed_at: delivered, source: null,
    review_request_sent_at: null, review_request_note: null, review_request_channel: null,
  }]))
  const orders = new Map(orderIds.map((id) => [id, order(id)]))
  const mails = []
  const pg = {
    raw: async (sql, [id]) => {
      const row = rows.get(id)
      if (/set review_request_sent_at = now\(\)/.test(sql)) {
        if (!row || row.review_request_sent_at) return { rows: [] }
        row.review_request_sent_at = new Date().toISOString()
        return { rows: [{ id }] }
      }
      if (/set review_request_sent_at = null/.test(sql)) {
        if (row && row.review_request_note === null && row.review_request_channel === null) row.review_request_sent_at = null
        return { rows: [] }
      }
      throw new Error(`unexpected SQL ${sql}`)
    },
  }
  const services = {
    logger: { info() {} },
    pg,
    query: { graph: async ({ filters }) => ({ data: [orders.get([].concat(filters?.id)[0])].filter(Boolean) }) },
    order_ops: {
      // Rows as a query returns them: copies, read before any send.
      listOrderOps: async (filters) => [...rows.values()]
        .filter((r) => filters.order_id ? r.order_id === filters.order_id : r.review_request_sent_at === null)
        .map((r) => ({ ...r })),
      listAndCountOrderOps: async () => [[], [...rows.values()].filter((r) => r.review_request_sent_at).length],
      updateOrderOps: async (patch) => { Object.assign(rows.get(patch.id), patch) },
      listWhatsAppSettings: async () => [{ id: "wa", enabled: false }],
    },
  }
  const container = { resolve: (key) => services[key] }
  function start() {
    const load = loader({
      "@medusajs/framework/utils": UTILS,
      "@medusajs/medusa/core-flows": { updateStoresWorkflow: () => ({ run: async () => ({}) }), createPromotionsWorkflow: () => ({ run: async () => ({}) }) },
      "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
      "../modules/content": { CONTENT_MODULE: "content" },
      "./send-email": {
        sendEmail: async (m) => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (failFor && m.to.startsWith(failFor.toLowerCase())) throw new Error("mail server down")
          mails.push(m.to)
          return { ok: true }
        },
      },
    })
    const { runReviewRequests } = load("lib/review-requests.ts")
    const { readReviewProgram } = load("lib/review-program.ts")
    const settings = readReviewProgram({ requests: { enabled: true, delay_days: 1, statuses: ["delivered"], batch: 40, max_age_days: 120 } })
    return () => runReviewRequests(container, settings)
  }
  return { rows, mails, start }
}

test("an overlapping batch in the same process sends nothing", async () => {
  const s = shop(["order_01A", "order_01B", "order_01C"])
  const run = s.start()
  const [first, second] = await Promise.all([run(), run()])
  assert.deepEqual({ ...first }, { sent: 3, failed: 0 })
  assert.deepEqual({ ...second }, { sent: 0, failed: 0 })
  assert.deepEqual(s.mails.sort(), ["order_01a@example.com", "order_01b@example.com", "order_01c@example.com"])
})

test("two processes running batches at once ask each order once", async () => {
  const s = shop(["order_01A", "order_01B", "order_01C", "order_01D"])
  const [a, b] = await Promise.all([s.start()(), s.start()()])
  assert.equal(a.sent + b.sent, 4)
  assert.equal(s.mails.length, 4, "no order is mailed twice")
  assert.equal(new Set(s.mails).size, 4)
  for (const row of s.rows.values()) assert.equal(row.review_request_channel, "email")
})

test("an order whose send throws goes back in the queue for the next run", async () => {
  const s = shop(["order_01A", "order_01B"], { failFor: "order_01B" })
  const result = await s.start()()
  assert.deepEqual({ ...result }, { sent: 1, failed: 1 })
  const failed = [...s.rows.values()].find((r) => r.order_id === "order_01B")
  assert.equal(failed.review_request_sent_at, null, "released, so the next hourly run asks it again")
  assert.equal([...s.rows.values()].find((r) => r.order_id === "order_01A").review_request_channel, "email")
})
