// Meta CAPI and TikTok Events API payloads and sends (lib/tracking/adapters/*),
// with the match keys and event ids they use. Pure: fetch is a fake, no
// network, no settings, no database. See TRACKING.md 5.4, 6.2 and 14.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

const SRC = path.join(__dirname, "../src")

// AbortSignal.timeout calls made by the adapters (the fake fetch ignores the signal).
const timeouts = []
const FakeAbortSignal = { timeout: (ms) => (timeouts.push(ms), { timeoutMs: ms }) }

// Transpiles a TS file and runs it in a vm sandbox; relative imports load the
// real neighbouring files, node:crypto is the only bare import allowed.
function makeLoader() {
  const cache = new Map()
  function loadFile(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(
      code,
      {
        exports,
        URL,
        AbortSignal: FakeAbortSignal,
        require: (name) => {
          if (name === "node:crypto") return crypto
          if (name.startsWith(".")) return loadFile(path.resolve(path.dirname(filename), `${name}.ts`))
          throw new Error(`Unexpected import ${name}`)
        },
      },
      { filename }
    )
    return exports
  }
  return (file) => loadFile(path.join(SRC, file))
}

const load = makeLoader()
const common = load("lib/tracking/adapters/common.ts")
const meta = load("lib/tracking/adapters/meta.ts")
const tiktok = load("lib/tracking/adapters/tiktok.ts")
const matchKeys = load("lib/tracking/match-keys.ts")
const ids = load("lib/tracking/event-ids.ts")

// Objects built inside the vm have another realm's prototypes; compare their JSON.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex")

// Appendix C hashes.
const VID = "v1.1790467200.0123456789abcdef"
const EXT = "202f3b44f612b759b9abad5e5482e957203086352986edc2cb5ddae91847fdbd"
const BD = "5e657ff6158d3e2a6d23e2a523917a2305acee9423365e268695c4b7b8919f4c"
const PH_META = "c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1"
const PH_E164 = "650037f77977759c37e1a76c2e101bc1957b7f52f9567ecaa65a35586e05c08c"
const MD = "21262a3cb5337627b0fad9d891c16adb40706bd3e57534416dd02bbe5917d184"
const SHAMIM = "7d106eadf8eb2a503f5e46747f14ea252c024f8d23c162cfc3c77b498820452e"
const DHAKA = "de90643718108ec9a93cc6905f2b976297505a8abeac37b747132877fb32fb8d"
const COXSBAZAR = "43dea41fc4e7f595cead44b14c4bfb1033a9af49026171bfc5b03a66b290ad37"
const TEST_EMAIL = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b"
const JOHNSMITH_GMAIL = "3586de92bb3636d0885a12eff961429a32e4ebd764b96f50d85d016f9338d586"

const TOKEN = "EAAtestTOKENvalue1234567890abcdefSECRET"
const TIKTOK_TOKEN = "tt-secret-token-0123456789abcdef"
const DATASET = "2247389409441720"
const PIXEL = "D9ODDBJC77U97D5Q7MQG"

const T = new Date(1790467200000) // 2026-09-27T00:00:00Z
const T_S = 1790467200
const T2 = new Date(1790640000000) // two days later: the COD status change
const T2_S = 1790640000
const UUID = "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
const IC_ID = "ic-0123456789abcdef01234567"
const VAR1 = "variant_01K6EXAMPLEVARIANT01"
const VAR2 = "variant_01K6EXAMPLEVARIANT02"
const HOST = "https://new.florayn.com"

const USER = {
  ip: "103.4.145.2",
  ua: "Mozilla/5.0 (Linux; Android 14)",
  fbp: "fb.1.1790446417975.1267650289",
  fbc: "fb.1.1790446417975.IwAR2F4-dbP0l7Mn1IawQQ",
  externalId: EXT,
  country: "BD",
  ttclid: "E.C.P.abc123",
  ttp: "01K6TTPCOOKIEVALUE",
}
const ORDER = {
  email: "Test@Example.com",
  shipping_address: { first_name: "Md", last_name: "Shamim", phone: "01712345678", province: "Dhaka" },
  metadata: { district: "Dhaka", customer_phone: "01712345678" },
}
const PURCHASE_ITEMS = [
  { id: VAR1, quantity: 2, price: 1400 },
  { id: VAR2, quantity: 1, price: 1400 },
]
const keysOn = matchKeys.buildMatchKeys({ order: ORDER, visitorId: VID, share: true })
const keysOff = matchKeys.buildMatchKeys({ order: ORDER, visitorId: VID, share: false })

const INPUTS = {
  PageView: { name: "PageView", eventId: UUID, time: T, url: `${HOST}/`, actionSource: "website", user: USER, custom: {} },
  ViewContent: {
    name: "ViewContent",
    eventId: UUID,
    time: T,
    url: `${HOST}/product/zebra-stark/?case=signature`,
    actionSource: "website",
    user: USER,
    custom: { items: [{ id: VAR1, quantity: 1, price: 1400 }], value: 1400 },
  },
  AddToCart: {
    name: "AddToCart",
    eventId: UUID,
    time: T,
    url: `${HOST}/product/zebra-stark/`,
    actionSource: "website",
    user: USER,
    custom: { items: [{ id: VAR1, quantity: 2, price: 1400 }], value: 2800 },
  },
  InitiateCheckout: {
    name: "InitiateCheckout",
    eventId: IC_ID,
    time: T,
    url: `${HOST}/checkout/`,
    actionSource: "website",
    user: USER,
    custom: { items: PURCHASE_ITEMS, value: 4200, numItems: 3 },
  },
  Purchase: {
    name: "Purchase",
    eventId: "fl-1234",
    time: T,
    url: `${HOST}/checkout/`,
    actionSource: "website",
    user: { ...USER, meta: keysOn.metaCapi, tiktok: keysOn.tiktokApi },
    custom: { items: PURCHASE_ITEMS, value: 4320, orderId: "fl-1234" },
  },
}
for (const [name, eventId] of [["OrderConfirmed", "oc-fl-1234"], ["Delivered", "dl-fl-1234"], ["Returned", "rt-fl-1234"]]) {
  INPUTS[name] = {
    name,
    eventId,
    time: T2,
    url: `${HOST}/checkout/`,
    actionSource: "system_generated",
    user: { ...USER, meta: keysOff.metaCapi },
    custom: { items: PURCHASE_ITEMS, value: 4320, orderId: "fl-1234" },
    original: { eventName: "Purchase", time: T, orderId: "fl-1234", eventId: "fl-1234" },
  }
}

const WEB_USER_DATA = {
  client_ip_address: "103.4.145.2",
  client_user_agent: "Mozilla/5.0 (Linux; Android 14)",
  fbp: USER.fbp,
  fbc: USER.fbc,
  external_id: [EXT],
  country: [BD],
}
const PURCHASE_CONTENTS = [
  { id: VAR1, quantity: 2, item_price: 1400 },
  { id: VAR2, quantity: 1, item_price: 1400 },
]

const META_SNAPSHOTS = {
  PageView: {
    event_name: "PageView",
    event_time: T_S,
    event_id: UUID,
    action_source: "website",
    event_source_url: `${HOST}/`,
    user_data: WEB_USER_DATA,
    opt_out: false,
  },
  ViewContent: {
    event_name: "ViewContent",
    event_time: T_S,
    event_id: UUID,
    action_source: "website",
    event_source_url: `${HOST}/product/zebra-stark/?case=signature`,
    user_data: WEB_USER_DATA,
    custom_data: { content_type: "product", content_ids: [VAR1], contents: [{ id: VAR1, quantity: 1, item_price: 1400 }], value: 1400, currency: "BDT" },
    opt_out: false,
  },
  AddToCart: {
    event_name: "AddToCart",
    event_time: T_S,
    event_id: UUID,
    action_source: "website",
    event_source_url: `${HOST}/product/zebra-stark/`,
    user_data: WEB_USER_DATA,
    custom_data: { content_type: "product", content_ids: [VAR1], contents: [{ id: VAR1, quantity: 2, item_price: 1400 }], value: 2800, currency: "BDT" },
    opt_out: false,
  },
  InitiateCheckout: {
    event_name: "InitiateCheckout",
    event_time: T_S,
    event_id: IC_ID,
    action_source: "website",
    event_source_url: `${HOST}/checkout/`,
    user_data: WEB_USER_DATA,
    custom_data: { content_type: "product", content_ids: [VAR1, VAR2], contents: PURCHASE_CONTENTS, value: 4200, currency: "BDT", num_items: 3 },
    opt_out: false,
  },
  Purchase: {
    event_name: "Purchase",
    event_time: T_S,
    event_id: "fl-1234",
    action_source: "website",
    event_source_url: `${HOST}/checkout/`,
    user_data: {
      ...WEB_USER_DATA,
      em: [TEST_EMAIL],
      ph: [PH_META],
      fn: [MD],
      ln: [SHAMIM],
      ct: [DHAKA],
    },
    custom_data: {
      content_type: "product",
      content_ids: [VAR1, VAR2],
      contents: PURCHASE_CONTENTS,
      value: 4320,
      currency: "BDT",
      num_items: 3,
      order_id: "fl-1234",
      delivery_category: "home_delivery",
    },
    opt_out: false,
  },
}
for (const [name, eventId] of [["OrderConfirmed", "oc-fl-1234"], ["Delivered", "dl-fl-1234"], ["Returned", "rt-fl-1234"]]) {
  META_SNAPSHOTS[name] = {
    event_name: name,
    event_time: T2_S,
    event_id: eventId,
    action_source: "system_generated",
    user_data: { fbp: USER.fbp, fbc: USER.fbc, external_id: [EXT], country: [BD] },
    custom_data: { content_type: "product", content_ids: [VAR1, VAR2], value: 4320, currency: "BDT", order_id: "fl-1234" },
    original_event_data: { event_name: "Purchase", event_time: T_S, order_id: "fl-1234", event_id: "fl-1234" },
    opt_out: false,
  }
}

const TIKTOK_USER = {
  external_id: EXT,
  ttclid: USER.ttclid,
  ttp: USER.ttp,
  ip: "103.4.145.2",
  user_agent: USER.ua,
}
const TIKTOK_SNAPSHOTS = {
  PageView: null,
  ViewContent: {
    event: "ViewContent",
    event_time: T_S,
    event_id: UUID,
    user: TIKTOK_USER,
    properties: { currency: "BDT", value: 1400, content_type: "product", contents: [{ content_id: VAR1, quantity: 1, price: 1400 }] },
    page: { url: `${HOST}/product/zebra-stark/?case=signature` },
  },
  AddToCart: {
    event: "AddToCart",
    event_time: T_S,
    event_id: UUID,
    user: TIKTOK_USER,
    properties: { currency: "BDT", value: 2800, content_type: "product", contents: [{ content_id: VAR1, quantity: 2, price: 1400 }] },
    page: { url: `${HOST}/product/zebra-stark/` },
  },
  InitiateCheckout: {
    event: "InitiateCheckout",
    event_time: T_S,
    event_id: IC_ID,
    user: TIKTOK_USER,
    properties: {
      currency: "BDT",
      value: 4200,
      content_type: "product",
      contents: [
        { content_id: VAR1, quantity: 2, price: 1400 },
        { content_id: VAR2, quantity: 1, price: 1400 },
      ],
      num_items: 3,
    },
    page: { url: `${HOST}/checkout/` },
  },
  Purchase: {
    event: "Purchase",
    event_time: T_S,
    event_id: "fl-1234",
    user: { ...TIKTOK_USER, phone: PH_E164, email: TEST_EMAIL },
    properties: {
      currency: "BDT",
      value: 4320,
      content_type: "product",
      contents: [
        { content_id: VAR1, quantity: 2, price: 1400 },
        { content_id: VAR2, quantity: 1, price: 1400 },
      ],
      num_items: 3,
      order_id: "fl-1234",
    },
    page: { url: `${HOST}/checkout/` },
  },
  OrderConfirmed: null,
  Delivered: null,
  Returned: null,
}

// A fake fetch that records calls and answers with a fixed status and body (or throws).
function fakeFetch(respond) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined })
    const out = typeof respond === "function" ? respond(calls.length) : respond
    if (out instanceof Error) throw out
    const text = typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? {})
    return { ok: out.status >= 200 && out.status < 300, status: out.status, text: async () => text }
  }
  fn.calls = calls
  return fn
}

// Every result message and thrown error seen below; none may contain a token.
const seenMessages = []
function remember(results) {
  for (const r of results) seenMessages.push(r.message)
  return plain(results)
}

const metaCfg = (over = {}) => ({ destination: DATASET, token: TOKEN, env: "test", apiVersion: "v26.0", testEventCode: "TEST12345", ...over })
const tiktokCfg = (over = {}) => ({ destination: PIXEL, token: TIKTOK_TOKEN, env: "live", ...over })
const oneMeta = () => [meta.buildMetaEvent(INPUTS.ViewContent)]
const oneTikTok = () => [tiktok.buildTikTokEvent(INPUTS.ViewContent)]

// ---------------------------------------------------------------- event ids

test("event ids: Purchase fl-N and the COD ids oc/dl/rt-fl-N from the display id", () => {
  assert.equal(ids.purchaseEventId(1234), "fl-1234")
  assert.equal(ids.purchaseEventId("1234"), "fl-1234")
  assert.equal(ids.statusEventId("OrderConfirmed", 1234), "oc-fl-1234")
  assert.equal(ids.statusEventId("Delivered", "1234"), "dl-fl-1234")
  assert.equal(ids.statusEventId("Returned", 1234), "rt-fl-1234")
  for (const bad of [0, -1, 1.5, NaN, "", "abc", "12a", "order_01ABC", null, undefined]) {
    assert.equal(ids.purchaseEventId(bad), null, String(bad))
    assert.equal(ids.statusEventId("Delivered", bad), null, String(bad))
  }
  assert.equal(ids.statusEventId("Cancelled", 1234), null)
  assert.equal(ids.isPurchaseEventId("fl-1234"), true)
  assert.equal(ids.isPurchaseEventId("order_01ABC"), false)
  assert.equal(ids.isPurchaseEventId("fl-0"), false)
  assert.equal(ids.isStatusEventId("Delivered", "dl-fl-1234"), true)
  assert.equal(ids.isStatusEventId("Delivered", "oc-fl-1234"), false)
  assert.equal(ids.isStatusEventId("Returned", "rt-fl-"), false)
  assert.equal(ids.isStatusEventId("Cancelled", "cn-fl-1"), false)
})

test("event ids: isBrowserEventId matches the Appendix C event_ids vectors", () => {
  const vectors = [
    ["PageView", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["ViewContent", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["AddToCart", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["InitiateCheckout", "ic-0123456789abcdef01234567", true],
    ["InitiateCheckout", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", false],
    ["ViewContent", "ic-0123456789abcdef01234567", false],
    ["PageView", "3F9C2A1E-5B7D-4C8E-9A0B-1C2D3E4F5A6B", false],
    ["PageView", "3f9c2a1e-5b7d-1c8e-9a0b-1c2d3e4f5a6b", false],
    ["Purchase", "fl-1234", false],
    ["InitiateCheckout", "ic-0123456789abcdef0123456", false],
  ]
  for (const [name, id, expected] of vectors) assert.equal(ids.isBrowserEventId(name, id), expected, `${name} ${id}`)
  assert.equal(ids.isBrowserEventId("PageView", null), false)
})

// --------------------------------------------------------------- match keys

test("match keys with share ON: every platform's shape (4.4)", () => {
  assert.deepEqual(plain(keysOn), {
    metaCapi: { ph: [PH_META], fn: [MD], ln: [SHAMIM], ct: [DHAKA], country: [BD], external_id: [EXT], em: [TEST_EMAIL] },
    metaPixel: { ph: PH_META, fn: MD, ln: SHAMIM, ct: DHAKA, country: BD, external_id: EXT, em: TEST_EMAIL },
    tiktokApi: { external_id: EXT, phone: PH_E164, email: TEST_EMAIL },
    tiktokPixel: { external_id: EXT, phone_number: PH_E164, email: TEST_EMAIL },
    google: {
      sha256_phone_number: PH_E164,
      sha256_email_address: TEST_EMAIL,
      address: { sha256_first_name: MD, sha256_last_name: SHAMIM, country: "BD" },
    },
  })
})

test("match keys with share OFF: only external_id (plus Meta CAPI's country), no Google block", () => {
  assert.deepEqual(plain(keysOff), {
    metaCapi: { country: [BD], external_id: [EXT] },
    metaPixel: { external_id: EXT },
    tiktokApi: { external_id: EXT },
    tiktokPixel: { external_id: EXT },
  })
  assert.equal("google" in keysOff, false)
  // Anything but a real true is OFF.
  const truthy = matchKeys.buildMatchKeys({ order: ORDER, visitorId: VID, share: "yes" })
  assert.deepEqual(plain(truthy), plain(keysOff))
  const json = JSON.stringify(keysOff)
  for (const pii of [PH_META, PH_E164, MD, SHAMIM, DHAKA, TEST_EMAIL]) assert.equal(json.includes(pii), false)
})

test("match keys: phone and city fall back to metadata; placeholder email and bad phone are left out", () => {
  const keys = matchKeys.buildMatchKeys({
    order: {
      email: "01712345678@no-email.florayn.local",
      shipping_address: null,
      metadata: { customer_phone: "+880 1712-345678", district: "Cox's Bazar" },
    },
    visitorId: VID,
    share: true,
  })
  assert.deepEqual(plain(keys.metaCapi), { ph: [PH_META], ct: [COXSBAZAR], country: [BD], external_id: [EXT] })
  assert.deepEqual(plain(keys.tiktokApi), { external_id: EXT, phone: PH_E164 })
  assert.deepEqual(plain(keys.google), { sha256_phone_number: PH_E164 })

  const noPhone = matchKeys.buildMatchKeys({ order: { shipping_address: { phone: "12345", first_name: "Md" } }, visitorId: null, share: true })
  assert.deepEqual(plain(noPhone.metaCapi), { fn: [MD], country: [BD] })
  assert.deepEqual(plain(noPhone.metaPixel), { fn: MD, country: BD })
  assert.deepEqual(plain(noPhone.tiktokApi), {})
  assert.deepEqual(plain(noPhone.google), { address: { sha256_first_name: MD, country: "BD" } })

  const nothing = matchKeys.buildMatchKeys({ order: null, visitorId: null, share: true })
  assert.deepEqual(plain(nothing), { metaCapi: { country: [BD] }, metaPixel: { country: BD }, tiktokApi: {}, tiktokPixel: {} })
})

test("match keys: Google strips gmail dots; Meta and TikTok keep the address as typed", () => {
  const keys = matchKeys.buildMatchKeys({ order: { ...ORDER, email: "John.Smith@gmail.com" }, visitorId: VID, share: true })
  assert.equal(keys.google.sha256_email_address, JOHNSMITH_GMAIL)
  assert.deepEqual(plain(keys.metaCapi.em), [sha("john.smith@gmail.com")])
  assert.equal(keys.tiktokApi.email, sha("john.smith@gmail.com"))
})

// ---------------------------------------------------------- payload snapshots

test("Meta payload snapshots for every server event", () => {
  for (const [name, expected] of Object.entries(META_SNAPSHOTS)) {
    assert.deepEqual(plain(meta.buildMetaEvent(INPUTS[name])), expected, name)
  }
})

test("TikTok payload snapshots; PageView and the COD events are never built", () => {
  for (const [name, expected] of Object.entries(TIKTOK_SNAPSHOTS)) {
    const built = tiktok.buildTikTokEvent(INPUTS[name])
    if (expected === null) assert.equal(built, null, name)
    else assert.deepEqual(plain(built), expected, name)
  }
})

test("no payload anywhere contains /order/, and Purchase always reports https://<host>/checkout/", () => {
  const all = Object.values(INPUTS).flatMap((input) => [meta.buildMetaEvent(input), tiktok.buildTikTokEvent(input)])
  assert.equal(/\/order\//i.test(JSON.stringify(all)), false)

  const fromOrderPage = { ...INPUTS.Purchase, url: `${HOST}/order/order_01ABCDEFGHIJ/confirmed/?x=1` }
  assert.equal(meta.buildMetaEvent(fromOrderPage).event_source_url, `${HOST}/checkout/`)
  assert.deepEqual(plain(tiktok.buildTikTokEvent(fromOrderPage).page), { url: `${HOST}/checkout/` })

  for (const privatePath of ["/order/order_01ABC/", "/men/order/x/", "/account/", "/men/account/orders/", "/review/abc123/", "/%6Frder/x/", "/shop/?next=/order/x/"]) {
    const pv = meta.buildMetaEvent({ ...INPUTS.PageView, url: `${HOST}${privatePath}` })
    assert.equal("event_source_url" in pv, false, privatePath)
    const vc = tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, url: `${HOST}${privatePath}` })
    assert.equal("page" in vc, false, privatePath)
  }
  for (const bad of ["javascript:alert(1)", "https://user:pw@new.florayn.com/", "/relative/", "not a url"]) {
    assert.equal("event_source_url" in meta.buildMetaEvent({ ...INPUTS.PageView, url: bad }), false, bad)
  }
  // The fragment is dropped; the public path and query are kept.
  assert.equal(meta.buildMetaEvent({ ...INPUTS.PageView, url: `${HOST}/shop/?case=signature#top` }).event_source_url, `${HOST}/shop/?case=signature`)
})

test("COD events are system_generated with original_event_data, no event_source_url and no browser ip/ua", () => {
  for (const name of ["OrderConfirmed", "Delivered", "Returned"]) {
    const event = meta.buildMetaEvent(INPUTS[name])
    assert.equal(event.action_source, "system_generated")
    assert.equal("event_source_url" in event, false)
    assert.equal("client_ip_address" in event.user_data, false)
    assert.equal("client_user_agent" in event.user_data, false)
    assert.deepEqual(plain(event.original_event_data), { event_name: "Purchase", event_time: T_S, order_id: "fl-1234", event_id: "fl-1234" })
  }
  // With share ON the COD events carry the contact hashes too.
  const shared = meta.buildMetaEvent({ ...INPUTS.Delivered, user: { ...USER, meta: keysOn.metaCapi } })
  assert.deepEqual(plain(shared.user_data.ph), [PH_META])
})

test("an action source that does not match the event, an unknown name, a bad id or time build nothing", () => {
  assert.equal(meta.buildMetaEvent({ ...INPUTS.Delivered, actionSource: "website" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, actionSource: "system_generated" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, name: "Cancelled" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, eventId: "has space" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, eventId: "" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, time: new Date("nope") }), null)
  assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, time: null }), null)
  assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.Purchase, actionSource: "system_generated" }), null)
})

test("server event ids: Purchase must be fl-N, a COD event its own prefix, and no raw Medusa id is ever an event id", () => {
  for (const bad of ["order_01ABCDEFGHIJ", "1234", "fl-abc", "oc-fl-1234"]) {
    assert.equal(meta.buildMetaEvent({ ...INPUTS.Purchase, eventId: bad }), null, bad)
    assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.Purchase, eventId: bad }), null, bad)
  }
  assert.equal(meta.buildMetaEvent({ ...INPUTS.Delivered, eventId: "oc-fl-1234" }), null)
  assert.equal(meta.buildMetaEvent({ ...INPUTS.OrderConfirmed, eventId: "fl-1234" }), null)
  for (const bad of ["order_01ABCDEFGHIJ", "cart_01TESTCART0001", "ic-cart_01TESTCART0001"]) {
    assert.equal(meta.buildMetaEvent({ ...INPUTS.ViewContent, eventId: bad }), null, bad)
    assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.InitiateCheckout, eventId: bad }), null, bad)
  }
  // Any other short id is accepted (e.g. an admin test event).
  assert.equal(meta.buildMetaEvent({ ...INPUTS.PageView, eventId: "test-1790467200" }).event_id, "test-1790467200")
})

test("a raw order id is never sent: order_id and original_event_data need fl-N", () => {
  const purchase = meta.buildMetaEvent({ ...INPUTS.Purchase, custom: { ...INPUTS.Purchase.custom, orderId: "order_01ABCDEFGHIJ" } })
  assert.equal("order_id" in purchase.custom_data, false)
  const tt = tiktok.buildTikTokEvent({ ...INPUTS.Purchase, custom: { ...INPUTS.Purchase.custom, orderId: "order_01ABCDEFGHIJ" } })
  assert.equal("order_id" in tt.properties, false)
  const cod = meta.buildMetaEvent({ ...INPUTS.Delivered, original: { ...INPUTS.Delivered.original, orderId: "order_01ABCDEFGHIJ" } })
  assert.equal("original_event_data" in cod, false)
  assert.equal(JSON.stringify([purchase, tt, cod]).includes("order_01"), false)
})

test("Parameter Builder suffixed hashes are dropped; the TikTok ip suffix is stripped", () => {
  const suffixed = `${EXT}.AQQCAQMC`
  const input = {
    ...INPUTS.Purchase,
    user: {
      ...USER,
      ip: "103.4.145.2.AQQAAQMC",
      externalId: suffixed,
      meta: { ph: [`${PH_META}.AQQCAQMC`, PH_META.toUpperCase()], fn: [MD], em: `${TEST_EMAIL}.AQQCAQMC`, external_id: [suffixed], nope: [MD] },
      tiktok: { phone: `${PH_E164}.AQQCAQMC`, email: TEST_EMAIL, external_id: suffixed },
    },
  }
  const m = meta.buildMetaEvent(input)
  assert.equal("external_id" in m.user_data, false)
  assert.equal("ph" in m.user_data, false)
  assert.equal("em" in m.user_data, false)
  assert.equal("nope" in m.user_data, false)
  assert.deepEqual(plain(m.user_data.fn), [MD])
  // Meta takes ip raw (it accepts the builder's suffixed form).
  assert.equal(m.user_data.client_ip_address, "103.4.145.2.AQQAAQMC")
  assert.equal(JSON.stringify(m).includes(".AQQCAQMC"), false)

  const t = tiktok.buildTikTokEvent(input)
  assert.equal(t.user.ip, "103.4.145.2")
  assert.equal("external_id" in t.user, false)
  assert.equal("phone" in t.user, false)
  assert.equal(t.user.email, TEST_EMAIL)

  assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, user: { ...USER, ip: "2001:db8::1.AQQAAQMC" } }).user.ip, "2001:db8::1")
  assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, user: { ...USER, ip: "::ffff:1.2.3.4.AQQAAQMC" } }).user.ip, "::ffff:1.2.3.4")
  assert.equal("ip" in tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, user: { ...USER, ip: "not-an-ip" } }).user, false)
  assert.equal("client_ip_address" in meta.buildMetaEvent({ ...INPUTS.ViewContent, user: { ...USER, ip: "999.1.1.1" } }).user_data, false)
})

test("ip helpers: plain IPv4/IPv6 only", () => {
  for (const ok of ["103.4.145.2", "0.0.0.0", "2001:db8::1", "::1", "::", "fe80::1:2:3:4", "2001:0db8:0000:0000:0000:ff00:0042:8329", "::ffff:192.0.2.1"]) {
    assert.equal(common.isIp(ok), true, ok)
  }
  for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "gggg::1", "abcd", ""]) {
    assert.equal(common.isIp(bad), false, bad)
  }
  assert.equal(common.plainIp("103.4.145.2.12345678"), "103.4.145.2")
  assert.equal(common.plainIp(null), null)
})

test("ttclid is sent whole up to 1000 characters and never truncated", () => {
  const long = `E.C.P.${"a".repeat(994)}`
  assert.equal(long.length, 1000)
  assert.equal(tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, user: { ...USER, ttclid: long } }).user.ttclid, long)
  const tooLong = `${long}b`
  assert.equal("ttclid" in tiktok.buildTikTokEvent({ ...INPUTS.ViewContent, user: { ...USER, ttclid: tooLong } }).user, false)
})

test("bad items are dropped; num_items falls back to the item quantities; Meta country only for BD", () => {
  const event = meta.buildMetaEvent({
    ...INPUTS.InitiateCheckout,
    user: { ...USER, country: "IN" },
    custom: { items: [...PURCHASE_ITEMS, { id: "", quantity: 1, price: 1 }, { id: VAR1, quantity: 0, price: 1 }, { id: VAR1, quantity: 1, price: -5 }, null], value: -1 },
  })
  assert.deepEqual(plain(event.custom_data), { content_type: "product", content_ids: [VAR1, VAR2], contents: PURCHASE_CONTENTS, currency: "BDT", num_items: 3 })
  assert.equal("country" in event.user_data, false)
  const pv = meta.buildMetaEvent({ ...INPUTS.PageView, user: { ...USER, country: "bd" } })
  assert.deepEqual(plain(pv.user_data.country), [BD])
})

// -------------------------------------------------------------- Meta sending

test("sendMetaBatch posts to the dataset with the token in the body, test_event_code only for test", async () => {
  timeouts.length = 0
  const fetchImpl = fakeFetch({ status: 200, body: { events_received: 1, messages: [], fbtrace_id: "AbCtrace1" } })
  const events = oneMeta()
  const results = remember(await meta.sendMetaBatch(fetchImpl, metaCfg(), events))
  assert.deepEqual(results, [{ index: 0, cls: "ok", message: "ok, 1 received", traceId: "AbCtrace1" }])
  assert.equal(fetchImpl.calls.length, 1)
  const call = fetchImpl.calls[0]
  assert.equal(call.url, `https://graph.facebook.com/v26.0/${DATASET}/events`)
  assert.equal(call.url.includes(TOKEN), false)
  assert.equal(call.init.method, "POST")
  assert.equal(call.init.headers["Content-Type"], "application/json")
  assert.deepEqual(call.body, { data: plain(events), access_token: TOKEN, test_event_code: "TEST12345" })
  assert.deepEqual(timeouts, [8000])

  const live = fakeFetch({ status: 200, body: { events_received: 1 } })
  await meta.sendMetaBatch(live, metaCfg({ env: "live" }), events)
  assert.equal("test_event_code" in live.calls[0].body, false)

  const noCode = fakeFetch({ status: 200, body: { events_received: 1 } })
  await meta.sendMetaBatch(noCode, metaCfg({ testEventCode: "" }), events)
  assert.equal("test_event_code" in noCode.calls[0].body, false)

  const version = fakeFetch({ status: 200, body: {} })
  await meta.sendMetaBatch(version, metaCfg({ apiVersion: "v25.0" }), events)
  await meta.sendMetaBatch(version, metaCfg({ apiVersion: "latest/../x" }), events)
  assert.deepEqual(version.calls.map((c) => c.url.split("/")[3]), ["v25.0", "v26.0"])
})

test("sendMetaBatch: more than 500 events throws without the token; no token or dataset means blocked with no request", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: {} })
  const many = Array.from({ length: 501 }, () => oneMeta()[0])
  await assert.rejects(meta.sendMetaBatch(fetchImpl, metaCfg(), many), (error) => {
    seenMessages.push(error.message, String(error.stack))
    assert.equal(error.name, "TrackingAdapterError")
    assert.match(error.message, /500/)
    return true
  })
  assert.equal(fetchImpl.calls.length, 0)
  const ok = remember(await meta.sendMetaBatch(fakeFetch({ status: 200, body: {} }), metaCfg(), many.slice(0, 500)))
  assert.equal(ok.length, 500)

  assert.deepEqual(remember(await meta.sendMetaBatch(fetchImpl, metaCfg({ token: "" }), oneMeta())), [{ index: 0, cls: "blocked", message: "no token" }])
  assert.deepEqual(remember(await meta.sendMetaBatch(fetchImpl, metaCfg({ destination: "" }), oneMeta())), [{ index: 0, cls: "blocked", message: "no valid dataset id" }])
  assert.deepEqual(plain(await meta.sendMetaBatch(fetchImpl, metaCfg(), [])), [])
  assert.equal(fetchImpl.calls.length, 0)
})

test("classifyMeta, row by row (TRACKING.md 6.2)", () => {
  const rows = [
    [{ network: true }, "transient"],
    [{ status: 200 }, "ok"],
    [{ status: 500 }, "transient"],
    [{ status: 503, error: { code: 2, type: "OAuthException", message: "Service temporarily unavailable" } }, "transient"],
    [{ status: 400, error: { code: 1, message: "An unknown error occurred" } }, "transient"],
    [{ status: 400, error: { code: 4, message: "Application request limit reached" } }, "transient"],
    [{ status: 400, error: { code: 17, message: "User request limit reached" } }, "transient"],
    [{ status: 400, error: { code: 341, message: "Application limit reached" } }, "transient"],
    [{ status: 400, error: { code: 368, message: "Temporarily blocked" } }, "transient"],
    [{ status: 400, error: { code: 190, type: "OAuthException", message: "Error validating access token" } }, "blocked"],
    [{ status: 400, error: { code: 102, message: "Session key invalid" } }, "blocked"],
    [{ status: 403, error: { code: 10, message: "Permission denied" } }, "blocked"],
    [{ status: 403, error: { code: 200, message: "Permissions error" } }, "blocked"],
    [{ status: 403, error: { code: 299, message: "Permissions error" } }, "blocked"],
    [{ status: 400, error: { code: 999, type: "OAuthException", message: "Something about the token" } }, "blocked"],
    [{ status: 400, error: { code: 100, type: "OAuthException", message: "Invalid parameter" } }, "payload"],
    [
      {
        status: 400,
        error: {
          code: 100,
          error_subcode: 2804003,
          type: "OAuthException",
          message: "Invalid parameter",
          error_user_title: "Event Timestamp Too Old",
          error_user_msg: "The timestamp for this event is too far in the past. Events need to be sent from your server within 7 days of when they occurred.",
        },
      },
      "expired",
    ],
    [{ status: 429 }, "transient"],
    [{ status: 400, error: { code: 12345, message: "Unknown", is_transient: true } }, "transient"],
  ]
  for (const [response, expected] of rows) assert.equal(meta.classifyMeta(response), expected, JSON.stringify(response))
})

test("sendMetaBatch maps vendor errors to every row and never returns the token", async () => {
  const cases = [
    [{ status: 400, body: { error: { code: 190, type: "OAuthException", message: `Malformed access token ${TOKEN}`, fbtrace_id: "Tr1" } } }, "blocked"],
    [{ status: 400, body: { error: { code: 100, type: "OAuthException", message: "Invalid parameter", error_user_msg: `bad value near access_token=${TOKEN}` } } }, "payload"],
    [{ status: 500, body: "<html>Internal error</html>" }, "transient"],
    [{ status: 400, body: { error: { code: 17, message: "User request limit reached" } } }, "transient"],
    [new Error(`connect ECONNREFUSED while sending ${TOKEN}`), "transient"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "transient"],
  ]
  for (const [response, expected] of cases) {
    const events = [oneMeta()[0], oneMeta()[0]]
    const results = remember(await meta.sendMetaBatch(fakeFetch(response), metaCfg(), events))
    assert.equal(results.length, 2)
    for (const [i, r] of results.entries()) {
      assert.equal(r.index, i)
      assert.equal(r.cls, expected, JSON.stringify(response.body ?? response.message))
      assert.equal(r.message.includes(TOKEN), false)
      assert.ok(r.message.length <= 300)
    }
  }
  const timedOut = remember(await meta.sendMetaBatch(fakeFetch(Object.assign(new Error("x"), { name: "TimeoutError" })), metaCfg(), oneMeta()))
  assert.match(timedOut[0].message, /timeout/)
  const blocked = remember(await meta.sendMetaBatch(fakeFetch(cases[0][0]), metaCfg(), oneMeta()))
  assert.equal(blocked[0].traceId, "Tr1")
  assert.match(blocked[0].message, /code 190 OAuthException/)
})

test("sendMetaBatch: the 7-day error expires only the old rows; the rest go back as payload", async () => {
  const now = 1790467200000
  const oldEvent = meta.buildMetaEvent({ ...INPUTS.ViewContent, time: new Date(now - 8 * 86400000) })
  const fresh = meta.buildMetaEvent({ ...INPUTS.ViewContent, time: new Date(now - 60000) })
  const expired = {
    status: 400,
    body: { error: { code: 100, type: "OAuthException", message: "Invalid parameter", error_user_title: "Event Timestamp Too Old", error_user_msg: "Events need to be sent within 7 days." } },
  }
  const results = remember(await meta.sendMetaBatch(fakeFetch(expired), metaCfg(), [fresh, oldEvent], { now }))
  assert.deepEqual(results.map((r) => r.cls), ["payload", "expired"])
  const single = remember(await meta.sendMetaBatch(fakeFetch(expired), metaCfg(), [fresh], { now }))
  assert.deepEqual(single.map((r) => r.cls), ["expired"])
})

// ------------------------------------------------------------ TikTok sending

test("sendTikTokBatch posts with the Access-Token header only", async () => {
  timeouts.length = 0
  const fetchImpl = fakeFetch({ status: 200, body: { code: 0, message: "OK", request_id: "req-1", data: {} } })
  const events = oneTikTok()
  const results = remember(await tiktok.sendTikTokBatch(fetchImpl, tiktokCfg(), events))
  assert.deepEqual(results, [{ index: 0, cls: "ok", message: "ok", traceId: "req-1" }])
  const call = fetchImpl.calls[0]
  assert.equal(call.url, "https://business-api.tiktok.com/open_api/v1.3/event/track/")
  assert.equal(call.init.method, "POST")
  assert.equal(call.init.headers["Access-Token"], TIKTOK_TOKEN)
  assert.equal(call.init.headers["Content-Type"], "application/json")
  assert.deepEqual(call.body, { event_source: "web", event_source_id: PIXEL, data: plain(events) })
  assert.equal(call.init.body.includes(TIKTOK_TOKEN), false)
  assert.equal(call.url.includes(TIKTOK_TOKEN), false)
  assert.deepEqual(timeouts, [8000])

  // A test pixel gets no test code: TikTok v1.3 documents none for /event/track/.
  const testEnv = fakeFetch({ status: 200, body: { code: 0 } })
  await tiktok.sendTikTokBatch(testEnv, tiktokCfg({ env: "test", testEventCode: "TEST12345" }), events)
  assert.deepEqual(Object.keys(testEnv.calls[0].body).sort(), ["data", "event_source", "event_source_id"])
})

test("sendTikTokBatch: more than 500 throws without the token; no token or pixel means blocked with no request", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { code: 0 } })
  const many = Array.from({ length: 501 }, () => oneTikTok()[0])
  await assert.rejects(tiktok.sendTikTokBatch(fetchImpl, tiktokCfg(), many), (error) => {
    seenMessages.push(error.message, String(error.stack))
    assert.equal(error.name, "TrackingAdapterError")
    return true
  })
  assert.deepEqual(remember(await tiktok.sendTikTokBatch(fetchImpl, tiktokCfg({ token: " " }), oneTikTok())), [{ index: 0, cls: "blocked", message: "no token" }])
  assert.deepEqual(remember(await tiktok.sendTikTokBatch(fetchImpl, tiktokCfg({ destination: "bad" }), oneTikTok())), [{ index: 0, cls: "blocked", message: "no valid pixel code" }])
  assert.equal(fetchImpl.calls.length, 0)
})

test("classifyTikTok, row by row (TRACKING.md 6.2)", () => {
  const rows = [
    [{ network: true }, "transient", null],
    [{ status: 200, code: 0 }, "ok", null],
    [{ status: 401, code: 40100, message: "Too many requests" }, "transient", null],
    [{ status: 200, code: 40100 }, "transient", null],
    [{ status: 200, code: 40001, message: "No permission" }, "blocked", null],
    [{ status: 401, code: 40001 }, "blocked", null],
    [{ status: 200, code: 40104, message: "Access token is empty" }, "blocked", null],
    [{ status: 401, code: 40105, message: "Access token is invalid" }, "blocked", null],
    [{ status: 401 }, "blocked", null],
    [{ status: 200, code: 40002, message: "Invalid value for data[2].event_time" }, "payload", 2],
    [{ status: 400, code: 40002, message: "data.0.user.email must be hashed" }, "payload", 0],
    [{ status: 200, code: 40002, message: "The event at index 3 is invalid" }, "payload", 3],
    [{ status: 200, code: 40002, message: "Invalid payload" }, "payload", null],
    [{ status: 200, code: 40002, message: "data[9] is invalid" }, "payload", null],
    [{ status: 500 }, "transient", null],
    [{ status: 502, code: 0 }, "transient", null],
    [{ status: 200, code: 51000, message: "Unknown" }, "transient", null],
  ]
  for (const [response, cls, index] of rows) {
    assert.deepEqual(plain(tiktok.classifyTikTok(response, 5)), { cls, index }, JSON.stringify(response))
  }
})

test("sendTikTokBatch: 40002 marks only the named row as payload; 401 + 40100 retries; tokens never returned", async () => {
  const events = [oneTikTok()[0], oneTikTok()[0], oneTikTok()[0]]
  const named = remember(
    await tiktok.sendTikTokBatch(fakeFetch({ status: 200, body: { code: 40002, message: "Invalid value for data[1].user.email", request_id: "req-2" } }), tiktokCfg(), events)
  )
  assert.deepEqual(named.map((r) => r.cls), ["transient", "payload", "transient"])
  assert.match(named[1].message, /40002/)
  assert.equal(named[1].traceId, "req-2")

  const unnamed = remember(await tiktok.sendTikTokBatch(fakeFetch({ status: 200, body: { code: 40002, message: "Invalid payload" } }), tiktokCfg(), events))
  assert.deepEqual(unnamed.map((r) => r.cls), ["payload", "payload", "payload"])

  const cases = [
    [{ status: 401, body: { code: 40100, message: "Rate limit exceeded" } }, "transient"],
    [{ status: 401, body: { code: 40105, message: `Access token ${TIKTOK_TOKEN} is invalid` } }, "blocked"],
    [{ status: 200, body: { code: 40001, message: "No permission to operate pixel" } }, "blocked"],
    [{ status: 200, body: { code: 40104, message: "Access-Token is empty" } }, "blocked"],
    [{ status: 504, body: "gateway timeout" }, "transient"],
    [new Error(`socket hang up with header Access-Token: ${TIKTOK_TOKEN}`), "transient"],
  ]
  for (const [response, expected] of cases) {
    const results = remember(await tiktok.sendTikTokBatch(fakeFetch(response), tiktokCfg(), events))
    assert.deepEqual(results.map((r) => r.cls), [expected, expected, expected], JSON.stringify(response.body ?? response.message))
    for (const r of results) assert.equal(r.message.includes(TIKTOK_TOKEN), false)
  }
})

// ----------------------------------------------------------------- hygiene

test("redact removes the token and Meta-shaped tokens, and caps the length", () => {
  assert.equal(common.redact(`bad ${TOKEN} here`, TOKEN), "bad [token] here")
  assert.equal(common.redact("token EAAB1234567890abcdefghijklmnop leaked", "other"), "token [token] leaked")
  assert.equal(common.redact("x".repeat(400), TOKEN).length, 300)
  assert.equal(common.redact("line one\nline two", TOKEN), "line one line two")
})

test("no thrown error or returned message ever contained a token", () => {
  assert.ok(seenMessages.length > 20)
  for (const message of seenMessages) {
    assert.equal(message.includes(TOKEN), false, message)
    assert.equal(message.includes(TIKTOK_TOKEN), false, message)
  }
})

test("owned files import only node:crypto, the contact helpers and each other", () => {
  const owned = [
    "lib/tracking/hash.ts",
    "lib/tracking/match-keys.ts",
    "lib/tracking/event-ids.ts",
    "lib/tracking/adapters/common.ts",
    "lib/tracking/adapters/meta.ts",
    "lib/tracking/adapters/tiktok.ts",
  ]
  const allowed = new Set([...owned, "lib/contact.ts"].map((file) => path.join(SRC, file)))
  let found = 0
  for (const file of owned) {
    const source = fs.readFileSync(path.join(SRC, file), "utf8")
    const specifiers = [...source.matchAll(/^import\s[^;]*?\sfrom\s+"([^"]+)"/gm)].map((m) => m[1])
    found += specifiers.length
    // No side-effect imports, re-exports, require() or dynamic import().
    assert.equal(/^import\s+["']|^export\s[^\n]*\sfrom\s|\brequire\(|\bimport\(/m.test(source), false, file)
    for (const specifier of specifiers) {
      if (specifier === "node:crypto") continue
      assert.ok(specifier.startsWith("."), `${file} imports ${specifier}`)
      const target = path.resolve(path.dirname(path.join(SRC, file)), `${specifier}.ts`)
      assert.ok(allowed.has(target), `${file} imports ${specifier}`)
    }
  }
  // hash: crypto + contact; match-keys: hash; common: event-ids + hash; meta: hash + common; tiktok: common.
  assert.equal(found, 8)
})
