const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// Loads a storefront source module in a sandbox with mocked deps + globals.
function loadSource(relativePath, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    source,
    {
      exports,
      console,
      process,
      Buffer,
      Date,
      AbortSignal,
      URLSearchParams,
      ...globals,
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
    { filename }
  )
  return exports
}

// A cookie jar that records what the module sets.
function makeCookieStore(initial = {}) {
  const jar = new Map(Object.entries(initial).map(([k, v]) => [k, { value: v }]))
  const sets = []
  const deletes = []
  return {
    store: {
      get: (name) => jar.get(name),
      set: (name, value, opts) => {
        sets.push({ name, value, opts })
        jar.set(name, { value })
      },
      delete: (name) => {
        deletes.push(name)
        jar.delete(name)
      },
    },
    sets,
    deletes,
  }
}

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body }
}

function loadCustomer({ cookies, fetchImpl }) {
  return loadSource(
    "lib/customer.ts",
    {
      "next/headers": { cookies: async () => cookies },
      "next/cache": { revalidatePath: () => {} },
      "./medusa": {
        MEDUSA_BACKEND_URL: "https://api.test",
        MEDUSA_PUBLISHABLE_KEY: "pk_test",
      },
    },
    { fetch: fetchImpl }
  )
}

test("requestLoginCode rejects a bad email without hitting the network", async () => {
  let called = false
  const { store } = makeCookieStore()
  const mod = loadCustomer({ cookies: store, fetchImpl: async () => { called = true; return jsonResponse({}) } })
  const r = await mod.requestLoginCode("not-an-email")
  assert.equal(r.ok, false)
  assert.equal(called, false)
})

test("verifyLoginCode rejects a non-6-digit code without hitting the network", async () => {
  let called = false
  const { store } = makeCookieStore()
  const mod = loadCustomer({ cookies: store, fetchImpl: async () => { called = true; return jsonResponse({}) } })
  const r = await mod.verifyLoginCode("a@b.com", "123")
  assert.equal(r.ok, false)
  assert.equal(called, false)
})

test("verifyLoginCode stores the token in an httpOnly cookie on success", async () => {
  const { store, sets } = makeCookieStore()
  const mod = loadCustomer({
    cookies: store,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/store\/auth\/otp\/verify$/)
      return jsonResponse({ success: true, token: "the.jwt.token", customer_id: "cus_1" })
    },
  })
  const r = await mod.verifyLoginCode("a@b.com", "123456")
  assert.equal(r.ok, true)
  assert.equal(sets.length, 1)
  assert.equal(sets[0].name, "florayn_customer_jwt")
  assert.equal(sets[0].value, "the.jwt.token")
  assert.equal(sets[0].opts.httpOnly, true)
  assert.equal(sets[0].opts.path, "/")
})

test("verifyLoginCode surfaces the backend error and sets no cookie", async () => {
  const { store, sets } = makeCookieStore()
  const mod = loadCustomer({
    cookies: store,
    fetchImpl: async () => jsonResponse({ success: false, message: "Invalid or expired code." }, false),
  })
  const r = await mod.verifyLoginCode("a@b.com", "000000")
  assert.equal(r.ok, false)
  assert.equal(r.error, "Invalid or expired code.")
  assert.equal(sets.length, 0)
})

test("getAccountOrders merges live + imported orders, newest first, with a live link", async () => {
  const { store } = makeCookieStore({ florayn_customer_jwt: "tok" })
  const mod = loadCustomer({
    cookies: store,
    fetchImpl: async (url) => {
      const u = String(url)
      if (u.includes("/store/customers/me")) {
        return jsonResponse({
          customer: {
            id: "cus_1",
            email: "a@b.com",
            first_name: null,
            last_name: null,
            phone: null,
            metadata: {
              legacy_orders: [
                { n: 900, date: "2024-01-10", status: "completed", total: 1500, items: "Old case" },
              ],
            },
          },
        })
      }
      if (u.includes("/store/orders")) {
        return jsonResponse({
          orders: [
            {
              id: "order_new",
              display_id: 1001,
              status: "pending",
              created_at: "2026-09-20T00:00:00.000Z",
              currency_code: "bdt",
              total: 2200,
              items: [{ title: "New case", quantity: 2 }],
            },
          ],
        })
      }
      return jsonResponse({}, false)
    },
  })

  const orders = await mod.getAccountOrders()
  assert.equal(orders.length, 2)
  // 2026 live order sorts before the 2024 legacy one.
  assert.equal(orders[0].id, "order_new")
  assert.equal(orders[0].legacy, false)
  assert.equal(orders[0].href, "/order/order_new")
  assert.equal(orders[0].items, "New case ×2")
  assert.equal(orders[1].legacy, true)
  assert.equal(orders[1].href, null)
  assert.equal(orders[1].displayId, 900)
})

test("getAccountOrders returns nothing when signed out", async () => {
  const { store } = makeCookieStore() // no token cookie
  const mod = loadCustomer({ cookies: store, fetchImpl: async () => jsonResponse({}, false, 401) })
  const orders = await mod.getAccountOrders()
  assert.equal(orders.length, 0)
})
