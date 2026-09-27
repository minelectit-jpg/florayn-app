const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// The Privacy page (TRACKING.md WP09): content-module singleton, admin and
// store routes, workflow, migration and its scoped apply script.
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
const source = (file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8")
class MedusaError extends Error {
  constructor(type, message) { super(message); this.type = type }
  static Types = { INVALID_DATA: "invalid_data", INVALID_ARGUMENT: "invalid_argument", NOT_ALLOWED: "not_allowed", DB_ERROR: "db_error" }
}

const settings = load("modules/content/privacy-settings.ts", { "./index": { CONTENT_MODULE: "content" } })
const draft = load("modules/content/privacy-draft.ts")
const DEFAULTS = { title: "Privacy policy", body: "", published: false }
const PUBLIC_KEYS = ["title", "body", "published", "updated_at"]

// TRACKING.md Appendix A, the single source the draft must match.
function appendixA() {
  const md = fs.readFileSync(path.join(__dirname, "../../../TRACKING.md"), "utf8")
  const appendix = md.slice(md.indexOf("## Appendix A."), md.indexOf("## Appendix B."))
  return { title: appendix.match(/^Title: `([^`]+)`$/m)[1], body: appendix.match(/```text\n([\s\S]*?)\n```/)[1] }
}

function container(service) {
  return { resolve: (key) => { assert.equal(key, "content"); return service } }
}

function readOnlyService(rows) {
  const calls = []
  return { calls, service: {
    listPrivacySettings: async (filters, options) => { calls.push(plain({ filters, options })); return rows },
    createPrivacySettings: async () => { throw new Error("a read must not insert") },
    updatePrivacySettings: async () => { throw new Error("a read must not update") },
  } }
}

test("reads return the unpublished defaults without inserting and project only the display fields", async () => {
  const empty = readOnlyService([])
  assert.deepEqual(plain(await settings.readPrivacySettings(container(empty.service))), { ...DEFAULTS, updated_at: null })
  assert.deepEqual(empty.calls, [{ filters: { id: "privacyset_default" }, options: { take: 1 } }])
  assert.equal(settings.PRIVACY_SETTINGS_ID, "privacyset_default")
  assert.deepEqual(plain(settings.DEFAULT_PRIVACY_SETTINGS), DEFAULTS)

  const saved = readOnlyService([{ id: "privacyset_default", title: " Our policy ", body: "Line one\r\nLine two",
    published: true, updated_at: new Date("2026-09-28T04:05:06.000Z"), created_at: new Date(), deleted_at: null, internal: "private" }])
  const result = await settings.readPrivacySettings(container(saved.service))
  assert.deepEqual(Object.keys(result).sort(), [...PUBLIC_KEYS].sort())
  assert.deepEqual(plain(result), { title: "Our policy", body: "Line one\nLine two", published: true, updated_at: "2026-09-28T04:05:06.000Z" })

  // A stored row that would publish an empty or unsafe page never reads as published.
  for (const row of [{ published: true, body: "" }, { published: true, body: "<b>x</b>" }, { published: "true", body: "Text" },
    { published: true, body: "x".repeat(20_001) }]) {
    const read = await settings.readPrivacySettings(container(readOnlyService([row]).service))
    assert.equal(read.published, false, JSON.stringify(row).slice(0, 60))
  }
  const junk = settings.present({ title: "", body: 42, updated_at: "not a date" })
  assert.deepEqual(plain(junk), { ...DEFAULTS, updated_at: null })
  assert.deepEqual(plain(settings.present(null)), { ...DEFAULTS, updated_at: null })
})

test("the patch parser enforces the title, body and published rules", () => {
  const ok = (input, current) => {
    const parsed = settings.parsePrivacyPatch(input, current)
    assert.equal(parsed.ok, true, JSON.stringify(input).slice(0, 80))
    return plain(parsed.patch)
  }
  const bad = (input, current) => {
    const parsed = settings.parsePrivacyPatch(input, current)
    assert.equal(parsed.ok, false, JSON.stringify(input).slice(0, 80))
    return parsed.errors
  }
  assert.deepEqual(ok({ title: "  New title  " }), { title: "New title" })
  assert.equal(ok({ title: "x".repeat(120) }).title.length, 120)
  assert.ok(bad({ title: "x".repeat(121) }).title)
  assert.ok(bad({ title: "" }).title)
  assert.ok(bad({ title: "   " }).title)
  assert.ok(bad({ title: 42 }).title)
  assert.equal(ok({ body: "x".repeat(20_000) }).body.length, 20_000)
  assert.ok(bad({ body: "x".repeat(20_001) }).body)
  assert.deepEqual(ok({ body: "" }), { body: "" })
  assert.equal(ok({ body: "A\r\n\r\n## B\r\n- c" }).body, "A\n\n## B\n- c")
  assert.ok(bad({ body: null }).body)
  for (const value of ["true", 1, null, "yes"]) assert.ok(bad({ published: value, body: "Text" }).published)
  assert.deepEqual(ok({ published: true, body: "Approved text" }), { published: true, body: "Approved text" })
  assert.deepEqual(ok({ published: false }), { published: false })

  // Publishing needs a body, whether it comes in the patch or is already saved.
  assert.match(bad({ published: true }).published, /Write the policy/)
  assert.ok(bad({ published: true, body: "   " }).published)
  assert.deepEqual(ok({ published: true }, { body: "Saved text", published: false }), { published: true })
  assert.ok(bad({ body: "" }, { body: "Saved text", published: true }).published)
  assert.deepEqual(ok({ body: "", published: false }, { body: "Saved text", published: true }), { body: "", published: false })
  assert.deepEqual(ok({ title: "Only the title" }, { body: "Saved text", published: true }), { title: "Only the title" })

  for (const input of [null, [], "text", {}, { id: "other" }, { updated_at: "2026-01-01" }, { title: "T", extra: 1 },
    { body: "<script>alert(1)</script>" }, { title: "<b>T</b>" }, { body: "a\u0000b" }, { body: "a‮b" },
    JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.equal(settings.parsePrivacyPatch(input).ok, false, JSON.stringify(input))
  }
  assert.equal({}.polluted, undefined)
})

test("the suggested draft is Appendix A verbatim, valid, and never the default", () => {
  const appendix = appendixA()
  assert.equal(draft.SUGGESTED_PRIVACY_TITLE, "Privacy policy")
  assert.equal(draft.SUGGESTED_PRIVACY_TITLE, appendix.title)
  assert.equal(draft.SUGGESTED_PRIVACY_BODY, appendix.body)
  assert.ok(draft.SUGGESTED_PRIVACY_BODY.startsWith("Florayn sells printed cases"))
  assert.ok(draft.SUGGESTED_PRIVACY_BODY.endsWith("Email info@florayn.com."))
  // The owner can save and publish it unchanged, but nothing does so automatically.
  assert.equal(settings.parsePrivacyPatch({ title: draft.SUGGESTED_PRIVACY_TITLE, body: draft.SUGGESTED_PRIVACY_BODY, published: true }).ok, true)
  assert.equal(settings.DEFAULT_PRIVACY_SETTINGS.body, "")
  assert.equal(settings.DEFAULT_PRIVACY_SETTINGS.published, false)
  for (const file of ["modules/content/privacy-settings.ts", "modules/content/models/privacy-setting.ts",
    "workflows/update-privacy-settings.ts", "api/store/privacy-settings/route.ts"]) {
    assert.doesNotMatch(source(file), /privacy-draft|SUGGESTED_PRIVACY/, file)
  }
})

function workflowHarness(mode, initial) {
  let row = initial ? { ...initial } : undefined
  const writes = [], invalidations = []
  const service = {
    listPrivacySettings: async (filters, options) => {
      assert.deepEqual(plain(filters), { id: "privacyset_default" })
      assert.deepEqual(plain(options), { take: 1 })
      return row ? [row] : []
    },
    createPrivacySettings: async (input) => {
      if (mode === "race") {
        row = { id: "privacyset_default", title: "Other admin title", body: "Other admin text", published: true }
        throw new Error("duplicate key")
      }
      if (mode === "failure") throw new Error("database unavailable")
      writes.push(plain(input)); row = { ...input, updated_at: new Date("2026-09-28T00:00:00.000Z") }; return row
    },
    updatePrivacySettings: async (input) => { writes.push(plain(input)); row = { ...row, ...input }; return row },
  }
  const workflow = load("workflows/update-privacy-settings.ts", {
    "@medusajs/framework/utils": { MedusaError },
    "@medusajs/framework/workflows-sdk": { createStep: (_name, run) => run, createWorkflow: (_name, compose) => compose,
      StepResponse: class { constructor(value) { this.value = value } }, WorkflowResponse: class { constructor(value) { this.value = value } } },
    "../modules/content": { CONTENT_MODULE: "content" }, "../modules/content/privacy-settings": settings,
    "../lib/revalidate-storefront": { queueStorefrontRevalidation: async (input) => { invalidations.push(plain(input)); return false } },
  })
  const context = { container: container(service) }
  return { run: (input) => workflow.updatePrivacySettingsStep(input, context), writes, invalidations, workflow }
}

test("the workflow persists one singleton, validates against the saved page and queues only content:privacy", async () => {
  const h = workflowHarness()
  const first = await h.run({ body: "Draft text" })
  assert.deepEqual(plain(first.value), { title: "Privacy policy", body: "Draft text", published: false, updated_at: "2026-09-28T00:00:00.000Z" })
  assert.deepEqual(h.writes[0], { id: "privacyset_default", title: "Privacy policy", body: "Draft text", published: false })
  const published = await h.run({ published: true })
  assert.equal(published.value.published, true)
  assert.equal(published.value.body, "Draft text")
  await assert.rejects(h.run({ body: "" }), (error) => error.type === "invalid_data" && /Write the policy/.test(error.message))
  await assert.rejects(h.run({ title: "<b>x</b>" }), (error) => error.type === "invalid_data")
  const unpublished = await h.run({ published: false, body: "" })
  assert.deepEqual(plain(unpublished.value), { title: "Privacy policy", body: "", published: false, updated_at: "2026-09-28T00:00:00.000Z" })
  assert.ok(h.writes.every((write) => write.id === "privacyset_default"))
  assert.equal(h.writes.length, 3)
  assert.deepEqual(h.invalidations, Array.from({ length: 3 }, () => ({ tags: ["content:privacy"] })))

  const fresh = workflowHarness()
  await assert.rejects(fresh.run({ published: true }), /Write the policy/)
  assert.equal(fresh.writes.length, 0)
  assert.equal(fresh.invalidations.length, 0)
  assert.equal(typeof h.workflow.updatePrivacySettingsWorkflow, "function")
  assert.match(source("workflows/update-privacy-settings.ts"), /createStep\(\s*"update-privacy-settings"/)
  assert.match(source("workflows/update-privacy-settings.ts"), /return new StepResponse\(settings\)/)
})

test("simultaneous first saves keep the other writer's fields and do not swallow database errors", async () => {
  const raced = workflowHarness("race")
  const result = await raced.run({ title: "Our title" })
  assert.equal(result.value.title, "Our title")
  assert.equal(result.value.body, "Other admin text")
  assert.equal(result.value.published, true)
  assert.deepEqual(raced.writes, [{ id: "privacyset_default", title: "Our title" }])
  // The retry is checked against what the other admin saved.
  const emptied = workflowHarness("race")
  await assert.rejects(emptied.run({ body: "" }), /Write the policy/)
  assert.deepEqual(emptied.writes, [])
  const failed = workflowHarness("failure")
  await assert.rejects(failed.run({ title: "Our title" }), /database unavailable/)
  assert.equal(failed.invalidations.length, 0)
})

function response() {
  const headers = {}
  return { headers, statusCode: 200, setHeader(name, value) { headers[name] = value },
    status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
}

test("the admin route is authenticated, private, returns the suggested draft and validates before the workflow", async () => {
  const runs = []
  let row = { id: "privacyset_default", title: "Saved", body: "Saved text", published: false, updated_at: "2026-09-28T01:00:00.000Z" }
  const route = load("api/admin/privacy-settings/route.ts", {
    "../../../modules/content/privacy-draft": draft,
    "../../../modules/content/privacy-settings": settings,
    "../../../workflows/update-privacy-settings": { updatePrivacySettingsWorkflow: (scope) => ({ run: async ({ input }) => {
      assert.ok(scope.resolve)
      runs.push(plain(input))
      return { result: { settings: { ...settings.present({ ...row, ...input }) } } }
    } }) },
  })
  const scope = container({ listPrivacySettings: async () => [row] })
  assert.equal(route.AUTHENTICATE, true)

  const get = response()
  await route.GET({ scope }, get)
  assert.equal(get.headers["Cache-Control"], "private, no-store")
  assert.deepEqual(plain(get.body.settings), { title: "Saved", body: "Saved text", published: false, updated_at: "2026-09-28T01:00:00.000Z" })
  const appendix = appendixA()
  assert.deepEqual(plain(get.body.suggested), { title: appendix.title, body: appendix.body })

  for (const body of [{ title: {} }, { published: "yes" }, { secret: "x" }, null]) {
    const res = response()
    await route.POST({ body, scope }, res)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
    assert.equal(res.headers["Cache-Control"], "private, no-store")
    assert.ok(res.body.errors)
  }
  row = { ...row, body: "" }
  const unpublishable = response()
  await route.POST({ body: { published: true }, scope }, unpublishable)
  assert.equal(unpublishable.statusCode, 400)
  assert.match(unpublishable.body.errors.published, /Write the policy/)
  assert.equal(runs.length, 0)

  const saved = response()
  await route.POST({ body: { title: " Updated ", body: "Text", published: true }, scope }, saved)
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(runs, [{ title: "Updated", body: "Text", published: true }])
  assert.equal(saved.body.settings.published, true)
  assert.equal(saved.body.suggested.body, appendix.body)
  assert.equal(saved.headers["Cache-Control"], "private, no-store")
  // Policy text is never logged.
  assert.doesNotMatch(source("api/admin/privacy-settings/route.ts"), /console\.|logger|LOGGER/)
})

test("the store route returns only title, body, published and updated_at, with no text while unpublished", async () => {
  const route = load("api/store/privacy-settings/route.ts", { "../../../modules/content/privacy-settings": settings })
  const call = async (rows) => {
    const res = response()
    await route.GET({ scope: container({ listPrivacySettings: async () => rows }) }, res)
    assert.equal(res.headers["Cache-Control"], "public, max-age=60")
    assert.deepEqual(Object.keys(res.body), ["settings"])
    assert.deepEqual(Object.keys(res.body.settings).sort(), [...PUBLIC_KEYS].sort())
    return plain(res.body.settings)
  }
  const internal = { id: "privacyset_default", created_at: "2026-09-01T00:00:00.000Z", deleted_at: null, secret: "private" }
  assert.deepEqual(await call([]), { title: "Privacy policy", body: "", published: false, updated_at: null })
  const unpublished = await call([{ ...internal, title: "Draft title", body: "Unapproved draft text", published: false, updated_at: "2026-09-28T02:00:00.000Z" }])
  assert.deepEqual(unpublished, { title: "Draft title", body: "", published: false, updated_at: "2026-09-28T02:00:00.000Z" })
  const published = await call([{ ...internal, title: "Privacy policy", body: "Approved text", published: true, updated_at: new Date("2026-09-28T03:00:00.000Z") }])
  assert.deepEqual(published, { title: "Privacy policy", body: "Approved text", published: true, updated_at: "2026-09-28T03:00:00.000Z" })
  assert.doesNotMatch(JSON.stringify(published), /private|created_at|privacyset/)
})

test("the model is the privacy_setting singleton with the default fields and is registered on the content service", () => {
  const fields = {}
  const column = (kind, options) => {
    const spec = { kind, ...(options ? { options } : {}) }
    const api = { spec, default(value) { spec.default = value; return api }, primaryKey() { spec.primary = true; return api } }
    return api
  }
  let table
  const model = { id: (options) => column("id", options), text: () => column("text"), boolean: () => column("boolean"),
    define: (name, schema) => { table = name; for (const [key, value] of Object.entries(schema)) fields[key] = value.spec; return { name } } }
  const loaded = load("modules/content/models/privacy-setting.ts", { "@medusajs/framework/utils": { model } })
  assert.equal(loaded.default.name, "privacy_setting")
  assert.equal(table, "privacy_setting")
  assert.deepEqual(Object.keys(fields), ["id", "title", "body", "published"])
  assert.deepEqual(plain(fields.id), { kind: "id", options: { prefix: "privacyset" }, primary: true })
  assert.deepEqual({ title: fields.title.default, body: fields.body.default, published: fields.published.default }, DEFAULTS)
  assert.equal(fields.published.kind, "boolean")

  const service = source("modules/content/service.ts")
  assert.match(service, /^import PrivacySetting from "\.\/models\/privacy-setting"$/m)
  assert.match(service, /^ {2}PrivacySetting,$/m)
})

test("the migration creates only the privacy_setting table and its index, idempotently", async () => {
  const statements = []
  class Migration { addSql(sql) { statements.push(sql) } }
  const file = "modules/content/migrations/Migration20260928091000.ts"
  const { Migration20260928091000: Privacy } = load(file, { "@medusajs/framework/mikro-orm/migrations": { Migration } })
  await new Privacy().up()
  assert.equal(statements.length, 2)
  assert.match(statements[0], /^create table if not exists "privacy_setting" /)
  for (const column of [/"id" text not null/, /"title" text not null default 'Privacy policy'/, /"body" text not null default ''/,
    /"published" boolean not null default false/, /"created_at" timestamptz not null default now\(\)/,
    /"updated_at" timestamptz not null default now\(\)/, /"deleted_at" timestamptz null/, /primary key \("id"\)/]) {
    assert.match(statements[0], column)
  }
  assert.match(statements[1], /^create index if not exists "IDX_privacy_setting_deleted_at" on "privacy_setting" \("deleted_at"\) where deleted_at is null;$/)
  const tables = new Set(statements.join(" ").match(/"[a-z_]+_setting"/g))
  assert.deepEqual([...tables], ['"privacy_setting"'])
  assert.doesNotMatch(statements.join(" "), /\b(drop|alter|delete|update|insert|truncate)\b/i)
  statements.length = 0
  await new Privacy().down()
  assert.deepEqual(statements, ['drop table if exists "privacy_setting" cascade;'])
  assert.match(source(file), /^\/\*\*[\s\S]*?Additive and idempotent/m)
})

test("the scoped migration script inspects known schema only and applies exactly its named migration", async () => {
  const migration = "Migration20260928091000"
  const updates = []
  let recorded = false, history = false, connections = 0
  const columns = ["id", "title", "body", "published", "created_at", "updated_at", "deleted_at"]
  const helper = {
    getAllColumns: async (_conn, tables) => {
      assert.deepEqual(plain(tables.get("public")).map((table) => table.table_name), ["mikro_orm_migrations", "privacy_setting"])
      // Real PostgreSQL introspection reports the boolean column as "bool" (CI run #80).
      return { "public.mikro_orm_migrations": history ? [{ name: "name" }] : [],
        "public.privacy_setting": recorded ? columns.map((name) => ({ name, type: name === "published" ? "bool" : "text", nullable: name === "deleted_at" })) : [] }
    },
    getAllIndexes: async (_conn, tables) => {
      assert.equal(tables[0].table_name, "privacy_setting")
      return { "public.privacy_setting": [{ keyName: "IDX_privacy_setting_deleted_at" }] }
    },
  }
  const orm = { em: { getConnection: () => ({}), getDriver: () => ({ getPlatform: () => ({ getSchemaHelper: () => helper }) }) },
    getMigrator: () => ({ getExecutedMigrations: async () => { assert.ok(history); return recorded ? [{ name: migration }] : [] },
      up: async (input) => { updates.push(plain(input)); recorded = true; history = true } }), close: async () => {},
  }
  const logs = []
  const api = load("scripts/migrate-privacy-settings.ts", { "node:path": require("node:path"), "@medusajs/framework/utils": {
    MedusaError, ContainerRegistrationKeys: { CONFIG_MODULE: "config", LOGGER: "logger", PG_CONNECTION: "pg" }, Modules: { LOCKING: "locking" },
    ModulesSdkUtils: { loadDatabaseConfig: (name, options) => { assert.equal(name, "content"); return options.database } },
    mikroOrmCreateConnection: async (db, _entities, migrationsPath) => {
      assert.ok(db.pool.max >= 2)
      assert.equal(db.snapshot, false)
      assert.match(migrationsPath.replace(/\\/g, "/"), /modules\/content\/migrations$/)
      connections++
      return orm
    },
  } }, { __dirname: path.join(__dirname, "../src/scripts"), URL })
  const services = { config: { projectConfig: { databaseUrl: "postgres://unused:unused@localhost/florayn_tracking_test_ci" } },
    pg: { client: { config: { connection: { ssl: false } } } }, logger: { info: (line) => logs.push(line) }, locking: { execute: async (_key, fn) => fn() } }
  const run = (args) => api.default({ container: { resolve: (key) => services[key] }, args })
  await run([])
  assert.equal(updates.length, 0)
  assert.equal(history, false, "Read-only preflight cannot initialize migration history")
  assert.match(logs[0], /^PRIVACY_MIGRATION_PREFLIGHT /)
  await run(["apply", migration])
  await run(["apply", migration])
  assert.deepEqual(updates, [{ migrations: [migration] }])
  assert.ok(logs.some((line) => line.startsWith("PRIVACY_MIGRATION_VERIFIED ")))

  for (const database of ["florayn_v3", "florayn_checkout_test_x1", "florayn_contact_test_y2"]) {
    services.config.projectConfig.databaseUrl = `postgres://unused:unused@localhost/${database}`
    await run([])
  }
  const prior = connections
  await assert.rejects(run(["apply", "Migration20260921064114"]), /apply Migration20260928091000/)
  await assert.rejects(run(["apply"]))
  for (const database of ["other_database", "florayn_v3_copy", "florayn_tracking_test_", "florayn_live_test_x"]) {
    services.config.projectConfig.databaseUrl = `postgres://unused:unused@localhost/${database}`
    await assert.rejects(run([]), /restricted/)
  }
  assert.equal(connections, prior)
})
