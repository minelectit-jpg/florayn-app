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

test("the fixture serves the header's typed menus, badges, case-type prices and a real search index", { timeout: 10000 }, async (t) => {
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
    assert.equal(response.status, 200, route)
    return response.json()
  }

  const content = await get("/store/content")
  assert.deepEqual(content.primary.map((s) => [s.label, s.kind, s.placement]), [
    ["Collections", "collections", "drawer"],
    ["Phone Case", "devices", "all"],
    ["Earbuds Cases", "devices", "all"],
    ["Styles", "case_types", "all"],
    ["Watch Bands", "links", "drawer"],
    ["Card Holder", "links", "drawer"],
    ["Phone Charms", "links", "drawer"],
    ["StickPad", "links", "drawer"],
  ])
  assert.deepEqual(content.primary[1].config, { families: ["iphone", "samsung"], case_type: "signature" })
  assert.deepEqual(content.primary[2].config, { families: ["airpods"], case_type: "signature-earbuds" })
  assert.deepEqual(content.primary[3].config.links, { alcantara: "/collection/alcantara/", essentials: "/collection/essentials/" })
  assert.ok(content.primary.slice(4).every((s) => s.image && s.groups.length === 0))
  assert.ok(content.primaryMen.some((s) => s.label === "Wallet"), "the Men menu has its own accessories")
  assert.equal(content.collections[0].in_menu, true)
  assert.equal(content.navigation.remember_device, true)
  assert.equal(content.search.placeholder, "Search")
  assert.ok(!("synonyms" in content.search), "synonyms only go into the index")

  const { devices } = await get("/store/devices")
  assert.deepEqual(devices.map((d) => [d.slug, d.badge]), [
    ["iphone-17-pro-max", "New"], ["iphone-16-pro-max", null], ["samsung-s26-ultra", "New"], ["airpods-pro-3", "New"], ["airpods-max", null],
  ])
  const { case_types } = await get("/store/case-types")
  for (const c of case_types) {
    assert.ok(Array.isArray(c.devices) && c.devices.length, `${c.slug} devices`)
    assert.ok("price_groups" in c && "image_url" in c, `${c.slug} price_groups and image_url`)
  }

  const index = await get("/store/search-index")
  assert.equal(index.v, 2)
  assert.deepEqual(index.dv.map((d) => d[0]), devices.map((d) => d.slug))
  // [slug, name, fromPrice, forms, sold, price, groups, folder]: Armor Black's one group is its flat price, so none.
  assert.deepEqual(index.ct.map((c) => [c[0], c[3], c[4], c[5], c[6], c[7]]), [
    ["signature", ["phone"], [0, 1, 2], 1400, [], ""],
    ["armor-black", ["phone"], [0, 1, 2], 1700, [], ""],
    ["signature-earbuds", ["airpods"], [3, 4], 750, [], ""],
  ])
  // Every variant is in the cards' pairs, and the fixture's pictures are inline: no renders promised, no facts.
  assert.deepEqual(index.p.map((p) => [p[0], p[3], p[5], p[10], p[11]]), [
    ["audit-bloom", "phone", [0, 1], 0, []], ["audit-midnight", "phone", [0, 1], 0, []], ["audit-bloom-airpods", "airpods", [2], 0, []], ["audit-midnight-airpods", "airpods", [2], 0, []],
  ])
  assert.deepEqual(index.cat.map((c) => [c[0], c[3]]), [["Watch Bands", 3], ["Card Holder", 3], ["Phone Charms", 1], ["StickPad", 3], ["Wallet", 2]])
  assert.ok(index.syn.length > 0 && index.sug.w.length > 0)
})
