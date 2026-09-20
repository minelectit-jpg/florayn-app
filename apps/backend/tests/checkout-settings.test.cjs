const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const settings = load("modules/content/checkout-settings.ts")

test("checkout settings expose only display fields and preserve explicit blank/false values", async () => {
  const result = await settings.readCheckoutSettings({
    async listCheckoutSettings(filters, config) {
      assert.deepEqual(plain(filters), { id: "checkoutset_default" })
      assert.deepEqual(plain(config), { take: 1 })
      return [{ id: "private", internal: "hidden", support_phone: "", delivery_note: "", show_order_note: false }]
    },
  })
  assert.deepEqual(Object.keys(result).sort(), Object.keys(settings.DEFAULT_CHECKOUT_SETTINGS).sort())
  assert.equal(result.support_phone, "")
  assert.equal(result.show_order_note, false)
  assert.equal(result.delivery_note, "")
  assert.equal(result.heading, "Checkout")
  assert.equal(JSON.stringify(result).includes("private"), false)
  const fresh = await settings.readCheckoutSettings({ async listCheckoutSettings() { return [] } })
  assert.deepEqual(plain(fresh), plain(settings.DEFAULT_CHECKOUT_SETTINGS))
})

test("checkout display patches trim text and normalize the callable contact without financial controls", () => {
  assert.deepEqual(plain(settings.parseCheckoutSettingsPatch({
    heading: "  Delivery details  ", support_phone: "+880 1310-007055", description: "", show_order_note: false,
  })), { ok: true, patch: {
    heading: "Delivery details", support_phone: "+8801310007055", description: "", show_order_note: false,
  } })
  assert.equal(settings.parseCheckoutSettingsPatch({ support_phone: "01310007055" }).patch.support_phone, "+8801310007055")
  assert.equal(settings.parseCheckoutSettingsPatch({ support_phone: "" }).patch.support_phone, "")
  for (const body of [null, [], {}, { id: "other" }, { shipping: 0 }, { payment_method: "bkash" }, { free_shipping_threshold: 100 }]) {
    assert.equal(settings.parseCheckoutSettingsPatch(body).ok, false)
  }
})

test("checkout settings reject wrong types, unsafe phone schemes, control characters and overlong copy", () => {
  for (const [field, value] of [
    ["heading", " "], ["heading", "x".repeat(81)], ["description", "x".repeat(241)],
    ["delivery_note", "x".repeat(241)], ["description", "text\0hidden"],
    ["support_label", ""], ["support_label", "x".repeat(61)],
    ["support_phone", "javascript:alert(1)"], ["support_phone", "+00000000"],
    ["support_phone", "+1234567890123456"], ["show_order_note", "false"],
    ["heading", 10], ["description", null],
  ]) {
    const result = settings.parseCheckoutSettingsPatch({ [field]: value })
    assert.equal(result.ok, false, `${field}: ${String(value)}`)
    assert.ok(result.errors[field])
  }
})

function workflowHarness() {
  let row
  const writes = []
  const invalidations = []
  class MedusaError extends Error { static Types = { INVALID_DATA: "invalid_data" } }
  const workflow = load("workflows/update-checkout-settings.ts", {
    "@medusajs/framework/utils": { MedusaError },
    "@medusajs/framework/workflows-sdk": {
      createStep: (_name, run) => run,
      createWorkflow: (_name, compose) => compose,
      StepResponse: class { constructor(value) { this.value = value } },
      WorkflowResponse: class { constructor(value) { this.value = value } },
    },
    "../modules/content": { CONTENT_MODULE: "content" },
    "../modules/content/checkout-settings": settings,
    "../lib/revalidate-storefront": { queueStorefrontRevalidation: async (input) => {
      invalidations.push(plain(input))
      return false // A cache outage must not roll back a successful admin save.
    } },
  })
  const context = { container: { resolve(name) {
    assert.equal(name, "content")
    return {
      async listCheckoutSettings() { return row ? [row] : [] },
      async createCheckoutSettings(input) {
        writes.push(plain(input))
        row = { ...row, ...input }
        return row
      },
      async updateCheckoutSettings(input) {
        writes.push(plain(input))
        row = { ...row, ...input }
        return row
      },
    }
  } } }
  return { run: (input) => workflow.updateCheckoutSettingsStep(input, context), writes, invalidations }
}

test("settings workflow persists one singleton, retains unchanged fields and invalidates only checkout content", async () => {
  const h = workflowHarness()
  const first = await h.run({ heading: "Complete your order", show_order_note: false })
  assert.equal(first.value.heading, "Complete your order")
  assert.equal(first.value.support_phone, settings.DEFAULT_CHECKOUT_SETTINGS.support_phone)
  assert.equal(first.value.show_order_note, false)
  const second = await h.run({ support_phone: "" })
  assert.equal(h.writes.length, 2)
  assert.ok(h.writes.every((write) => write.id === "checkoutset_default"))
  assert.equal(second.value.heading, "Complete your order")
  assert.equal(second.value.show_order_note, false)
  assert.equal(h.writes[1].support_phone, "")
  assert.deepEqual(h.invalidations, [
    { tags: ["content:checkout"] }, { tags: ["content:checkout"] },
  ])
  await assert.rejects(h.run({ support_phone: "https://example.invalid" }))
  assert.equal(h.writes.length, 2)
  assert.equal(h.invalidations.length, 2)
})

test("admin route rejects malformed settings before invoking the mutation workflow", async () => {
  let calls = 0
  const route = load("api/admin/checkout-settings/route.ts", {
    "../../../modules/content": { CONTENT_MODULE: "content" },
    "../../../modules/content/checkout-settings": settings,
    "../../../workflows/update-checkout-settings": { updateCheckoutSettingsWorkflow: () => ({
      async run({ input }) { calls++; return { result: { settings: input } } },
    }) },
  })
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
  await route.POST({ body: { heading: {} }, scope: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(calls, 0)
  assert.ok(res.body.errors.heading)
  res.statusCode = 200
  await route.POST({ body: { heading: "  Updated  " }, scope: {} }, res)
  assert.equal(calls, 1)
  assert.deepEqual(plain(res.body), { settings: { heading: "Updated" } })
})
