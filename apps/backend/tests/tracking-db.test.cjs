const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, Buffer, URL, Date, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const PG = "__pg_connection__"
const db = load("lib/tracking/db.ts", { "@medusajs/framework/utils": { ContainerRegistrationKeys: { PG_CONNECTION: PG } } })

/** Records every raw statement; answers like pg does. */
function fakeKnex(answer = () => ({ rowCount: 0, rows: [] })) {
  const statements = []
  return {
    statements,
    async raw(sql, bindings) {
      statements.push({ sql, bindings })
      return answer(sql, bindings)
    },
  }
}

const placeholders = (sql) => (sql.match(/\?/g) ?? []).length
const squash = (sql) => sql.replace(/\s+/g, " ").trim()

const OUTBOX = {
  platform: "meta", env: "test", destination: "2247389409441720", event_name: "PageView",
  event_id: "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", event_time: new Date("2026-09-27T06:00:00Z"), source: "browser",
  payload: { data: [{ event_name: "PageView" }] },
}

test("insertOutbox is one multi-row insert with ON CONFLICT (platform, event_name, event_id) DO NOTHING", async () => {
  const knex = fakeKnex(() => ({ rowCount: 1, rows: [] }))
  assert.equal(await db.insertOutbox(knex, []), 0)
  assert.equal(knex.statements.length, 0, "no statement for no rows")
  const inserted = await db.insertOutbox(knex, [
    OUTBOX,
    { ...OUTBOX, platform: "tiktok", event_name: "Purchase", event_id: "fl-1234", source: "checkout", order_id: "order_1",
      payload: null, status: "blocked", last_error: `no token ${"x".repeat(600)}` },
  ])
  assert.equal(inserted, 1, "the insert count comes from rowCount")
  const [{ sql, bindings }] = knex.statements
  assert.match(squash(sql), /^insert into tracking_event \(platform, env, destination, event_name, event_id, event_time, source, order_id, payload, status, last_error\) values \(.+\), \(.+\) on conflict \(platform, event_name, event_id\) do nothing$/)
  assert.equal(placeholders(sql), bindings.length)
  assert.equal(bindings.length, 22)
  assert.equal((sql.match(/\?::jsonb/g) ?? []).length, 2, "payload is cast to jsonb")
  assert.equal(bindings[8], JSON.stringify(OUTBOX.payload), "payload is sent as JSON text")
  assert.equal(bindings[9], "pending", "status defaults to pending")
  assert.equal(bindings[7], null)
  assert.equal(bindings[19], null, "a null payload stays null")
  assert.equal(bindings[20], "blocked")
  assert.equal(bindings[21].length, 500, "last_error is at most 500 chars")
})

test("insertHits uses ON CONFLICT (event_name, event_id) DO NOTHING and fits the varchar columns", async () => {
  const knex = fakeKnex(() => ({ rowCount: 2, rows: [] }))
  assert.equal(await db.insertHits(knex, []), 0)
  const count = await db.insertHits(knex, [
    { event_name: "ViewContent", event_id: "id-1", origin: "b", host: "new.florayn.com", campaign: "c".repeat(90),
      path: `/${"p".repeat(400)}`, country: "BD", value: 1400, items: 1, flags: db.HIT_FLAGS.PRIMARY | db.HIT_FLAGS.NEW_VISITOR },
    { event_name: "Purchase", event_id: "fl-1", origin: "s", host: "new.florayn.com", country: "bd" },
  ])
  assert.equal(count, 2)
  const [{ sql, bindings }] = knex.statements
  assert.match(squash(sql), /^insert into tracking_hit \(event_name, event_id, origin, visitor_id, session_id, source, campaign, device_class, audience, host, path, handle, variant_id, device, case_type, value, items, country, flags\) values .+ on conflict \(event_name, event_id\) do nothing$/)
  assert.equal(placeholders(sql), bindings.length)
  assert.equal(bindings.length, 38)
  assert.equal(bindings[6].length, 80, "campaign fits varchar(80)")
  assert.equal(bindings[10].length, 300, "path fits varchar(300)")
  assert.equal(bindings[17], "BD")
  assert.equal(bindings[18], 17)
  assert.equal(bindings[19 + 17], null, "a malformed country becomes null")
  assert.equal(bindings[19 + 18], 0, "flags default to 0")
  assert.equal(/received_at/.test(sql), false, "received_at comes from clock_timestamp()")
})

test("getState/setState upsert tracking_state", async () => {
  const knex = fakeKnex((sql) => sql.startsWith("select") ? { rows: [{ value: { last_run_at: "x" } }] } : { rowCount: 1 })
  await db.setState(knex, "job:outbox", { last_run_at: "2026-09-27T06:00:00.000Z" })
  assert.equal(squash(knex.statements[0].sql),
    "insert into tracking_state (key, value, updated_at) values (?, ?::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()")
  assert.deepEqual(plain(knex.statements[0].bindings), ["job:outbox", "{\"last_run_at\":\"2026-09-27T06:00:00.000Z\"}"])
  assert.deepEqual(plain(await db.getState(knex, "job:outbox")), { last_run_at: "x" })
  assert.equal(squash(knex.statements[1].sql), "select value from tracking_state where key = ?")
  const empty = fakeKnex(() => ({ rows: [] }))
  assert.equal(await db.getState(empty, "missing"), null)
})

test("bumpCounters upserts hourly counters with n = n + excluded.n and skips zero deltas", async () => {
  const knex = fakeKnex()
  await db.bumpCounters(knex, { "sf.untrusted": 0, "sf.invalid": 1.5, "sf.bot": Number.NaN })
  assert.equal(knex.statements.length, 0, "nothing to add")
  const at = new Date("2026-09-27T06:42:10Z")
  await db.bumpCounters(knex, { "sf.untrusted": 3, "ingest.unknown_variant": 1, "sf.bot": 0 }, at)
  const [{ sql, bindings }] = knex.statements
  assert.equal(squash(sql), "insert into tracking_counter (hour, key, n) values (date_trunc('hour', ?::timestamptz), ?, ?), (date_trunc('hour', ?::timestamptz), ?, ?) on conflict (hour, key) do update set n = tracking_counter.n + excluded.n")
  assert.equal(bindings[0].toISOString(), at.toISOString())
  assert.deepEqual(plain(bindings.slice(1, 3)), ["sf.untrusted", 3])
  assert.deepEqual(plain(bindings.slice(4, 6)), ["ingest.unknown_variant", 1])
  await db.bumpCounters(knex, { "sf.rate_dropped": 2 })
  assert.ok(knex.statements[1].bindings[0] instanceof Date, "defaults to now")
})

test("trackingDb resolves PG_CONNECTION and withTransaction runs inside knex.transaction", async () => {
  const trx = fakeKnex()
  const knex = { async transaction(fn) { return fn(trx) } }
  const container = { resolve: (key) => { assert.equal(key, PG); return knex } }
  assert.equal(db.trackingDb(container), knex)
  const result = await db.withTransaction(container, async (inner) => {
    await db.setState(inner, "k", 1)
    return "done"
  })
  assert.equal(result, "done")
  assert.equal(trx.statements.length, 1)
  assert.deepEqual(plain(db.HIT_FLAGS), { PRIMARY: 1, VARIANT_SWITCH: 2, INTERNAL: 8, NEW_VISITOR: 16, FIRST_PAGEVIEW: 32, UNKNOWN_VARIANT: 64 })
})

test("db.ts documents its raw-SQL exception and binds every value", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/tracking/db.ts"), "utf8")
  assert.match(source, /documented exception to AGENTS\.md/)
  assert.equal(/\$\{row\.|\$\{key\}|\$\{value\}/.test(source), false, "no value is interpolated into SQL")
})

// ---------------------------------------------------------------- migration

const MIGRATION_FILE = "modules/tracking/migrations/Migration20260928090000.ts"

function migrationSql() {
  class Migration {
    constructor() { this.sql = [] }
    addSql(sql) { this.sql.push(sql) }
  }
  const mod = load(MIGRATION_FILE, { "@medusajs/framework/mikro-orm/migrations": { Migration } })
  const up = new mod.Migration20260928090000()
  const down = new mod.Migration20260928090000()
  return { mod, up, down }
}

const normalise = (sql) => sql
  .replace(/--[^\n]*/g, " ")
  .replace(/"/g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([(),])\s*/g, "$1")
  .replace(/;$/, "")
  .trim()
  .toLowerCase()

test("the migration creates every table and index of TRACKING.md section 2, idempotently", async () => {
  const { up } = migrationSql()
  await up.up()
  const statements = up.sql.map(normalise)
  for (const statement of statements) {
    if (/^create (unique )?(table|index)/.test(statement)) assert.match(statement, /^create (unique )?(table|index) if not exists /, statement)
  }
  // Every statement of the section 2 SQL blocks appears in the migration.
  const doc = fs.readFileSync(path.join(__dirname, "../../../TRACKING.md"), "utf8").replace(/\r\n/g, "\n")
  const section = doc.slice(doc.indexOf("## 2. Data model"), doc.indexOf("## 3. Settings and admin screens"))
  const specStatements = [...section.matchAll(/```sql\n([\s\S]*?)```/g)]
    .flatMap((match) => match[1].replace(/--[^\n]*/g, " ").split(";"))
    .map(normalise)
    .filter(Boolean)
  assert.equal(specStatements.length, 23, "13 tables and 10 indexes in the section 2 SQL")
  for (const statement of specStatements) assert.ok(statements.includes(statement), `missing: ${statement}`)

  const tables = statements.map((sql) => sql.match(/^create table if not exists ([a-z_]+)/)?.[1]).filter(Boolean)
  assert.deepEqual(tables.sort(), [
    "catalog_feed", "catalog_feed_fetch", "catalog_image", "tracking_cart_context", "tracking_counter",
    "tracking_day_dim", "tracking_event", "tracking_hit", "tracking_minute", "tracking_order_context",
    "tracking_session", "tracking_settings", "tracking_state", "tracking_variant",
  ])
  const settings = statements.find((sql) => sql.startsWith("create table if not exists tracking_settings"))
  for (const column of ["id text not null", "config jsonb not null default '{}'", "meta_test_token text null",
    "meta_live_token text null", "tiktok_test_token text null", "tiktok_live_token text null", "catalog_feed_token text null",
    "created_at timestamptz not null default now()", "updated_at timestamptz not null default now()",
    "deleted_at timestamptz null", "constraint tracking_settings_pkey primary key(id)"]) {
    assert.ok(settings.includes(column), column)
  }
  assert.ok(statements.includes("create index if not exists idx_tracking_settings_deleted_at on tracking_settings(deleted_at)where deleted_at is null"))
})

test("down() drops every table; the file is named after its class", async () => {
  const { mod, down } = migrationSql()
  await down.down()
  const dropped = down.sql.map((sql) => sql.match(/^drop table if exists "([a-z_]+)" cascade;$/)?.[1])
  assert.ok(dropped.every(Boolean))
  assert.equal(dropped.length, 14)
  assert.deepEqual(Object.keys(mod), ["Migration20260928090000"])
  const source = fs.readFileSync(path.join(__dirname, "../src", MIGRATION_FILE), "utf8")
  assert.match(source, /export class Migration20260928090000 extends Migration/)
  assert.match(source.slice(0, 600), /Hand-written on purpose/)
})

// ---------------------------------------------------------------- migrate-tracking.ts

class MedusaError extends Error {
  constructor(type, message) { super(message); this.type = type }
  static Types = { INVALID_ARGUMENT: "invalid_argument", NOT_ALLOWED: "not_allowed", DB_ERROR: "db_error" }
}

async function runScript(databaseUrl, args = []) {
  const script = load("scripts/migrate-tracking.ts", {
    "node:path": path,
    "@medusajs/framework/utils": {
      ContainerRegistrationKeys: { CONFIG_MODULE: "config", LOGGER: "logger", PG_CONNECTION: PG },
      MedusaError, Modules: { LOCKING: "locking" },
      ModulesSdkUtils: { loadDatabaseConfig: (name) => { assert.equal(name, "tracking"); return { schema: "public" } } },
      mikroOrmCreateConnection: async (_config, _entities, migrationsPath) => {
        assert.match(migrationsPath.replace(/\\/g, "/"), /modules\/tracking\/migrations$/)
        throw new Error("reached the database")
      },
    },
  }, { __dirname: path.join(__dirname, "../src/scripts") })
  const container = {
    resolve(key) {
      if (key === "config") return { projectConfig: { databaseUrl } }
      if (key === "logger") return { info() {} }
      if (key === PG) return {}
      throw new Error(`Unexpected resolve ${key}`)
    },
  }
  return script.default({ container, args })
}

test("migrate-tracking only runs against the new-site or a disposable test database", async () => {
  for (const name of ["florayn_v3", "florayn_tracking_test_1", "florayn_checkout_test_abc_2", "florayn_contact_test_x"]) {
    await assert.rejects(runScript(`postgres://u:p@127.0.0.1:5432/${name}`), /reached the database/, name)
  }
  for (const name of ["florayn", "florayn_v2", "florayn_v3_copy", "postgres", "florayn_tracking_test_", "florayn_other_test_x",
    "florayn_tracking_test_ABC", "florayn_tracking_test_x-y"]) {
    await assert.rejects(runScript(`postgres://u:p@127.0.0.1:5432/${name}`), (error) => error.type === "not_allowed", name)
  }
  await assert.rejects(runScript("postgres://u:p@127.0.0.1:5432/florayn_v3", ["apply", "Migration20260921064114"]),
    (error) => error.type === "invalid_argument")
  await assert.rejects(runScript("postgres://u:p@127.0.0.1:5432/florayn_v3", ["apply", "Migration20260928090000"]), /reached the database/)
  const source = fs.readFileSync(path.join(__dirname, "../src/scripts/migrate-tracking.ts"), "utf8")
  assert.match(source, /const MIGRATION = "Migration20260928090000"/)
  assert.match(source, /if \(!current\.recorded\)/, "a second apply only verifies")
})
