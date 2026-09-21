const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      console,
      Buffer,
      Date,
      process,
      AbortSignal,
      ...globals,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected import ${name}`)
      },
    },
    { filename }
  )
  return exports
}

// steadfast.ts only imports ./order-ops (for opsService + the WorkflowStatus type).
function loadSteadfast(fetchImpl) {
  return load(
    "lib/steadfast.ts",
    { "./order-ops": { opsService: (c) => c.__ops } },
    { fetch: fetchImpl }
  )
}

test("normalizeBdPhone reduces any BD form to 11 digits, rejects junk", () => {
  const s = loadSteadfast(async () => ({}))
  assert.equal(s.normalizeBdPhone("01700000000"), "01700000000")
  assert.equal(s.normalizeBdPhone("+8801700000000"), "01700000000")
  assert.equal(s.normalizeBdPhone("880 1700-000000"), "01700000000")
  assert.equal(s.normalizeBdPhone("1700000000"), "01700000000")
  assert.equal(s.normalizeBdPhone("০১৭০০০০০০০০০"), null) // Bengali digits aren't ASCII \d
  assert.equal(s.normalizeBdPhone("12345"), null)
  assert.equal(s.normalizeBdPhone("018000000000"), null) // 12 digits
})

test("sanitizeInvoice keeps only safe chars", () => {
  const s = loadSteadfast(async () => ({}))
  assert.equal(s.sanitizeInvoice(1042), "1042")
  assert.equal(s.sanitizeInvoice("ORD/10 42#"), "ORD1042")
  assert.equal(s.sanitizeInvoice(""), "order")
})

test("mapSteadfastStatus maps every known delivery_status to a workflow tab", () => {
  const s = loadSteadfast(async () => ({}))
  for (const v of ["pending", "in_review", "hold", "unknown", "unknown_approval_pending"]) {
    assert.equal(s.mapSteadfastStatus(v), "shipped", v)
  }
  for (const v of ["delivered", "delivered_approval_pending", "partial_delivered", "partial_delivered_approval_pending"]) {
    assert.equal(s.mapSteadfastStatus(v), "delivered", v)
  }
  for (const v of ["cancelled", "cancelled_approval_pending"]) {
    assert.equal(s.mapSteadfastStatus(v), "returned", v)
  }
  assert.equal(s.mapSteadfastStatus("something_new"), "shipped")
})

test("createBulkConsignments posts {data: JSON.stringify([...])} and parses per-invoice results", async () => {
  let captured = null
  const s = loadSteadfast(async (url, init) => {
    captured = { url, body: init.body, headers: init.headers }
    return {
      ok: true,
      status: 200,
      json: async () => [
        { invoice: "1001", consignment_id: 555, tracking_code: "ABC123", status: "success" },
        { invoice: "1002", consignment_id: null, tracking_code: null, status: "error" },
      ],
    }
  })
  const container = {
    __ops: { listCourierSettings: async () => [{ id: "c1", enabled: true, api_key: "k", secret_key: "sec", base_url: "https://portal.packzy.com/api/v1", default_delivery_type: 0 }] },
  }

  const out = await s.createBulkConsignments(container, [
    { invoice: "1001", recipient_name: "A", recipient_phone: "01700000000", recipient_address: "Dhaka", cod_amount: 1400 },
    { invoice: "1002", recipient_name: "B", recipient_phone: "01800000000", recipient_address: "Ctg", cod_amount: 750 },
  ])

  assert.equal(out.ok, true)
  // The bulk body is a JSON-encoded string under `data`.
  assert.match(String(captured.url), /\/create_order\/bulk-order$/)
  const parsedBody = JSON.parse(captured.body)
  assert.equal(typeof parsedBody.data, "string")
  const arr = JSON.parse(parsedBody.data)
  assert.equal(arr.length, 2)
  assert.equal(arr[0].cod_amount, 1400)
  assert.equal(typeof arr[0].cod_amount, "number")
  // Auth headers present.
  assert.equal(captured.headers["Api-Key"], "k")
  assert.equal(captured.headers["Secret-Key"], "sec")
  // Results parsed and matched back by invoice.
  const byInv = Object.fromEntries(out.results.map((r) => [r.invoice, r]))
  assert.equal(byInv["1001"].ok, true)
  assert.equal(byInv["1001"].tracking_code, "ABC123")
  assert.equal(byInv["1001"].consignment_id, "555")
  assert.equal(byInv["1002"].ok, false)
})

test("courier calls fail cleanly when disabled or unconfigured", async () => {
  const s = loadSteadfast(async () => { throw new Error("should not be called") })
  const container = {
    __ops: { listCourierSettings: async () => [{ id: "c1", enabled: false, api_key: "k", secret_key: "s", base_url: "x" }] },
  }
  const out = await s.createBulkConsignments(container, [
    { invoice: "1", recipient_name: "A", recipient_phone: "01700000000", recipient_address: "D", cod_amount: 1 },
  ])
  assert.equal(out.ok, false)
  assert.match(out.error, /turned off/i)
})
