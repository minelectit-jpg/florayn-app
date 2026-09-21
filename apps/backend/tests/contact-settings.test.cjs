const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const settings = load("modules/content/contact-settings.ts")
const faq = { id: "delivery", question: "Delivery?", answer: "The published delivery policy." }
class MedusaError extends Error { static Types = { INVALID_DATA: "invalid_data", INVALID_ARGUMENT: "invalid_argument", NOT_ALLOWED: "not_allowed", DB_ERROR: "db_error" } }

test("contact reads are side-effect free and project only display fields while respecting explicit blanks", async () => {
  let rows = []
  const service = { listContactSettings: async (filters, options) => {
    assert.deepEqual(plain(filters), { id: "contactset_default" })
    assert.deepEqual(plain(options), { take: 1 })
    return rows
  } }
  const initial = await settings.readContactSettings(service)
  assert.deepEqual(plain(initial), plain(settings.DEFAULT_CONTACT_SETTINGS))
  initial.faqs[0].answer = "Changed by consumer"
  assert.notEqual((await settings.readContactSettings(service)).faqs[0].answer, initial.faqs[0].answer)
  rows = [{ id: "private", deleted_at: null, internal: "not public", phone: "", email: "", address: "", faqs: [] }]
  const result = await settings.readContactSettings(service)
  assert.deepEqual(Object.keys(result).sort(), Object.keys(settings.DEFAULT_CONTACT_SETTINGS).sort())
  assert.equal(result.phone, ""); assert.equal(result.email, ""); assert.equal(result.address, "")
  assert.deepEqual(plain(result.faqs), [])
  assert.equal(result.title, "Talk to us")
  assert.ok(!JSON.stringify(result).includes("private"))
  rows = [{ phone: "javascript:alert(1)", email: "a@example.com?subject=evil" }]
  const safe = await settings.readContactSettings(service)
  assert.equal(safe.phone, settings.DEFAULT_CONTACT_SETTINGS.phone)
  assert.equal(safe.email, settings.DEFAULT_CONTACT_SETTINGS.email)
})

test("contact patches normalize callable links and preserve FAQ identities, ordering and multiline plain text", () => {
  const parsed = settings.parseContactSettingsPatch({ title: "  New title  ", phone: "০১৩১০-০০৭০৫৫",
    email: " INFO@EXAMPLE.COM ", address: "Line one\r\nLine two", phone_note: "", help_title: "",
    faqs: [{ id: "second", question: " Second? ", answer: "Answer\r\nNext line." }, faq],
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.patch.title, "New title")
  assert.equal(parsed.patch.phone, "+8801310007055")
  assert.equal(parsed.patch.email, "info@example.com")
  assert.equal(parsed.patch.address, "Line one\nLine two")
  assert.equal(parsed.patch.phone_note, ""); assert.equal(parsed.patch.help_title, "")
  assert.deepEqual(plain(parsed.patch.faqs.map(row => row.id)), ["second", "delivery"])
  assert.equal(parsed.patch.faqs[0].answer, "Answer\nNext line.")
  assert.deepEqual(plain(settings.parseContactSettingsPatch({ faqs: [] })), { ok: true, patch: { faqs: [] } })
  assert.equal(settings.parseContactSettingsPatch({ phone: "008801310007055" }).patch.phone, "+8801310007055")
})

test("contact validation rejects unknown fields, HTML, unsafe links, invalid types and unbounded FAQ content", () => {
  for (const input of [null, [], {}, { id: "other" }, { shipping_price: 0 }, { phone: null },
    { title: " " }, { phone_label: "" }, { faq_title: "" }, { title: "<b>Title</b>" },
    { description: "a\0b" }, { phone: "tel:+8801310007055" }, { phone: "+00000000" },
    { phone: "+1234567890123456" }, { email: "mailto:info@example.com" },
    { email: "info@example.com?subject=x" }, { email: "a?subject=x@example.com" },
    { email: "a@example.com\r\nBcc:other@example.com" }, { email: "a@example..com" },
    { faqs: null }, { faqs: {} }, { faqs: [faq, faq] }, { faqs: [{ ...faq, id: "Bad ID" }] },
    { faqs: [{ ...faq, answer: "<script>alert(1)</script>" }] }, { faqs: [{ ...faq, link: "hidden" }] },
    { faqs: [{ ...faq, question: "" }] }, { faqs: [{ ...faq, answer: "x".repeat(2001) }] },
    { faqs: [{ ...faq, question: "x".repeat(201) }] }, { faqs: [{ ...faq, id: "x".repeat(65) }] },
    { faqs: Array.from({ length: 31 }, (_, i) => ({ ...faq, id: `faq-${i}` })) },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ]) assert.equal(settings.parseContactSettingsPatch(input).ok, false, JSON.stringify(input))
  for (const [field, limit] of Object.entries(settings.CONTACT_TEXT_LIMITS)) {
    assert.equal(settings.parseContactSettingsPatch({ [field]: "x".repeat(limit + 1) }).ok, false, field)
  }
  assert.equal(settings.parseContactSettingsPatch({ faqs: Array.from({ length: 30 }, (_, i) => ({ ...faq, id: `faq-${i}` })) }).ok, true)
})

function workflowHarness(mode) {
  let row
  const writes = [], invalidations = []
  const workflow = load("workflows/update-contact-settings.ts", {
    "@medusajs/framework/utils": { MedusaError },
    "@medusajs/framework/workflows-sdk": { createStep: (_name, run) => run, createWorkflow: (_name, compose) => compose,
      StepResponse: class { constructor(value) { this.value = value } }, WorkflowResponse: class { constructor(value) { this.value = value } } },
    "../modules/content": { CONTENT_MODULE: "content" }, "../modules/content/contact-settings": settings,
    "../lib/revalidate-storefront": { queueStorefrontRevalidation: async input => { invalidations.push(plain(input)); return false } },
  })
  const context = { container: { resolve: () => ({
    listContactSettings: async () => row ? [row] : [],
    createContactSettings: async input => {
      if (mode === "race") { row = { ...plain(settings.DEFAULT_CONTACT_SETTINGS), id: "contactset_default", description: "Other admin value" }; throw new Error("duplicate") }
      if (mode === "failure") throw new Error("database unavailable")
      writes.push(plain(input)); row = { ...input }; return row
    },
    updateContactSettings: async input => { writes.push(plain(input)); row = { ...row, ...input }; return row },
  }) } }
  return { run: input => workflow.updateContactSettingsStep(input, context), writes, invalidations }
}

test("contact workflow persists one singleton, updates and clears FAQs, and scopes cache refresh", async () => {
  const h = workflowHarness()
  const first = await h.run({ title: "Updated title", faqs: [faq] })
  assert.equal(first.value.phone, settings.DEFAULT_CONTACT_SETTINGS.phone)
  const reordered = await h.run({ faqs: [{ ...faq, id: "second" }, faq], phone: "" })
  assert.deepEqual(plain(reordered.value.faqs.map(row => row.id)), ["second", "delivery"])
  const cleared = await h.run({ faqs: [] })
  assert.equal(cleared.value.title, "Updated title")
  assert.equal(cleared.value.phone, "")
  assert.deepEqual(plain(cleared.value.faqs), [])
  assert.ok(h.writes.every(write => write.id === "contactset_default"))
  assert.deepEqual(h.invalidations, Array.from({ length: 3 }, () => ({ tags: ["content:contact"] })))
  await assert.rejects(h.run({ faqs: [faq, faq] }))
  assert.equal(h.writes.length, 3)
  assert.equal(h.invalidations.length, 3)
})

test("simultaneous first saves preserve the other writer's fields and do not swallow database errors", async () => {
  const raced = workflowHarness("race")
  const result = await raced.run({ title: "Our title" })
  assert.equal(result.value.title, "Our title")
  assert.equal(result.value.description, "Other admin value")
  assert.deepEqual(raced.writes, [{ id: "contactset_default", title: "Our title" }])
  const failed = workflowHarness("failure")
  await assert.rejects(failed.run({ title: "Our title" }), /database unavailable/)
  assert.equal(failed.invalidations.length, 0)
})

test("contact admin route requires authentication and rejects malformed writes before workflow execution", async () => {
  let calls = 0
  const route = load("api/admin/contact-settings/route.ts", {
    "../../../modules/content": { CONTENT_MODULE: "content" }, "../../../modules/content/contact-settings": settings,
    "../../../workflows/update-contact-settings": { updateContactSettingsWorkflow: () => ({ run: async ({ input }) => { calls++; return { result: { settings: input } } } }) },
  })
  assert.equal(route.AUTHENTICATE, true)
  const headers = {}, res = { statusCode: 200, setHeader: (name, value) => { headers[name] = value },
    status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
  await route.POST({ body: { title: {} }, scope: {} }, res)
  assert.equal(res.statusCode, 400); assert.equal(calls, 0)
  assert.ok(res.body.errors.title)
  await route.POST({ body: { email: " INFO@EXAMPLE.COM " }, scope: {} }, res)
  assert.equal(calls, 1)
  assert.deepEqual(plain(res.body), { settings: { email: "info@example.com" } })
  assert.equal(headers["Cache-Control"], "private, no-store")
})

test("public contact route only reads and exposes the narrow settings contract", async () => {
  const route = load("api/store/contact-settings/route.ts", {
    "../../../modules/content": { CONTENT_MODULE: "content" }, "../../../modules/content/contact-settings": settings,
  })
  const req = { scope: { resolve: () => ({ listContactSettings: async () => [{ title: "Public title", secret: "private" }] }) } }
  let body
  await route.GET(req, { json: value => { body = value } })
  assert.equal(body.settings.title, "Public title")
  assert.ok(!JSON.stringify(body).includes("private"))
  assert.deepEqual(Object.keys(body), ["settings"])
})

test("generated contact migration creates only its own table and index", async () => {
  const statements = []
  class Migration { addSql(sql) { statements.push(sql) } }
  const { Migration20260921064114: Generated } = load("modules/content/migrations/Migration20260921064114.ts", {
    "@medusajs/framework/mikro-orm/migrations": { Migration },
  })
  await new Generated().up()
  assert.equal(statements.length, 2)
  assert.match(statements[0], /^create table if not exists "contact_setting" /)
  assert.match(statements[0], /"faqs" jsonb not null/)
  assert.match(statements[1], /ON "contact_setting"/)
  assert.ok(!statements.join(" ").includes("auth_otp"))
  assert.ok(!statements.join(" ").includes("checkout_setting"))
})

test("contact scoped migration inspects known schema only and permits exactly its named migration", async () => {
  const migration = "Migration20260921064114"
  const updates = []
  let recorded = false, history = false, connections = 0
  const columns = ["id", ...Object.keys(settings.CONTACT_TEXT_LIMITS), "faqs", "created_at", "updated_at", "deleted_at"]
  const helper = {
    getAllColumns: async (_conn, tables) => {
      assert.deepEqual(plain(tables.get("public")).map(table => table.table_name), ["mikro_orm_migrations", "contact_setting"])
      return { "public.mikro_orm_migrations": history ? [{ name: "name" }] : [],
        "public.contact_setting": recorded ? columns.map(name => ({ name, type: name === "faqs" ? "jsonb" : "text", nullable: false })) : [] }
    },
    getAllIndexes: async (_conn, tables) => { assert.equal(tables[0].table_name, "contact_setting"); return { "public.contact_setting": [{ keyName: "IDX_contact_setting_deleted_at" }] } },
  }
  const orm = { em: { getConnection: () => ({}), getDriver: () => ({ getPlatform: () => ({ getSchemaHelper: () => helper }) }) },
    getMigrator: () => ({ getExecutedMigrations: async () => { assert.ok(history); return recorded ? [{ name: migration }] : [] },
      up: async input => { updates.push(plain(input)); recorded = true; history = true } }), close: async () => {},
  }
  const api = load("scripts/migrate-contact-settings.ts", { "node:path": require("node:path"), "@medusajs/framework/utils": {
    MedusaError, ContainerRegistrationKeys: { CONFIG_MODULE: "config", LOGGER: "logger", PG_CONNECTION: "pg" }, Modules: { LOCKING: "locking" },
    ModulesSdkUtils: { loadDatabaseConfig: (_name, options) => options.database },
    mikroOrmCreateConnection: async db => { assert.ok(db.pool.max >= 2); connections++; return orm },
  } }, { __dirname: path.join(__dirname, "../src/scripts"), URL })
  const services = { config: { projectConfig: { databaseUrl: "postgres://unused:unused@localhost/florayn_checkout_test_ci" } },
    pg: { client: { config: { connection: { ssl: false } } } }, logger: { info() {} }, locking: { execute: async (_key, fn) => fn() } }
  const container = { resolve: key => services[key] }
  await api.default({ container, args: [] })
  assert.equal(updates.length, 0)
  assert.equal(history, false, "Read-only preflight cannot initialize migration history")
  await api.default({ container, args: ["apply", migration] })
  await api.default({ container, args: ["apply", migration] })
  assert.deepEqual(updates, [{ migrations: [migration] }])
  const prior = connections
  await assert.rejects(api.default({ container, args: ["apply", "Migration20260920194733"] }))
  services.config.projectConfig.databaseUrl = "postgres://unused:unused@localhost/other_database"
  await assert.rejects(api.default({ container, args: [] }))
  assert.equal(connections, prior)
})
