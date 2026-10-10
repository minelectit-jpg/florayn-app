const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Backups (BACKUP.md): settings, the pull token, files, dump + verify, age
// encryption, a whole pass, alerts, the pull API's auth and the Google Apps
// Script, all without a database or Google.

const UTILS = { ContainerRegistrationKeys: { LOGGER: "logger", PG_CONNECTION: "pg" } }

function loader(stubs = {}, env = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout,
      process: { env: { PATH: process.env.PATH, ...env } },
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

/** An in-memory tracking_state for "../tracking/db". */
function memoryState() {
  const store = new Map()
  return {
    store,
    stub: {
      trackingDb: () => ({}),
      getState: async (_db, key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
      setState: async (_db, key, value) => { store.set(key, JSON.stringify(value)) },
    },
  }
}

const age = () => import("age-encryption")
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fl-backup-test-"))
const plain = (v) => JSON.parse(JSON.stringify(v))

test("settings: defaults, validation, and backups cannot be on without a key", async () => {
  const mem = memoryState()
  const load = loader({ "../tracking/db": mem.stub })
  const s = load("lib/backup/settings.ts")
  const { generateX25519Identity, identityToRecipient } = await age()
  const recipient = await identityToRecipient(await generateX25519Identity())

  const d = s.readSettings({ enabled: "yes", keep_local: 999, recipient: "nope", alert_email: "bad", pull_token_hash: "x" })
  assert.deepEqual(plain(d), plain(s.DEFAULT_SETTINGS))
  assert.equal(s.isRecipient(recipient), true)
  assert.equal(s.isRecipient(recipient.toUpperCase()), false)

  const noKey = s.parseSettingsPatch({ enabled: true }, s.DEFAULT_SETTINGS)
  assert.equal(noKey.ok, false)
  assert.match(noKey.errors.enabled, /encryption key/)
  const bad = s.parseSettingsPatch({ recipient: "age1short", keep_local: 1, alert_email: "x@" }, s.DEFAULT_SETTINGS)
  assert.deepEqual(Object.keys(bad.errors).sort(), ["alert_email", "keep_local", "recipient"])
  const good = s.parseSettingsPatch({ recipient: ` ${recipient} `, enabled: true, keep_local: 4, alert_email: "a@b.com" }, s.DEFAULT_SETTINGS)
  assert.equal(good.ok, true)
  assert.equal(good.next.recipient, recipient)
  assert.equal(good.next.enabled, true)

  let runs = []
  for (let i = 0; i < s.MAX_RUNS + 5; i++) runs = s.upsertRun(runs, { id: `r${i}` })
  assert.equal(runs.length, s.MAX_RUNS)
  assert.equal(runs[0].id, `r${s.MAX_RUNS + 4}`, "newest first")
})

test("the pull token: shown once, stored as a hash, compared timing-safe, guessing is throttled", () => {
  const t = loader()("lib/backup/token.ts")
  const { token, hash, hint } = t.newPullToken()
  assert.match(token, /^flb_[A-Za-z0-9_-]{43}$/)
  assert.equal(hint, token.slice(-4))
  assert.equal(t.bearerToken(`Bearer ${token}`), token)
  assert.equal(t.bearerToken(`Basic ${token}`), null)
  assert.equal(t.bearerToken(undefined), null)
  assert.equal(t.verifyPullToken(token, hash), true)
  assert.equal(t.verifyPullToken(token, t.hashToken("flb_other")), false)
  assert.equal(t.verifyPullToken(token, null), false, "no stored token: nothing verifies")
  const start = 1_000_000
  for (let i = 0; i < 30; i++) t.noteFailure(start)
  assert.equal(t.tooManyFailures(start + 1000), true)
  assert.equal(t.tooManyFailures(start + 11 * 60_000), false, "the window resets")
})

test("files: names, no path tricks, newest kept per kind", () => {
  const f = loader()("lib/backup/files.ts")
  const at = new Date("2026-10-10T07:05:30Z")
  assert.equal(f.fileNameFor("db", at), "florayn-db-20261010T0705Z.dump.age")
  assert.equal(f.fileNameFor("env", at), "florayn-env-20261010.json.age")
  for (const bad of ["../etc/passwd", "florayn-db-20261010T0705Z.dump.age/../x", "florayn-db-2026.dump.age", "x.age", null]) assert.equal(f.safeName(bad), null, String(bad))
  const dir = tmp()
  const names = ["florayn-db-20261010T0105Z.dump.age", "florayn-db-20261010T0205Z.dump.age", "florayn-db-20261010T0305Z.dump.age", "florayn-env-20261009.json.age", "florayn-env-20261010.json.age", "notes.txt"]
  for (const n of names) fs.writeFileSync(path.join(dir, n), "x")
  assert.deepEqual(f.listFiles(dir).map((x) => x.name).includes("notes.txt"), false)
  assert.deepEqual(plain(f.prune(2, dir).sort()), ["florayn-db-20261010T0105Z.dump.age"])
  assert.deepEqual(plain(f.prune(1, dir).sort()), ["florayn-db-20261010T0205Z.dump.age", "florayn-env-20261009.json.age"])
  assert.ok(fs.existsSync(path.join(dir, "notes.txt")), "other files are never touched")
})

test("dump: password only in the environment, tracking data left out, broken dumps rejected", async () => {
  const d = loader()("lib/backup/dump.ts")
  const env = d.pgEnv("postgres://medusa:s3cr%40t@db.internal:5433/florayn_v3?sslmode=disable", { PATH: "/bin" })
  assert.deepEqual({ ...env }, { PATH: "/bin", PGHOST: "db.internal", PGPORT: "5433", PGUSER: "medusa", PGPASSWORD: "s3cr@t", PGDATABASE: "florayn_v3", PGCONNECT_TIMEOUT: "15", PGAPPNAME: "florayn-backup", PGSSLMODE: "disable" })
  assert.throws(() => d.pgEnv(undefined), /DATABASE_URL/)
  assert.throws(() => d.pgEnv("mysql://x/y"), /postgres/)
  const args = d.dumpArgs("/tmp/out.dump")
  assert.ok(args.includes("--exclude-table-data=tracking_hit") && args.includes("--exclude-table-data=tracking_event"))
  assert.ok(!args.join(" ").includes("s3cr"), "no password on the command line")

  const listing = (n, extra = ["order", "product"]) => [...extra, ...Array.from({ length: n }, (_, i) => `t${i}`)]
    .map((name, i) => `${i}; 0 1 TABLE DATA public ${name} medusa`).join("\n")
  assert.deepEqual(plain(d.checkRestoreList(listing(40))), { ok: true, tables: 42 })
  assert.equal(d.checkRestoreList(listing(5)).ok, false)
  assert.match(d.checkRestoreList(listing(40, ["product"])).error, /order/)

  const calls = []
  const fake = (results) => async (cmd, argv, opts) => { calls.push({ cmd, argv, env: opts.env }); return results.shift() }
  const url = "postgres://medusa:pw@h/florayn_v3"
  calls.length = 0
  assert.equal(await d.dumpDatabase("/x.dump", { databaseUrl: url, run: fake([{ code: 0, stdout: "", stderr: "" }, { code: 0, stdout: listing(40), stderr: "" }]) }), 42)
  assert.equal(calls[0].cmd, "pg_dump")
  assert.equal(calls[0].env.PGPASSWORD, "pw")
  assert.equal(calls[1].cmd, "pg_restore")
  assert.equal(calls[1].env.PGPASSWORD, undefined, "pg_restore --list needs no database")
  await assert.rejects(d.dumpDatabase("/x.dump", { databaseUrl: url, run: fake([{ code: 1, stdout: "", stderr: "pg_dump: error: connection to postgres://medusa:pw@h failed: password authentication failed" }]) }),
    (e) => /^pg_dump: /.test(e.message) && !e.message.includes("pw@") && !/password authentication/.test(e.message))
})

test("encryption: files and texts open again only with the private key", async () => {
  const lib = await age()
  const e = loader()("lib/backup/encrypt.ts")
  const identity = await lib.generateX25519Identity()
  const recipient = await lib.identityToRecipient(identity)
  const dir = tmp()
  const src = path.join(dir, "in.bin")
  const data = crypto.randomBytes(3 * 1024 * 1024 + 17)
  fs.writeFileSync(src, data)
  const size = await e.encryptFile(src, path.join(dir, "out.age"), recipient, lib)
  assert.ok(size > data.length)
  const sealed = fs.readFileSync(path.join(dir, "out.age"))
  assert.match(sealed.subarray(0, 21).toString(), /^age-encryption\.org\/v1/)
  const d = new lib.Decrypter()
  d.addIdentity(identity)
  assert.ok(Buffer.from(await d.decrypt(new Uint8Array(sealed))).equals(data))
  const wrong = new lib.Decrypter()
  wrong.addIdentity(await lib.generateX25519Identity())
  await assert.rejects(wrong.decrypt(new Uint8Array(sealed)))

  await e.encryptText("hello", path.join(dir, "t.age"), recipient, lib)
  assert.equal(await d.decrypt(new Uint8Array(fs.readFileSync(path.join(dir, "t.age"))), "text"), "hello")
})

async function passHarness({ settings = {}, now = "2026-10-10T07:07:00Z", listingTables = 40, dumpFails = false } = {}) {
  const lib = await age()
  const identity = await lib.generateX25519Identity()
  const recipient = await lib.identityToRecipient(identity)
  const mem = memoryState()
  mem.store.set("backup:settings", JSON.stringify({ enabled: true, recipient, keep_local: 2, ...settings }))
  const mails = []
  const load = loader({
    "@medusajs/framework/utils": UTILS,
    "../tracking/db": mem.stub,
    "../tracking/settings": { loadTrackingSettings: async () => ({ config: { alerts: { email: "alerts@example.com" } } }) },
    "../send-email": { sendEmail: async (m) => { mails.push(m); return { ok: true } } },
  }, { DATABASE_URL: "postgres://medusa:pw@h/florayn_v3", JWT_SECRET: "jwt-secret-value" })
  const run = load("lib/backup/run.ts")
  const dir = tmp()
  const dumpContent = Buffer.from("PGDMP fake dump")
  const fakeRun = async (cmd, argv) => {
    if (cmd === "pg_dump") {
      if (dumpFails) return { code: 1, stdout: "", stderr: "pg_dump: error: server closed the connection" }
      fs.writeFileSync(argv.find((a) => a.startsWith("--file=")).slice(7), dumpContent)
      return { code: 0, stdout: "", stderr: "" }
    }
    const names = ["order", "product", ...Array.from({ length: listingTables }, (_, i) => `t${i}`)]
    return { code: 0, stdout: names.map((n, i) => `${i}; 0 1 TABLE DATA public ${n} medusa`).join("\n"), stderr: "" }
  }
  let clock = new Date(now)
  const opts = (extra = {}) => ({ dir, run: fakeRun, age: lib, now: () => clock, ...extra })
  const container = { resolve: () => ({ warn() {} }) }
  return { run, mem, mails, dir, identity, lib, dumpContent, opts, container, setNow: (iso) => { clock = new Date(iso) } }
}

test("a pass dumps, checks, encrypts, snapshots settings once a day, prunes, and records everything", async () => {
  const h = await passHarness()
  const result = await h.run.runBackupPass(h.container, h.opts())
  assert.equal(result.status, "done")
  assert.deepEqual(plain(result.runs.map((r) => r.kind)), ["db", "env"])
  const [db, env] = result.runs
  assert.equal(db.file, "florayn-db-20261010T0707Z.dump.age")
  assert.equal(db.tables, 42)
  assert.equal(db.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(h.dir, db.file))).digest("hex"))
  assert.equal(fs.readdirSync(h.dir).filter((n) => n.startsWith(".plain")).length, 0, "the unencrypted dump is removed")
  const d = new h.lib.Decrypter()
  d.addIdentity(h.identity)
  assert.ok(Buffer.from(await d.decrypt(new Uint8Array(fs.readFileSync(path.join(h.dir, db.file))))).equals(h.dumpContent))
  const snapshot = JSON.parse(await d.decrypt(new Uint8Array(fs.readFileSync(path.join(h.dir, env.file))), "text"))
  assert.equal(snapshot.env.JWT_SECRET, "jwt-secret-value")
  assert.equal(snapshot.env.PATH, undefined)
  assert.equal(JSON.parse(h.mem.store.get("backup:runs")).length, 2)

  h.setNow("2026-10-10T08:07:00Z")
  const second = await h.run.runBackupPass(h.container, h.opts())
  assert.deepEqual(plain(second.runs.map((r) => r.kind)), ["db"], "one settings snapshot a day")
  h.setNow("2026-10-10T09:07:00Z")
  await h.run.runBackupPass(h.container, h.opts())
  assert.deepEqual(fs.readdirSync(h.dir).filter((n) => n.includes("-db-")).sort(), ["florayn-db-20261010T0807Z.dump.age", "florayn-db-20261010T0907Z.dump.age"], "keep_local 2")
  assert.equal(h.mails.length, 0)
})

test("a pass does nothing without a key, only manual runs while off, and one pass at a time", async () => {
  const off = await passHarness({ settings: { enabled: false } })
  assert.equal((await off.run.runBackupPass(off.container, off.opts())).status, "skipped")
  assert.equal((await off.run.runBackupPass(off.container, off.opts({ trigger: "manual" }))).status, "done")
  const noKey = await passHarness({ settings: { recipient: null } })
  assert.equal((await noKey.run.runBackupPass(noKey.container, noKey.opts({ trigger: "manual" }))).status, "skipped")
  const h = await passHarness()
  const [a, b] = await Promise.all([h.run.runBackupPass(h.container, h.opts()), h.run.runBackupPass(h.container, h.opts())])
  assert.deepEqual([a.status, b.status].sort(), ["busy", "done"])
})

test("a failed dump is recorded and emailed; a short dump counts as failed", async () => {
  const h = await passHarness({ dumpFails: true })
  const result = await h.run.runBackupPass(h.container, h.opts())
  assert.equal(result.status, "failed")
  assert.match(result.runs[0].error, /server closed the connection/)
  assert.equal(h.mails.length, 1)
  assert.equal(h.mails[0].to, "alerts@example.com")
  assert.equal(h.mails[0].subject, "Florayn backup failed")
  const short = await passHarness({ listingTables: 3 })
  const r = await short.run.runBackupPass(short.container, short.opts())
  assert.equal(r.runs[0].ok, false)
  assert.match(r.runs[0].error, /only 5 tables/)
})

test("alerts: failure, repeat after 6 h, recovery, and Google Drive falling behind", async () => {
  const run = loader({ "@medusajs/framework/utils": UTILS, "../tracking/db": memoryState().stub, "../tracking/settings": {}, "../send-email": {} })("lib/backup/run.ts")
  const empty = { failing_since: null, failure_mailed_at: null, stale_mailed_at: null }
  const at = (iso) => new Date(iso)
  const bad = { kind: "db", ok: false, error: "boom" }
  let r = run.alertsFor({ state: empty, dbRun: bad, runs: [], driveSetUp: false, now: at("2026-10-10T01:00:00Z") })
  assert.equal(r.mails.length, 1)
  r = run.alertsFor({ state: r.state, dbRun: bad, runs: [], driveSetUp: false, now: at("2026-10-10T03:00:00Z") })
  assert.equal(r.mails.length, 0, "no repeat within 6 h")
  r = run.alertsFor({ state: r.state, dbRun: bad, runs: [], driveSetUp: false, now: at("2026-10-10T07:01:00Z") })
  assert.equal(r.mails.length, 1)
  r = run.alertsFor({ state: r.state, dbRun: { kind: "db", ok: true, finished_at: "2026-10-10T08:00:00Z" }, runs: [], driveSetUp: false, now: at("2026-10-10T08:00:00Z") })
  assert.equal(r.mails[0].subject, "Florayn backups are working again")
  assert.equal(r.state.failing_since, null)

  const waiting = [{ kind: "db", ok: true, finished_at: "2026-10-10T01:00:00Z", pulled_at: null }]
  assert.equal(run.alertsFor({ state: empty, dbRun: null, runs: waiting, driveSetUp: false, now: at("2026-10-10T09:00:00Z") }).mails.length, 0, "no Drive alert before Drive is set up")
  assert.equal(run.alertsFor({ state: empty, dbRun: null, runs: waiting, driveSetUp: true, now: at("2026-10-10T03:00:00Z") }).mails.length, 0, "under 4 h")
  const stale = run.alertsFor({ state: empty, dbRun: null, runs: waiting, driveSetUp: true, now: at("2026-10-10T06:00:00Z") })
  assert.equal(stale.mails[0].subject, "Google Drive has not collected Florayn backups")
  assert.equal(run.alertsFor({ state: stale.state, dbRun: null, runs: waiting, driveSetUp: true, now: at("2026-10-10T08:00:00Z") }).mails.length, 0, "repeats only every 12 h")
  const pulled = [{ ...waiting[0], pulled_at: "2026-10-10T01:30:00Z" }]
  assert.equal(run.alertsFor({ state: empty, dbRun: null, runs: pulled, driveSetUp: true, now: at("2026-10-10T09:00:00Z") }).mails.length, 0)
})

test("the pull API: only the right bearer token, guessing gets 429, the manifest lists checked files", async () => {
  const t = loader()("lib/backup/token.ts")
  const { token, hash } = t.newPullToken()
  const settingsStub = { loadSettings: async () => ({ pull_token_hash: hash }), loadRuns: async () => [] }
  const pull = loader({ "./settings": settingsStub, "@medusajs/framework/http": {} })("lib/backup/pull.ts")
  const res = () => { const r = { code: 200, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v }; r.status = (c) => { r.code = c; return r }; r.json = () => r; return r }
  const ask = async (auth) => { const r = res(); const ok = await pull.authorizePull({ headers: { authorization: auth }, scope: {} }, r); return { ok, code: r.code, cache: r.headers["Cache-Control"] } }
  assert.deepEqual(await ask(`Bearer ${token}`), { ok: true, code: 200, cache: "no-store" })
  assert.equal((await ask(undefined)).code, 401)
  assert.equal((await ask(`Bearer flb_${"A".repeat(43)}`)).code, 401)
  for (let i = 0; i < 40; i++) await ask("Bearer nope")
  assert.equal((await ask(`Bearer ${token}`)).code, 429, "throttled while guessing")

  const files = [{ name: "florayn-db-20261010T0707Z.dump.age", kind: "db", bytes: 10, modified: "x" }, { name: "florayn-db-20261010T0607Z.dump.age", kind: "db", bytes: 9, modified: "y" }]
  const runs = [{ ok: true, file: files[0].name, sha256: "a".repeat(64), finished_at: "2026-10-10T07:07:30Z", pulled_at: null }]
  assert.deepEqual(plain(pull.manifestOf(files, runs)), [{ name: files[0].name, kind: "db", bytes: 10, sha256: "a".repeat(64), created_at: "2026-10-10T07:07:30Z", pulled: false }], "files without a successful run are not offered")
})

/** The Apps Script in a sandbox with fake Drive, UrlFetch, Properties and Utilities. */
function appsScript(server, files, { token = "flb_tok", tamper = false } = {}) {
  const source = loader()("lib/backup/apps-script.ts").appsScriptSource(server)
  const drive = new Map()
  const trashed = []
  const calls = []
  const fileObj = (name) => ({ getName: () => name, setTrashed: () => { drive.delete(name); trashed.push(name) } })
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] } }
  const folder = { getFiles: () => iter([...drive.keys()].map(fileObj)), createFile: (blob) => { drive.set(blob.name, blob.bytes); return fileObj(blob.name) } }
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "FLORAYN_BACKUP_TOKEN" ? token : null) }) },
    DriveApp: { getFoldersByName: () => iter([folder]), createFolder: () => folder },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => undefined }) }) }) },
    Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, computeDigest: (_a, bytes) => [...crypto.createHash("sha256").update(Buffer.from(bytes)).digest()].map((b) => (b > 127 ? b - 256 : b)) },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, method: options.method, auth: options.headers.Authorization, payload: options.payload ? JSON.parse(options.payload) : null })
        const p = url.slice(server.length)
        if (p === "/backup-pull/manifest") return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: files.map((f) => ({ name: f.name, sha256: f.sha, pulled: Boolean(f.pulled) })) }) }
        if (p.startsWith("/backup-pull/files/")) {
          const f = files.find((x) => x.name === decodeURIComponent(p.split("/").pop()))
          const bytes = tamper ? Buffer.from("evil") : f.bytes
          const blob = { bytes, name: null, getBytes: () => [...bytes], setName(n) { this.name = n; return this } }
          return { getResponseCode: () => 200, getBlob: () => blob }
        }
        if (p === "/backup-pull/ack") return { getResponseCode: () => 200, getContentText: () => "{}" }
        return { getResponseCode: () => 404 }
      },
    },
  }
  vm.runInNewContext(source, sandbox)
  return { sandbox, drive, trashed, calls }
}

test("the Google Drive script collects new files, checks them, acknowledges them and thins out old copies", () => {
  const server = "https://api.example.com"
  const mk = (name, content) => ({ name, bytes: Buffer.from(content), sha: crypto.createHash("sha256").update(content).digest("hex") })
  const files = [mk("florayn-db-20261010T0707Z.dump.age", "a"), mk("florayn-env-20261010.json.age", "b")]
  const g = appsScript(server, files)
  assert.match(fs.readFileSync(path.join(__dirname, "../src/lib/backup/apps-script.ts"), "utf8"), /setTrashed\(true\)/)
  g.sandbox.pullBackups()
  assert.deepEqual([...g.drive.keys()].sort(), files.map((f) => f.name).sort())
  assert.ok(g.calls.every((c) => c.auth === "Bearer flb_tok"))
  assert.deepEqual(g.calls.filter((c) => c.url.endsWith("/ack")).map((c) => c.payload.name).sort(), files.map((f) => f.name).sort())

  // A file already in Drive but not yet acknowledged is acknowledged, not downloaded again.
  const again = appsScript(server, [{ ...files[0], pulled: false }])
  again.drive.set(files[0].name, files[0].bytes)
  again.sandbox.pullBackups()
  assert.equal(again.calls.filter((c) => c.url.includes("/files/")).length, 0)
  assert.equal(again.calls.filter((c) => c.url.endsWith("/ack")).length, 1)

  const evil = appsScript(server, [files[0]], { tamper: true })
  assert.throws(() => evil.sandbox.pullBackups(), /Checksum mismatch/)
  assert.equal(evil.drive.size, 0, "a file whose checksum does not match is not saved")
})

test("the Drive retention: 48 h of hourly copies, then one a day for 30 days and one a month for a year", () => {
  const g = appsScript("https://x", [])
  const now = new Date("2026-10-10T12:00:00Z")
  const name = (iso) => `florayn-db-${iso.replace(/[-:]/g, "").slice(0, 13)}Z.dump.age`
  const names = []
  for (let h = 0; h < 24 * 400; h += 1) names.push(name(new Date(now.getTime() - h * 3600e3).toISOString()))
  names.push("florayn-env-20261009.json.age", "florayn-env-20250101.json.age", "something-else.txt")
  const keep = g.sandbox.keepNames_(names, now)
  const kept = names.filter((n) => keep[n])
  const db = kept.filter((n) => n.includes("-db-"))
  const recent = db.filter((n) => n >= name(new Date(now.getTime() - 48 * 3600e3).toISOString()))
  assert.equal(recent.length, 49, "every hourly copy of the last 48 hours")
  assert.ok(db.length <= 49 + 30 + 13 && db.length >= 49 + 28 + 11, `about 48 h + 30 days + 12 months, got ${db.length}`)
  assert.ok(keep["florayn-env-20261009.json.age"])
  assert.ok(!keep["florayn-env-20250101.json.age"], "older than a year")
  assert.ok(!keep["something-else.txt"])
})
