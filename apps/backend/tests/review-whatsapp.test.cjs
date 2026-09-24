const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
const ENV = { JWT_SECRET: "fixture-secret", STOREFRONT_URL: "https://store.fixture", R2_PUBLIC_URL: "https://pub-fixture.r2.dev" }
const UTILS = { Modules: { STORE: "store", PROMOTION: "promotion", PRODUCT: "product" }, ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query" } }

/** Load a source file with its relative imports; `stubs` replaces modules by specifier, `globals` adds to the sandbox. */
function loader(stubs = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, Buffer, process: { env: ENV }, URLSearchParams, AbortController, setTimeout, clearTimeout, ...globals,
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
const STUBS = {
  "@medusajs/framework/utils": UTILS,
  "@medusajs/medusa/core-flows": { updateStoresWorkflow: () => ({ run: async () => ({}) }), createPromotionsWorkflow: () => ({ run: async () => ({}) }) },
  "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
  "../modules/content": { CONTENT_MODULE: "content" },
}
const base = loader(STUBS)

/** A stand-in for graph.facebook.com that records every call. */
function fakeGraph(respond = () => ({ status: 200, body: { messages: [{ id: "wamid.1" }] } })) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined })
    const { status, body } = respond(url, init)
    return { ok: status < 400, status, json: async () => body }
  }
  return { fetch, calls }
}

test("a phone-only order's placeholder email is never treated as an address, and BD mobiles are read in any form", () => {
  const { realEmail, bdMobile, localMobile, NO_EMAIL_DOMAIN } = base("lib/contact.ts")
  assert.equal(realEmail("01712345678@no-email.florayn.local"), null)
  assert.equal(realEmail(" Rafi@Example.com "), "rafi@example.com")
  assert.equal(realEmail(""), null)
  assert.equal(realEmail("nope"), null)
  for (const form of ["01712345678", "+880 1712-345678", "8801712345678", "008801712345678", "1712345678"]) {
    assert.equal(bdMobile(form), "8801712345678", form)
  }
  for (const junk of ["0212345678", "0171234567", "+44 7700 900123", "", null, "01212345678"]) assert.equal(bdMobile(junk), null, String(junk))
  assert.equal(localMobile("+8801712345678"), "01712345678")
  const checkout = fs.readFileSync(path.join(__dirname, "../src/workflows/checkout-service.ts"), "utf8")
  assert.ok(checkout.includes(`@${NO_EMAIL_DOMAIN}`), "checkout still writes the placeholder contact.ts recognises")
})

test("WhatsApp is used for phone-only orders, alongside email only when chosen, and never when not connected", () => {
  const { requestChannels } = base("lib/review-requests.ts")
  const phoneOnly = { email: null, phone: "8801712345678" }
  const both = { email: "a@b.co", phone: "8801712345678" }
  assert.deepEqual(plain(requestChannels(phoneOnly, "no_email", true)), { email: false, whatsapp: true })
  assert.deepEqual(plain(requestChannels(both, "no_email", true)), { email: true, whatsapp: false })
  assert.deepEqual(plain(requestChannels(both, "always", true)), { email: true, whatsapp: true })
  assert.deepEqual(plain(requestChannels(phoneOnly, "off", true)), { email: false, whatsapp: false })
  assert.deepEqual(plain(requestChannels(phoneOnly, "always", false)), { email: false, whatsapp: false })
  assert.deepEqual(plain(requestChannels({ email: null, phone: null }, "always", true)), { email: false, whatsapp: false })
})

test("a template message is sent to the Cloud API with clean values, and failures come back as words", async () => {
  const graph = fakeGraph()
  const { sendTemplate, templatePayload, presentWhatsApp } = loader(STUBS, { fetch: graph.fetch })("lib/whatsapp.ts")
  const s = { id: "wa", enabled: true, phone_number_id: "1234567890", business_account_id: "99999", access_token: "EAAsecret-token-value-1234", api_version: "v23.0" }
  const payload = plain(templatePayload({ to: "8801712345678", name: "florayn_review_request", language: "en", body: ["Ayesha\nKhan", "  ", "ok"], buttonUrl: "order_1.sig" }))
  assert.deepEqual(payload.template.components[0].parameters.map((p) => p.text), ["Ayesha Khan", "-", "ok"], "no new lines or empty values")
  assert.deepEqual(payload.template.components[1], { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "order_1.sig" }] })

  const sent = await sendTemplate(s, { to: "8801712345678", name: "florayn_review_request", language: "en", body: ["A"] })
  assert.deepEqual(plain(sent), { ok: true, id: "wamid.1" })
  assert.equal(graph.calls[0].url, "https://graph.facebook.com/v23.0/1234567890/messages")
  assert.equal(graph.calls[0].auth, "Bearer EAAsecret-token-value-1234")
  assert.equal(graph.calls[0].body.to, "8801712345678")

  assert.deepEqual(plain(await sendTemplate({ ...s, enabled: false }, { to: "x", name: "n", language: "en" })), { ok: false, error: "WhatsApp is not connected." })
  const failing = fakeGraph(() => ({ status: 400, body: { error: { message: "Template name does not exist in the translation", code: 132001 } } }))
  const failed = await loader(STUBS, { fetch: failing.fetch })("lib/whatsapp.ts").sendTemplate(s, { to: "8801712345678", name: "missing", language: "en" })
  assert.deepEqual(plain(failed), { ok: false, error: "Template name does not exist in the translation" })

  const shown = presentWhatsApp(s)
  assert.equal(shown.access_token_masked, "••••••••1234")
  assert.ok(!JSON.stringify(shown).includes("EAAsecret"), "the token never leaves the server")
  assert.equal(shown.ready, true)
})

test("the review templates and hand-sent messages carry the order's words, and drop the offer while rewards are off", () => {
  const { productPhrase, offerSentence, manualRequestText, manualRewardText, templateDefinitions, requestTemplateMessage, expiryWords } = base("lib/review-whatsapp.ts")
  const { DEFAULT_REVIEW_PROGRAM: d } = base("lib/review-program.ts")
  assert.equal(productPhrase(["Moon Drift"]), "Moon Drift")
  assert.equal(productPhrase(["Moon Drift", "Grape Goo"]), "Moon Drift and Grape Goo")
  assert.equal(productPhrase(["A", "B", "C", "D"]), "A, B and 2 more")
  assert.match(offerSentence(d), /15% off your next order \(10% for a few words\)/)
  const off = { ...d, rewards: { ...d.rewards, enabled: false } }
  assert.equal(offerSentence(off), "It only takes a minute.")

  const invite = { orderId: "order_1", firstName: "Ayesha", products: [{ title: "Moon Drift" }] }
  const text = manualRequestText(d, invite, "https://store.fixture/review/order_1.sig")
  assert.match(text, /^Hi Ayesha! .*Moon Drift\?/)
  assert.match(text, /https:\/\/store\.fixture\/review\/order_1\.sig/)
  assert.match(text, /15% off/)
  assert.ok(!manualRequestText(off, invite, "L").includes("%"), "no promise of a discount while rewards are off")

  const issued = new Date("2026-09-24T10:00:00Z")
  assert.equal(expiryWords(issued, 60), "23 Nov 2026")
  assert.equal(expiryWords(issued, 0), "you use it")
  assert.match(manualRewardText(d, { author: "Ayesha", code: "REVK7Q2MX", pct: 15, issuedAt: issued }, "https://store.fixture"), /15% off code .*REVK7Q2MX\nIt works once until 23 Nov 2026\. Shop: https:\/\/store\.fixture/)

  for (const t of templateDefinitions(d, "https://store.fixture")) {
    const body = t.components.find((c) => c.type === "BODY")
    const slots = body.text.match(/\{\{\d\}\}/g).length
    assert.equal(body.example.body_text[0].length, slots, `${t.name} has an example for every value`)
    assert.ok(!/^\{\{|\}\}$/.test(body.text), "Meta refuses a body that starts or ends with a value")
    assert.equal(t.category, "MARKETING")
  }
  const button = templateDefinitions(d, "https://store.fixture")[0].components[1].buttons[0]
  assert.equal(button.url, "https://store.fixture/review/{{1}}")
  const message = requestTemplateMessage(d, invite, "8801712345678", "order_1.sig")
  assert.equal(message.body.length, 3, "one value per {{n}} in the request body")
  assert.equal(message.buttonUrl, "order_1.sig")
})

test("the WhatsApp settings are validated, and a hand-sent request must keep its link", () => {
  const { parseReviewProgram, readReviewProgram } = base("lib/review-program.ts")
  assert.equal(readReviewProgram({ whatsapp: { requests: "bogus" } }).whatsapp.requests, "no_email")
  const bad = parseReviewProgram({ whatsapp: { requests: "sometimes", request_template: "Bad Name", language: "english", manual_request_text: "Hi {name}" } })
  assert.ok(!bad.settings)
  assert.ok(bad.errors["whatsapp.requests"] && bad.errors["whatsapp.request_template"] && bad.errors["whatsapp.language"] && bad.errors["whatsapp.manual_request_text"])
  assert.equal(parseReviewProgram({ whatsapp: { requests: "always" } }).settings.whatsapp.requests, "always")
})

/** sendReviewRequest against one order, with email and WhatsApp stubbed. */
function requestHarness({ order, whatsapp, program = {} }) {
  const graph = fakeGraph()
  const mails = []
  const opUpdates = []
  const load = loader({ ...STUBS, "./send-email": { sendEmail: async (m) => { mails.push(m); return { ok: true } } } }, { fetch: graph.fetch })
  const { sendReviewRequest } = load("lib/review-requests.ts")
  const { readReviewProgram } = load("lib/review-program.ts")
  const services = {
    query: { graph: async () => ({ data: [order] }) },
    order_ops: {
      listOrderOps: async () => [{ id: "oop_1", order_id: order.id }],
      updateOrderOps: async (patch) => { opUpdates.push(plain(patch)) },
      listWhatsAppSettings: async () => [whatsapp],
    },
  }
  const container = { resolve: (key) => services[key] }
  return { run: () => sendReviewRequest(container, order.id, readReviewProgram(program)), graph, mails, opUpdates }
}

const ORDER = {
  id: "order_01PHONE", display_id: 12, email: "01712345678@no-email.florayn.local", customer_id: null, metadata: { customer_phone: "01712345678" },
  shipping_address: { first_name: "Ayesha", last_name: "Khan", phone: "01712345678" },
  items: [{ product: { id: "p1", handle: "moon-drift", title: "Moon Drift Case", status: "published", metadata: { design_name: "Moon Drift", design_slug: "moon-drift" } } }],
}
const CONNECTED = { id: "wa", enabled: true, phone_number_id: "1234567890", business_account_id: "9", access_token: "EAAtoken-for-tests-000000", api_version: "v23.0" }

test("a phone-only order is asked on WhatsApp with its review page button, and is never emailed", async () => {
  const h = requestHarness({ order: ORDER, whatsapp: CONNECTED })
  const result = await h.run()
  assert.deepEqual(plain(result), { ok: true, note: null, channel: "whatsapp" })
  assert.equal(h.mails.length, 0, "the placeholder address is not mailed")
  const sent = h.graph.calls[0].body
  assert.equal(sent.to, "8801712345678")
  assert.equal(sent.template.name, "florayn_review_request")
  assert.deepEqual(sent.template.components[0].parameters.map((p) => p.text).slice(0, 2), ["Ayesha", "Moon Drift"])
  assert.match(sent.template.components[1].parameters[0].text, /^order_01PHONE\.[\w-]{32}$/, "the button carries the signed review token")
  assert.equal(h.opUpdates[0].review_request_channel, "whatsapp")
})

test("without WhatsApp connected a phone-only order is recorded for sending by hand, not mailed", async () => {
  const h = requestHarness({ order: ORDER, whatsapp: { ...CONNECTED, enabled: false } })
  const result = await h.run()
  assert.equal(result.ok, false)
  assert.equal(result.note, "no email; WhatsApp not connected")
  assert.equal(h.mails.length, 0)
  assert.equal(h.graph.calls.length, 0)
  assert.equal(h.opUpdates[0].review_request_note, "no email; WhatsApp not connected")
  assert.ok(h.opUpdates[0].review_request_sent_at, "it leaves the queue")

  const both = requestHarness({ order: { ...ORDER, email: "ayesha@example.com" }, whatsapp: CONNECTED, program: { whatsapp: { requests: "always" } } })
  assert.equal((await both.run()).channel, "email+whatsapp")
  assert.equal(both.mails[0].to, "ayesha@example.com")
})

test("a phone-only reviewer still earns a code, sent on WhatsApp, or waiting for the admin to send it by hand", async () => {
  function harness({ whatsapp, recent = [] }) {
    const graph = fakeGraph()
    const updates = []
    const promotions = []
    const lookups = []
    const load = loader({
      ...STUBS,
      "@medusajs/medusa/core-flows": { createPromotionsWorkflow: () => ({ run: async ({ input }) => { promotions.push(...input.promotionsData) } }), updateStoresWorkflow: () => ({}) },
      "./send-email": { sendEmail: async () => { throw new Error("no email should be sent") } },
    }, { fetch: graph.fetch })
    const { issueReviewReward } = load("lib/review-rewards.ts")
    const services = {
      logger: { warn() {}, error() {}, info() {} },
      content: {
        retrieveProductReview: async () => ({ id: "rev_1", status: "approved", rating: 5, images: ["https://x/1.jpg"], email: null, phone: "8801712345678", author: "Ayesha", product_id: "p1" }),
        listProductReviews: async (filter) => { lookups.push(plain(filter)); return recent },
        updateProductReviews: async (patch) => { updates.push(plain(patch)) },
      },
      store: { listStores: async () => [{ id: "store", metadata: {} }] },
      promotion: { listPromotions: async () => [] },
      order_ops: { listWhatsAppSettings: async () => [whatsapp] },
    }
    return { run: () => issueReviewReward({ resolve: (key) => services[key] }, "rev_1"), graph, updates, promotions, lookups }
  }

  const sent = harness({ whatsapp: CONNECTED })
  const reward = await sent.run()
  assert.equal(reward.pct, 15)
  assert.equal(sent.promotions.length, 1)
  const body = sent.graph.calls[0].body
  assert.equal(body.template.name, "florayn_review_reward")
  assert.deepEqual(body.template.components[0].parameters.map((p) => p.text).slice(0, 3), ["Ayesha", "15%", reward.code])
  assert.ok(sent.updates.some((u) => u.reward_channel === "whatsapp" && u.reward_mailed_at))
  assert.deepEqual(sent.lookups[0], { phone: "8801712345678", reward_issued_at: sent.lookups[0].reward_issued_at }, "the cooldown counts by mobile")

  const waiting = harness({ whatsapp: { ...CONNECTED, enabled: false } })
  assert.ok(await waiting.run(), "the code is still made")
  const last = waiting.updates.at(-1)
  assert.equal(last.reward_mailed_at, null)
  assert.match(last.reward_note, /send it on WhatsApp by hand/)

  const cooled = harness({ whatsapp: CONNECTED, recent: [{ id: "older" }] })
  assert.equal(await cooled.run(), null)
  assert.equal(cooled.promotions.length, 0)
})
