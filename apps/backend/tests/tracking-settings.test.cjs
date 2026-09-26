const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Loads one source file the way the backend tests do: transpile, then run it
// in a sandbox whose require only knows the stubs listed here.
function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, Buffer, process, URL, URLSearchParams, Date, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const vectors = require("./fixtures/tracking-vectors.json")
const PG = "__pg_connection__"
const utils = { ContainerRegistrationKeys: { PG_CONNECTION: PG } }

function clock(start = Date.UTC(2026, 8, 27, 6, 0, 0)) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, advance(ms) { now += ms } }
}

function loadSettings(globals = {}) {
  return load("lib/tracking/settings.ts", {
    "node:crypto": crypto,
    "@medusajs/framework/utils": utils,
    "../../modules/tracking": { TRACKING_MODULE: "tracking" },
  }, globals)
}

function fakeService(initial = null, { failCreate = false } = {}) {
  const calls = []
  let row = initial ? { ...initial } : null
  return {
    calls,
    get row() { return row },
    set row(value) { row = value },
    async listTrackingSettings(filters, config) {
      calls.push(["list", plain(filters), plain(config)])
      return row && row.id === filters.id ? [{ ...row }] : []
    },
    async createTrackingSettings(data) {
      calls.push(["create", plain(data)])
      if (failCreate || row) throw new Error("duplicate key value violates unique constraint")
      row = { meta_test_token: null, meta_live_token: null, tiktok_test_token: null, tiktok_live_token: null, catalog_feed_token: null, ...data }
      return { ...row }
    },
    async updateTrackingSettings(data) {
      calls.push(["update", plain(data)])
      row = { ...row, ...data }
      return { ...row }
    },
  }
}

function containerFor(service, extra = {}) {
  return {
    resolve(key) {
      if (key === "tracking") return service
      if (Object.hasOwn(extra, key)) return extra[key]
      throw new Error(`Unexpected resolve ${key}`)
    },
  }
}

// TRACKING.md 3.1, copied by hand so a changed default is a deliberate edit.
const SPEC_DEFAULTS = {
  v: 1,
  test_hosts: ["new.florayn.com"],
  live_hosts: ["florayn.com", "www.florayn.com"],
  live_armed: false,
  meta: {
    enabled: false, test_id: "2247389409441720", live_id: "650439547920083",
    test_event_code: "", api_version: "v26.0", browser: "all",
    aam_off_confirmed: { test: false, live: false },
    status_events: { OrderConfirmed: true, Delivered: true, Returned: true },
  },
  tiktok: {
    enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only",
    spa_off_confirmed: false,
  },
  google: {
    enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D",
    browser: "ads_only",
  },
  privacy: { share_contact_hashes: false, consent_text: "", consent_version: 1 },
  alerts: {
    enabled: true, email: "floraynweb@gmail.com", active_from_hour: 10, active_to_hour: 24,
    no_purchase_hours: 3, repeat_hours: 6,
  },
  dashboard: { daily_order_target: 300, poll_seconds: 15 },
  catalog: {
    enabled: false, base_url: "https://new.florayn.com", image_base_url: "https://img.florayn.com",
    image_mode: "jpeg_copies", shrink_guard_pct: 20,
    include_case_types: [], exclude_case_types: ["alcantara"],
  },
}

test("parseTrackingConfig of nothing is exactly the 3.1 defaults", () => {
  const s = loadSettings()
  for (const raw of [undefined, null, {}, [], "junk", 5, "{\"broken\""]) {
    assert.deepEqual(plain(s.parseTrackingConfig(raw)), SPEC_DEFAULTS, String(raw))
  }
  assert.deepEqual(plain(s.DEFAULT_CONFIG), SPEC_DEFAULTS)
  assert.equal(s.TRACKING_SETTINGS_ID, "trackset_default")
})

test("parseTrackingConfig merges objects, replaces arrays and falls back on junk", () => {
  const s = loadSettings()
  const merged = s.parseTrackingConfig({ meta: { enabled: true }, test_hosts: ["a.example"], catalog: { exclude_case_types: [] } })
  assert.equal(merged.meta.enabled, true)
  assert.equal(merged.meta.test_id, "2247389409441720")
  assert.deepEqual(plain(merged.meta.aam_off_confirmed), { test: false, live: false })
  assert.deepEqual(plain(merged.test_hosts), ["a.example"])
  assert.deepEqual(plain(merged.catalog.exclude_case_types), [])
  const junk = s.parseTrackingConfig({
    v: 7, extra: "dropped", test_hosts: "new.florayn.com", live_hosts: [1, 2], live_armed: "yes",
    meta: { enabled: 1, browser: "sometimes", aam_off_confirmed: true, status_events: { Delivered: "no" }, unknown: 1 },
    alerts: { active_from_hour: 30, no_purchase_hours: 2.5, email: 7 },
    dashboard: { poll_seconds: 5 }, privacy: { consent_version: 0 }, catalog: { image_mode: "webp" },
  })
  assert.deepEqual(plain(junk), SPEC_DEFAULTS)
  // A config stored as JSON text is read too.
  assert.equal(s.parseTrackingConfig(JSON.stringify({ live_armed: true })).live_armed, true)
})

function patch(s, body, { current, privacyPublished = false } = {}) {
  return s.parseTrackingPatch(body, { current: current ?? s.DEFAULT_CONFIG, privacyPublished })
}

test("every 3.2 rule accepts a valid value", () => {
  const s = loadSettings()
  const valid = [
    { meta: { test_id: "1234567890" } }, { meta: { test_id: "" } }, { meta: { live_id: "12345678901234567890" } },
    { tiktok: { test_id: "ABCDEFGHIJKLMNOP" } }, { tiktok: { live_id: "" } }, { tiktok: { test_id: "ABCDEFGHIJKLMNOPQRSTUVWX" } },
    { google: { conversion_id: "AW-123456" } }, { google: { conversion_id: "AW-123456789012345" } },
    { google: { purchase_label: "abc_DEF-12" } }, { meta: { api_version: "v27.0" } },
    { meta: { test_event_code: "TEST123" } }, { meta: { test_event_code: "TEST123456789012" } }, { meta: { test_event_code: "" } },
    { meta: { browser: "off" } }, { tiktok: { browser: "all" } }, { google: { browser: "ads_only" } },
    { test_hosts: ["new.florayn.com", "localhost"] }, { live_hosts: [] }, { test_hosts: ["a", "b", "c", "d", "e"] },
    { alerts: { email: "owner@example.com" } }, { alerts: { active_from_hour: 0, active_to_hour: 24 } },
    { alerts: { no_purchase_hours: 1 } }, { alerts: { no_purchase_hours: 12 } }, { alerts: { repeat_hours: 1 } },
    { alerts: { repeat_hours: 48 } }, { dashboard: { poll_seconds: 10 } }, { dashboard: { poll_seconds: 60 } },
    { dashboard: { daily_order_target: 1 } }, { dashboard: { daily_order_target: 100000 } }, { dashboard: { daily_order_target: "300" } },
    { catalog: { shrink_guard_pct: 5 } }, { catalog: { shrink_guard_pct: 50 } },
    { privacy: { consent_text: "x".repeat(600) } }, { privacy: { consent_text: "" } },
    { catalog: { include_case_types: ["signature", "elite-clear"], exclude_case_types: [] } },
    { catalog: { image_mode: "cf_transform" } }, { catalog: { image_mode: "jpeg_copies" } },
    { catalog: { base_url: "https://florayn.com", image_base_url: "https://img.florayn.com/catalog" } },
    { live_armed: true }, { live_armed: false }, { meta: { enabled: true } },
    { meta: { aam_off_confirmed: { test: true } } }, { meta: { aam_off_confirmed: { live: true } } },
    { meta: { status_events: { OrderConfirmed: false, Delivered: true, Returned: false } } },
    { tiktok: { enabled: true, spa_off_confirmed: true } }, { google: { enabled: true } },
    { alerts: { enabled: false } }, { catalog: { enabled: true } }, { privacy: { share_contact_hashes: false } },
    {}, { v: 1 },
  ]
  for (const body of valid) {
    const result = patch(s, body)
    assert.equal(result.ok, true, `${JSON.stringify(body)}: ${JSON.stringify(result.errors)}`)
  }
  const merged = patch(s, { meta: { enabled: true, aam_off_confirmed: { test: true } }, test_hosts: [" NEW.Florayn.com ", "new.florayn.com"] })
  assert.equal(merged.config.meta.enabled, true)
  assert.deepEqual(plain(merged.config.meta.aam_off_confirmed), { test: true, live: false })
  assert.equal(merged.config.meta.live_id, "650439547920083")
  assert.deepEqual(plain(merged.config.test_hosts), ["new.florayn.com"])
  assert.equal(patch(s, { dashboard: { daily_order_target: "250" } }).config.dashboard.daily_order_target, 250)
})

test("every 3.2 rule rejects an invalid value", () => {
  const s = loadSettings()
  const invalid = [
    { meta: { test_id: "123" } }, { meta: { test_id: "123456789012345678901" } }, { meta: { live_id: "abc1234567" } },
    { meta: { test_id: 1234567890 } },
    { tiktok: { test_id: "abcdefghijklmnop" } }, { tiktok: { live_id: "ABC" } }, { tiktok: { test_id: "ABCDEFGHIJKLMNOPQRSTUVWXY" } },
    { google: { conversion_id: "AW-12345" } }, { google: { conversion_id: "123456789" } }, { google: { conversion_id: "" } },
    { google: { purchase_label: "short" } }, { google: { purchase_label: "has a space in it" } }, { google: { purchase_label: "x".repeat(41) } },
    { meta: { api_version: "26.0" } }, { meta: { api_version: "v26" } }, { meta: { api_version: "v2.0" } },
    { meta: { test_event_code: "TEST12" } }, { meta: { test_event_code: "test123" } }, { meta: { test_event_code: "TEST1234567890123" } },
    { meta: { browser: "sometimes" } }, { tiktok: { browser: "" } }, { google: { browser: true } },
    { test_hosts: ["https://florayn.com"] }, { test_hosts: ["florayn.com:443"] }, { live_hosts: ["florayn.com/shop"] },
    { test_hosts: ["a", "b", "c", "d", "e", "f"] }, { test_hosts: "new.florayn.com" }, { test_hosts: ["florayn.com"] },
    { live_hosts: ["new.florayn.com"] },
    { alerts: { email: "not-an-email" } }, { alerts: { email: "a b@c.com" } }, { alerts: { email: "" } },
    { alerts: { active_from_hour: 25 } }, { alerts: { active_from_hour: -1 } }, { alerts: { active_from_hour: 10, active_to_hour: 10 } },
    { alerts: { active_from_hour: 1.5 } }, { alerts: { active_to_hour: 9 } },
    { alerts: { no_purchase_hours: 0 } }, { alerts: { no_purchase_hours: 13 } }, { alerts: { repeat_hours: 0 } },
    { alerts: { repeat_hours: 49 } }, { dashboard: { poll_seconds: 9 } }, { dashboard: { poll_seconds: 61 } },
    { dashboard: { daily_order_target: 0 } }, { dashboard: { daily_order_target: 100001 } },
    { catalog: { shrink_guard_pct: 4 } }, { catalog: { shrink_guard_pct: 51 } },
    { privacy: { consent_text: "x".repeat(601) } }, { privacy: { consent_text: 5 } }, { privacy: { consent_text: "a\u0000b" } },
    { catalog: { include_case_types: ["Alcantara Case"] } }, { catalog: { exclude_case_types: ["x".repeat(41)] } },
    { catalog: { exclude_case_types: "alcantara" } },
    { catalog: { image_mode: "webp" } },
    { catalog: { base_url: "http://florayn.com" } }, { catalog: { base_url: "https://florayn.com/" } },
    { catalog: { image_base_url: "img.florayn.com" } }, { catalog: { base_url: "https://florayn.com?x=1" } },
    { live_armed: "true" }, { meta: { enabled: "yes" } }, { meta: { aam_off_confirmed: { test: 1 } } },
    { meta: { aam_off_confirmed: true } }, { meta: { status_events: { Delivered: "on" } } },
    { tiktok: { spa_off_confirmed: "true" } }, { google: { enabled: 1 } }, { alerts: { enabled: null } },
    { catalog: { enabled: "on" } }, { privacy: { share_contact_hashes: "true" } },
    { foo: 1 }, { meta: { foo: 1 } }, { meta: "on" }, { meta: { status_events: { Cancelled: true } } },
  ]
  for (const body of invalid) {
    const result = patch(s, body)
    assert.equal(result.ok, false, JSON.stringify(body))
    assert.ok(result.errors.length > 0)
  }
  for (const body of [null, [], "x", 5]) assert.equal(patch(s, body).ok, false)
})

test("share ON needs a consent text AND a published Privacy page", () => {
  const s = loadSettings()
  const text = s.SUGGESTED_CONSENT_TEXT
  assert.equal(patch(s, { privacy: { share_contact_hashes: true } }, { privacyPublished: true }).ok, false)
  assert.equal(patch(s, { privacy: { share_contact_hashes: true, consent_text: text } }, { privacyPublished: false }).ok, false)
  assert.equal(patch(s, { privacy: { share_contact_hashes: true, consent_text: "   " } }, { privacyPublished: true }).ok, false)
  const saved = s.parseTrackingConfig({ privacy: { consent_text: text, consent_version: 2 } })
  assert.equal(patch(s, { privacy: { share_contact_hashes: true } }, { current: saved, privacyPublished: false }).ok, false)
  const on = patch(s, { privacy: { share_contact_hashes: true } }, { current: saved, privacyPublished: true })
  assert.equal(on.ok, true)
  assert.equal(on.config.privacy.share_contact_hashes, true)
  assert.equal(on.config.privacy.consent_version, 2)
  const both = patch(s, { privacy: { share_contact_hashes: true, consent_text: text } }, { privacyPublished: true })
  assert.equal(both.ok, true)
  assert.equal(both.config.privacy.consent_version, 2)
  // While share is ON the text may change but not become empty.
  const sharing = s.parseTrackingConfig({ privacy: { share_contact_hashes: true, consent_text: text, consent_version: 3 } })
  assert.equal(patch(s, { privacy: { consent_text: "" } }, { current: sharing, privacyPublished: true }).ok, false)
  assert.equal(patch(s, { privacy: { consent_text: "New words." } }, { current: sharing, privacyPublished: true }).config.privacy.consent_version, 4)
  // Turning it off is always allowed.
  const off = patch(s, { privacy: { share_contact_hashes: false, consent_text: "" } }, { current: sharing })
  assert.equal(off.ok, true)
  assert.equal(off.config.privacy.share_contact_hashes, false)
})

test("consent_version goes up only when the consent text changes and is read-only", () => {
  const s = loadSettings()
  const first = patch(s, { privacy: { consent_text: "  Version one.  " } })
  assert.equal(first.config.privacy.consent_text, "Version one.")
  assert.equal(first.config.privacy.consent_version, 2)
  const same = patch(s, { privacy: { consent_text: "Version one." } }, { current: first.config })
  assert.equal(same.config.privacy.consent_version, 2)
  const second = patch(s, { privacy: { consent_text: "Version two." } }, { current: first.config })
  assert.equal(second.config.privacy.consent_version, 3)
  const forced = patch(s, { privacy: { consent_version: 99 } }, { current: second.config })
  assert.equal(forced.ok, true)
  assert.equal(forced.config.privacy.consent_version, 3)
})

test("tokens: blank or missing keeps, __remove__ clears, anything else is one word up to 512 chars", () => {
  const s = loadSettings()
  assert.deepEqual(plain(patch(s, {}).tokens), {})
  assert.deepEqual(plain(patch(s, { meta_test_token: "", meta_live_token: "   ", tiktok_test_token: null }).tokens), {})
  assert.deepEqual(plain(patch(s, { meta_test_token: "__remove__" }).tokens), { meta_test_token: null })
  assert.deepEqual(plain(patch(s, {
    meta_test_token: "  EAAtest123  ", meta_live_token: "EAAlive456", tiktok_test_token: "tt-test", tiktok_live_token: "x".repeat(512),
  }).tokens), { meta_test_token: "EAAtest123", meta_live_token: "EAAlive456", tiktok_test_token: "tt-test", tiktok_live_token: "x".repeat(512) })
  for (const value of ["has space", "x".repeat(513), 5, ["EAA"], "tab\there", "nul\u0000x"]) {
    const result = patch(s, { meta_live_token: value })
    assert.equal(result.ok, false, JSON.stringify(value))
    if (typeof value === "string") assert.equal(JSON.stringify(result.errors).includes(value), false, "errors never echo a token")
  }
  assert.equal(patch(s, { catalog_feed_token: "abc" }).ok, false, "the feed token is generated, not pasted")
})

test("present() masks every token and never returns one raw", () => {
  const s = loadSettings()
  const row = {
    id: "trackset_default", config: { meta: { enabled: true } },
    meta_test_token: "EAAsecret-test-9876", meta_live_token: "EAAsecret-live-5432",
    tiktok_test_token: "abc", tiktok_live_token: null, catalog_feed_token: "feedTokenFeedTokenFeedToken12345",
  }
  const view = plain(s.present(row))
  const json = JSON.stringify(view)
  for (const token of ["EAAsecret-test-9876", "EAAsecret-live-5432", "\"abc\""]) assert.equal(json.includes(token), false, token)
  assert.equal(view.meta_test_token_set, true)
  assert.equal(view.meta_test_token_masked, "••••••••9876")
  assert.equal(view.meta_live_token_masked, "••••••••5432")
  assert.equal(view.tiktok_test_token_set, true)
  assert.equal(view.tiktok_test_token_masked, "••••")
  assert.equal(view.tiktok_live_token_set, false)
  assert.equal(view.tiktok_live_token_masked, "")
  assert.equal(view.catalog_feed_token, "feedTokenFeedTokenFeedToken12345")
  assert.equal(view.config.meta.enabled, true)
  assert.deepEqual(Object.keys(view).filter((key) => key.endsWith("_token")), ["catalog_feed_token"])
  const empty = plain(s.present(null))
  assert.deepEqual(empty.config, SPEC_DEFAULTS)
  assert.equal(empty.meta_test_token_set, false)
  assert.equal(empty.catalog_feed_token, "")
})

test("hostRole equals every host_role vector", () => {
  const s = loadSettings()
  for (const [configPatch, host, expected] of vectors.host_role) {
    assert.equal(s.hostRole(s.parseTrackingConfig(configPatch), host), expected, `${JSON.stringify(configPatch)} ${host}`)
  }
  assert.equal(s.normHost("NEW.florayn.com:443"), "new.florayn.com")
  assert.equal(s.normHost(" Florayn.COM "), "florayn.com")
  assert.equal(s.hostRole(s.DEFAULT_CONFIG, ""), null)
})

test("destinationFor equals every destination vector", () => {
  const s = loadSettings()
  for (const vector of vectors.destination) {
    const config = s.parseTrackingConfig(vector.patch)
    assert.deepEqual(plain(s.destinationFor(config, vector.host, vector.platform)), vector.expect, JSON.stringify(vector))
  }
  const google = s.parseTrackingConfig({ live_armed: true, google: { enabled: true, conversion_id: "" } })
  assert.equal(s.destinationFor(google, "florayn.com", "google"), null)
})

test("publicConfig has ids and modes only: no token, email, catalog or feed keys", () => {
  const s = loadSettings()
  const config = s.parseTrackingConfig({
    meta: { enabled: true, test_event_code: "TEST999" },
    privacy: { share_contact_hashes: false, consent_text: "Only shown while sharing.", consent_version: 4 },
    catalog: { enabled: true },
  })
  const view = plain(s.publicConfig(config))
  assert.deepEqual(view, {
    test_hosts: ["new.florayn.com"], live_hosts: ["florayn.com", "www.florayn.com"], live_armed: false,
    meta: { enabled: true, test_id: "2247389409441720", live_id: "650439547920083", browser: "all", aam_off_confirmed: { test: false, live: false } },
    tiktok: { enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only", spa_off_confirmed: false },
    google: { enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D", browser: "ads_only" },
    privacy: { share: false, consent_version: 4, consent_text: "" },
  })
  const json = JSON.stringify(view)
  for (const word of ["token", "email", "catalog", "feed", "image", "alerts", "TEST999", "floraynweb"]) {
    assert.equal(json.toLowerCase().includes(word.toLowerCase()), false, word)
  }
  const sharing = s.parseTrackingConfig({ privacy: { share_contact_hashes: true, consent_text: "We measure ads.", consent_version: 5 } })
  assert.deepEqual(plain(s.publicConfig(sharing).privacy), { share: true, consent_version: 5, consent_text: "We measure ads." })
})

test("tokenFingerprint is the first 8 hex of sha256", () => {
  const s = loadSettings()
  assert.equal(s.tokenFingerprint("abc"), "ba7816bf")
  assert.equal(s.tokenFingerprint("EAAtoken").length, 8)
})

test("loadTrackingSettings: defaults without a row, a 10 s cache, invalidation, and the token loader", async () => {
  const time = clock()
  const s = loadSettings({ Date: time.Date })
  const service = fakeService()
  const container = containerFor(service)
  const empty = await s.loadTrackingSettings(container)
  assert.deepEqual(plain(empty), {
    config: SPEC_DEFAULTS,
    tokenSet: { meta: { test: false, live: false }, tiktok: { test: false, live: false } },
    feedToken: null,
  })
  assert.deepEqual(service.calls[0], ["list", { id: "trackset_default" }, { take: 1 }])
  service.row = { id: "trackset_default", config: { meta: { enabled: true } }, meta_test_token: "EAAtest", meta_live_token: null,
    tiktok_test_token: null, tiktok_live_token: "ttlive", catalog_feed_token: "feed" }
  time.advance(9_000)
  assert.equal((await s.loadTrackingSettings(container)).config.meta.enabled, false, "cached for 10 s")
  assert.equal(service.calls.length, 1)
  time.advance(1_001)
  const fresh = await s.loadTrackingSettings(container)
  assert.equal(fresh.config.meta.enabled, true)
  assert.deepEqual(plain(fresh.tokenSet), { meta: { test: true, live: false }, tiktok: { test: false, live: true } })
  assert.equal(fresh.feedToken, "feed")
  assert.equal(JSON.stringify(fresh).includes("EAAtest"), false, "the view never carries a token")
  assert.equal(await s.loadTrackingToken(container, "meta", "test"), "EAAtest")
  assert.equal(await s.loadTrackingToken(container, "meta", "live"), null)
  assert.equal(await s.loadTrackingToken(container, "tiktok", "live"), "ttlive")
  assert.equal(service.calls.length, 2, "the token loader shares the cache")
  service.row = { ...service.row, meta_live_token: "EAAlive" }
  s.invalidateTrackingSettings()
  assert.equal(await s.loadTrackingToken(container, "meta", "live"), "EAAlive")
  assert.equal(service.calls.length, 3)
  // A failed read is not cached.
  const failing = { resolve: () => ({ async listTrackingSettings() { throw new Error("db down") } }) }
  s.invalidateTrackingSettings()
  await assert.rejects(s.loadTrackingSettings(failing), /db down/)
  assert.equal((await s.loadTrackingSettings(container)).config.meta.enabled, true)
})

test("the singleton is created with the fixed id and a concurrent create is recovered", async () => {
  const s = loadSettings()
  const service = fakeService()
  const row = await s.ensureTrackingSettingsRow(containerFor(service))
  assert.equal(row.id, "trackset_default")
  assert.deepEqual(service.calls.map((call) => call[0]), ["list", "create"])
  // Another request created it between our read and our create.
  const racing = fakeService()
  const original = racing.listTrackingSettings
  let reads = 0
  racing.listTrackingSettings = async (...args) => {
    reads += 1
    if (reads === 2) racing.row = { id: "trackset_default", config: {} }
    return original.apply(racing, args)
  }
  racing.createTrackingSettings = async () => { throw new Error("duplicate key") }
  assert.equal((await s.ensureTrackingSettingsRow(containerFor(racing))).id, "trackset_default")
  // Any other create failure is preserved.
  const broken = fakeService(null, { failCreate: true })
  await assert.rejects(s.ensureTrackingSettingsRow(containerFor(broken)), /duplicate key/)
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/tracking/settings.ts"), "utf8")
  assert.equal(/listTrackingSettings\(\{\s*\}/.test(source), false, "never list-take-1-then-create")
})

test("tokens are written straight through the module service and invalidate the cache", async () => {
  const s = loadSettings()
  const service = fakeService()
  const container = containerFor(service)
  await s.saveTrackingTokens(container, {})
  assert.equal(service.calls.length, 0)
  await s.loadTrackingSettings(container)
  await s.saveTrackingTokens(container, { meta_test_token: "EAAnew", tiktok_live_token: null, config: { junk: 1 } })
  const update = service.calls.find((call) => call[0] === "update")
  assert.deepEqual(update[1], { id: "trackset_default", meta_test_token: "EAAnew", tiktok_live_token: null })
  assert.equal(await s.loadTrackingToken(container, "meta", "test"), "EAAnew")
})

test("ensureFeedToken generates 32 url-safe chars once; rotateFeedToken replaces it", async () => {
  const s = loadSettings()
  const service = fakeService()
  const container = containerFor(service)
  const token = await s.ensureFeedToken(container)
  assert.match(token, /^[A-Za-z0-9_-]{32}$/)
  assert.equal(service.row.catalog_feed_token, token)
  assert.equal(await s.ensureFeedToken(container), token)
  const rotated = await s.rotateFeedToken(container)
  assert.notEqual(rotated, token)
  assert.equal(service.row.catalog_feed_token, rotated)
  assert.equal((await s.loadTrackingSettings(container)).feedToken, rotated)
})

test("isPrivacyPublished reads privacy_setting and treats any error as unpublished", async () => {
  const s = loadSettings()
  const seen = []
  const knex = (result) => ({ async raw(sql, bindings) { seen.push([sql, bindings]); if (result instanceof Error) throw result; return result } })
  const with_ = (result) => ({ resolve: (key) => { assert.equal(key, PG); return knex(result) } })
  assert.equal(await s.isPrivacyPublished(with_({ rows: [{ published: true }] })), true)
  assert.match(seen[0][0], /select published from privacy_setting where id = \? and deleted_at is null/)
  assert.deepEqual(plain(seen[0][1]), ["privacyset_default"])
  assert.equal(await s.isPrivacyPublished(with_({ rows: [{ published: false }] })), false)
  assert.equal(await s.isPrivacyPublished(with_({ rows: [] })), false)
  assert.equal(await s.isPrivacyPublished(with_(new Error("relation \"privacy_setting\" does not exist"))), false)
})

function loadWorkflow(settings, revalidations) {
  return load("workflows/update-tracking-settings.ts", {
    "@medusajs/framework/workflows-sdk": {
      createStep: (_name, run) => run,
      createWorkflow: (_name, compose) => compose,
      StepResponse: class { constructor(value) { this.value = value } },
      WorkflowResponse: class { constructor(value) { this.value = value } },
    },
    "../lib/revalidate-storefront": { queueStorefrontRevalidation: async (input) => { revalidations.push(plain(input)); return true } },
    "../lib/tracking/settings": settings,
    "../modules/tracking": { TRACKING_MODULE: "tracking" },
  })
}

test("the settings workflow saves config only, on the fixed row, and refreshes caches", async () => {
  const s = loadSettings()
  const revalidations = []
  const workflow = loadWorkflow(s, revalidations)
  const service = fakeService()
  const container = containerFor(service)
  assert.equal((await s.loadTrackingSettings(container)).config.meta.enabled, false)
  const next = s.parseTrackingConfig({ meta: { enabled: true } })
  const response = await workflow.updateTrackingSettingsStep({ config: next }, { container })
  assert.equal(response.value.meta.enabled, true)
  const writes = service.calls.filter((call) => call[0] !== "list")
  assert.deepEqual(writes.map((call) => call[0]), ["create", "update"])
  assert.equal(writes[0][1].id, "trackset_default")
  assert.deepEqual(Object.keys(writes[1][1]).sort(), ["config", "id"])
  assert.deepEqual(revalidations, [{ tags: ["content:tracking"] }])
  assert.equal((await s.loadTrackingSettings(container)).config.meta.enabled, true, "cache invalidated")
  const source = fs.readFileSync(path.join(__dirname, "../src/workflows/update-tracking-settings.ts"), "utf8")
  assert.equal(/_token/.test(source), false, "tokens never pass through the workflow")
})

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = plain(body); return this },
  }
}

function loadAdminRoute(settings, runs, kicks) {
  return load("api/admin/tracking/settings/route.ts", {
    "../../../../lib/send-email": { emailConfigured: () => false },
    "../../../../lib/tracking/jobs": { kickStaleJobs: (scope) => kicks.push(scope) },
    "../../../../lib/tracking/settings": settings,
    "../../../../workflows/update-tracking-settings": {
      updateTrackingSettingsWorkflow: (scope) => ({
        async run({ input }) {
          runs.push(plain(input))
          const service = scope.resolve("tracking")
          await settings.ensureTrackingSettingsRow(scope)
          await service.updateTrackingSettings({ id: "trackset_default", config: input.config })
          return { result: { config: input.config } }
        },
      }),
    },
  })
}

test("admin settings route: masked GET, 400 with errors, config via the workflow, tokens via the service", async () => {
  const s = loadSettings()
  const runs = []
  const kicks = []
  const route = loadAdminRoute(s, runs, kicks)
  const service = fakeService()
  const knex = { async raw() { return { rows: [{ published: false }] } } }
  const scope = containerFor(service, { [PG]: knex })

  const get = fakeRes()
  await route.GET({ scope }, get)
  assert.equal(get.headers["cache-control"], "private, no-store")
  assert.deepEqual(Object.keys(get.body).sort(), ["email_configured", "privacy_published", "settings", "suggested_consent_text"])
  assert.equal(get.body.email_configured, false)
  assert.equal(get.body.privacy_published, false)
  assert.equal(get.body.suggested_consent_text, s.SUGGESTED_CONSENT_TEXT)
  assert.deepEqual(get.body.settings.config, SPEC_DEFAULTS)
  assert.equal(kicks.length, 1)

  const bad = fakeRes()
  await route.POST({ scope, body: { meta: { test_id: "nope" }, meta_test_token: "EAAsecret" } }, bad)
  assert.equal(bad.statusCode, 400)
  assert.ok(Array.isArray(bad.body.errors) && bad.body.errors.length)
  assert.equal(JSON.stringify(bad.body).includes("EAAsecret"), false)
  assert.equal(service.row, null, "nothing written on a rejected patch")

  const shareBlocked = fakeRes()
  await route.POST({ scope, body: { privacy: { share_contact_hashes: true, consent_text: "We measure ads." } } }, shareBlocked)
  assert.equal(shareBlocked.statusCode, 400, "privacy page unpublished")

  const tokensOnly = fakeRes()
  await route.POST({ scope, body: { meta_test_token: "EAAsecret1234" } }, tokensOnly)
  assert.equal(tokensOnly.statusCode, 200)
  assert.equal(runs.length, 0, "a token-only save does not run the config workflow")
  assert.equal(service.row.meta_test_token, "EAAsecret1234")
  assert.equal(tokensOnly.body.settings.meta_test_token_set, true)
  assert.equal(tokensOnly.body.settings.meta_test_token_masked, "••••••••1234")
  assert.equal(JSON.stringify(tokensOnly.body).includes("EAAsecret1234"), false)

  const both = fakeRes()
  await route.POST({ scope, body: { meta: { enabled: true }, meta_test_token: "", meta_live_token: "__remove__" } }, both)
  assert.equal(both.statusCode, 200)
  assert.equal(runs.length, 1)
  assert.equal(JSON.stringify(runs[0]).includes("token"), false, "the workflow input carries no token")
  assert.equal(service.row.meta_test_token, "EAAsecret1234", "blank keeps")
  assert.equal(service.row.meta_live_token, null)
  assert.equal(both.body.settings.config.meta.enabled, true)
  const source = fs.readFileSync(path.join(__dirname, "../src/api/admin/tracking/settings/route.ts"), "utf8")
  assert.equal(/console\.|logger/.test(source), false, "the route never logs bodies")
})

test("store tracking-config route: public config with a 60 s cache, no-store on errors", async () => {
  const s = loadSettings()
  const route = load("api/store/tracking-config/route.ts", { "../../../lib/tracking/settings": s })
  const service = fakeService({ id: "trackset_default", config: { meta: { enabled: true } }, meta_test_token: "EAAsecret",
    meta_live_token: null, tiktok_test_token: null, tiktok_live_token: null, catalog_feed_token: "feedsecret" })
  const res = fakeRes()
  await route.GET({ scope: containerFor(service) }, res)
  assert.equal(res.headers["cache-control"], "public, max-age=60")
  assert.equal(res.body.config.meta.enabled, true)
  const json = JSON.stringify(res.body)
  for (const word of ["EAAsecret", "feedsecret", "token", "email", "catalog"]) assert.equal(json.includes(word), false, word)
  s.invalidateTrackingSettings()
  const failed = fakeRes()
  await route.GET({ scope: { resolve: () => ({ async listTrackingSettings() { throw new Error("down") } }) } }, failed)
  assert.equal(failed.statusCode, 503)
  assert.equal(failed.headers["cache-control"], "no-store")
})

test("the admin page keeps tokens write-only and links its sub-pages", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/admin/routes/tracking/page.tsx"), "utf8")
  for (const needle of ["autoComplete=\"one-time-code\"", "data-1p-ignore", "WebkitTextSecurity: \"disc\"",
    "Paste a new token to replace it", "__remove__", "/admin/tracking/test-alert", "to=\"/tracking/health\"",
    "to=\"/tracking/catalog\"", "to=\"/live\"", "to=\"/privacy\"", "Use suggested wording",
    "defineRouteConfig({ label: \"Tracking\"", "credentials: \"include\"",
    "Turn it OFF in Events Manager before ticking; the browser pixel stays off for that dataset until you do"]) {
    assert.ok(source.includes(needle), needle)
  }
  assert.equal(/_token\b[^_]*\bvalue=\{settings/.test(source), false)
  const icon = source.match(/import \{ (\w+) \} from "@medusajs\/icons"/)[1]
  assert.ok(require("@medusajs/icons")[icon], `${icon} exists in @medusajs/icons`)
})
