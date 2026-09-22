const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const path = require("node:path")
const test = require("node:test")

test("local store fixture revises content and stock independently without altering products", { timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, "fixtures/mock-store-api.cjs")], {
    env: { ...process.env, MOCK_STORE_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  t.after(() => { child.kill() })
  const base = await new Promise((resolve, reject) => {
    let output = ""
    child.on("error", reject)
    child.on("exit", (code) => reject(new Error(`Fixture exited before readiness (${code})`)))
    child.stdout.on("data", (chunk) => {
      output += chunk
      const port = output.match(/127\.0\.0\.1:(\d+)/)?.[1]
      if (port) resolve(`http://127.0.0.1:${port}`)
    })
  })
  const get = async (route) => {
    const response = await fetch(`${base}${route}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.deepEqual(await get("/__audit/health"), { fixture: true })
  const initialProducts = await get("/store/products")
  assert.equal(initialProducts.products.length, 4)
  assert.match(initialProducts.products[0].thumbnail, /^data:image\/svg\+xml,/)
  const initialStock = await get("/store/stock")
  const initialContact = await get("/store/contact-settings")
  assert.equal(initialContact.settings.title, "Talk to us")
  assert.equal(initialContact.settings.email, "support@example.invalid")
  assert.equal((await get("/store/content")).footerNote, "Local verification revision 0")
  const revise = (data) => fetch(`${base}/__test/revision`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  })
  assert.equal((await revise({ revision: 1 })).status, 200)
  assert.equal((await get("/store/content")).footerNote, "Local verification revision 1")
  assert.deepEqual(await get("/store/stock"), initialStock)
  assert.equal((await revise({ revision: 1, stockRevision: 3 })).status, 200)
  assert.equal((await get("/store/content")).footerNote, "Local verification revision 1")
  assert.ok(Object.values((await get("/store/stock")).stock).every((quantity) => quantity === 23))
  assert.deepEqual(await get("/store/contact-settings"), initialContact)
  assert.equal((await revise({ revision: 1, contactRevision: 2 })).status, 200)
  assert.equal((await get("/store/contact-settings")).settings.title, "Contact revision 2")
  assert.equal((await get("/store/content")).footerNote, "Local verification revision 1")
  assert.ok(Object.values((await get("/store/stock")).stock).every((quantity) => quantity === 23))
  assert.deepEqual(await get("/store/products"), initialProducts)
  const status = await get("/__test/status")
  assert.equal(status.revision, 1)
  assert.equal(status.stockRevision, 3)
  assert.equal(status.contactRevision, 2)
  assert.equal(status.requests["/store/products"], 2)
  assert.equal((await revise({ revision: -1 })).status, 400)
  assert.equal((await revise({ revision: 1, contactRevision: -1 })).status, 400)
})
