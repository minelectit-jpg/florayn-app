const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const plain = (value) => JSON.parse(JSON.stringify(value))
const ENV = { JWT_SECRET: "fixture-secret", STOREFRONT_URL: "https://store.fixture", R2_PUBLIC_URL: "https://pub-fixture.r2.dev" }

/** Load a source file with its relative imports; `stubs` replaces modules by specifier. */
function loader(stubs = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, Buffer, process: { env: ENV }, URLSearchParams,
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
const UTILS = { Modules: { STORE: "store", PROMOTION: "promotion", PRODUCT: "product" }, ContainerRegistrationKeys: { LOGGER: "logger", QUERY: "query" } }
const base = loader({
  "@medusajs/framework/utils": UTILS,
  "@medusajs/medusa/core-flows": { updateStoresWorkflow: () => ({ run: async () => ({}) }), createPromotionsWorkflow: () => ({ run: async () => ({}) }) },
  "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
  "../modules/content": { CONTENT_MODULE: "content" },
})

test("settings default to florayn.com's and are bounded", () => {
  const { readReviewProgram, parseReviewProgram, DEFAULT_REVIEW_PROGRAM } = base("lib/review-program.ts")
  const d = plain(readReviewProgram(undefined))
  assert.deepEqual(d, plain(DEFAULT_REVIEW_PROGRAM))
  assert.equal(d.rewards.photo_pct, 15)
  assert.equal(d.rewards.text_pct, 10)
  assert.equal(d.requests.delay_days, 4)
  assert.equal(d.requests.enabled, false, "requests stay off until the owner switches them on")
  assert.deepEqual(d.requests.statuses, ["delivered"])
  const clamped = readReviewProgram({ rewards: { photo_pct: 500, max_photos: 0 }, requests: { statuses: ["delivered", "bogus"] } })
  assert.equal(clamped.rewards.photo_pct, 90)
  assert.equal(clamped.rewards.max_photos, 1)
  assert.deepEqual(plain(clamped.requests.statuses), ["delivered"])
  const bad = parseReviewProgram({ rewards: { text_pct: -1 }, requests: { statuses: [] }, from_name: "" })
  assert.ok(!bad.settings)
  assert.ok(bad.errors["rewards.text_pct"] && bad.errors["requests.statuses"] && bad.errors.from_name)
  assert.equal(parseReviewProgram({ rewards: { photo_pct: 20 } }).settings.rewards.photo_pct, 20)
})

test("review links are signed for one order and cannot be forged or moved", () => {
  const { reviewToken, readReviewToken, reviewLink } = base("lib/review-links.ts")
  const token = reviewToken("order_01ABC")
  assert.equal(readReviewToken(token), "order_01ABC")
  assert.equal(readReviewToken(token.replace("order_01ABC", "order_01XYZ")), null, "another order's id does not match the signature")
  assert.equal(readReviewToken(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`), null)
  for (const junk of [null, "", "order_01ABC", "nope.sig", 5]) assert.equal(readReviewToken(junk), null)
  const link = reviewLink("grape-goo", token, 9)
  assert.match(link, /^https:\/\/store\.fixture\/product\/grape-goo\/\?review=.+&r=5#customer-reviews$/)
})

test("the request and reward emails keep florayn.com's words, escape names and hide the offer when rewards are off", () => {
  const { reviewRequestEmail, rewardEmail, formatPct } = base("lib/review-emails.ts")
  const mail = reviewRequestEmail({
    firstName: "<Rafi>", photoPct: 15, textPct: 10, rewardsOn: true,
    products: [{ title: "Grape Goo", thumbnail: "https://img/1.jpg", starLinks: [1, 2, 3, 4, 5].map((n) => `https://x/?r=${n}`) }],
  })
  assert.equal(mail.subject, "How is your Florayn order?")
  assert.match(mail.html, /Hi &lt;Rafi&gt;,/)
  assert.match(mail.html, /Hope you are enjoying your order\. How was it\? Tap the stars to leave a quick review\./)
  assert.match(mail.html, /Add a photo with your review and get <strong>15% off<\/strong> your next order &mdash; a few words alone gets <strong>10% off<\/strong>\./)
  assert.equal((mail.html.match(/&#9733;/g) ?? []).length, 5)
  assert.match(mail.html, /You are getting this because you ordered from Florayn\./)
  const quiet = reviewRequestEmail({ firstName: null, photoPct: 15, textPct: 10, rewardsOn: false, products: [] })
  assert.ok(!quiet.html.includes("% off"))
  assert.match(quiet.html, /Hi there,/)
  const reward = rewardEmail({ author: "Rafi", product: "Grape Goo", withPhotos: true, code: "REVK7Q2MX", pct: 15, expiryDays: 60, shopUrl: "https://store.fixture" })
  assert.equal(reward.subject, "Your 15% off code from Florayn")
  assert.match(reward.html, /Thank you for reviewing <strong>Grape Goo<\/strong> with photos\./)
  assert.match(reward.html, /15% off, one use, valid for 60 days\./)
  assert.match(reward.html, />Shop now</)
  assert.equal(formatPct(15), "15")
  assert.equal(formatPct(12.5), "12.5")
})

test("a published review earns the photo or text rate once, above the minimum rating", () => {
  const { rewardFor } = base("lib/review-rewards.ts")
  const { DEFAULT_REVIEW_PROGRAM: d } = base("lib/review-program.ts")
  assert.deepEqual(plain(rewardFor({ rating: 5, images: ["a"], status: "approved" }, d)), { pct: 15, withPhotos: true })
  assert.deepEqual(plain(rewardFor({ rating: 4, images: [], status: "approved" }, d)), { pct: 10, withPhotos: false })
  assert.ok("skip" in rewardFor({ rating: 5, status: "pending" }, d))
  assert.ok("skip" in rewardFor({ rating: 5, status: "approved", coupon_code: "REVX" }, d))
  assert.ok("skip" in rewardFor({ rating: 2, status: "approved" }, { ...d, rewards: { ...d.rewards, min_rating: 3 } }))
  assert.ok("skip" in rewardFor({ rating: 5, status: "approved" }, { ...d, rewards: { ...d.rewards, enabled: false } }))
  assert.ok("skip" in rewardFor({ rating: 5, status: "approved" }, { ...d, rewards: { ...d.rewards, text_pct: 0 } }))
})

test("an order is due once it has sat in a qualifying status for the delay, within the age limit, after requests began", () => {
  const { isDue } = base("lib/review-requests.ts")
  const { DEFAULT_REVIEW_PROGRAM: d } = base("lib/review-program.ts")
  const now = Date.parse("2026-10-10T00:00:00Z")
  const day = 86_400_000
  const settings = { ...d, requests: { ...d.requests, enabled: true, started_at: "2026-09-01T00:00:00Z" } }
  const op = (daysAgo, extra = {}) => ({ workflow_status: "delivered", status_changed_at: new Date(now - daysAgo * day).toISOString(), ...extra })
  assert.equal(isDue(op(5), settings, now), true)
  assert.equal(isDue(op(3), settings, now), false, "not before the 4-day delay")
  assert.equal(isDue(op(5, { workflow_status: "shipped" }), settings, now), false)
  assert.equal(isDue(op(5, { review_request_sent_at: "2026-10-01" }), settings, now), false, "every order is mailed once")
  assert.equal(isDue(op(45), settings, now), false, "delivered before requests were switched on")
  assert.equal(isDue(op(45), { ...settings, requests: { ...settings.requests, started_at: null } }, now), true)
  assert.equal(isDue(op(200), { ...settings, requests: { ...settings.requests, started_at: null } }, now), false, "older than 120 days")
  assert.equal(isDue({ workflow_status: "delivered", updated_at: new Date(now - 6 * day).toISOString() }, settings, now), true, "older rows fall back to their last update")
})

test("review photos are recognised by their bytes, not their name", () => {
  const { imageType } = base("lib/review-photos.ts")
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).type, "image/jpeg")
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])).ext, "png")
  assert.equal(imageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])).ext, "webp")
  assert.equal(imageType(Buffer.from("<svg onload=alert(1)>")), null)
  assert.equal(imageType(Buffer.from("GIF89a....")), null)
})

test("the sender name can change but the verified address stays", () => {
  const { fromHeader } = base("lib/send-email.ts")
  assert.equal(fromHeader("Florayn <hello@florayn.com>", "Florayn Reviews"), "Florayn Reviews <hello@florayn.com>")
  assert.equal(fromHeader("hello@florayn.com", "Florayn"), "Florayn <hello@florayn.com>")
  assert.equal(fromHeader("Florayn <hello@florayn.com>", 'x"<evil@x>'), "xevil@x <hello@florayn.com>")
  assert.equal(fromHeader("Florayn <hello@florayn.com>"), "Florayn <hello@florayn.com>")
})

function rewardHarness({ review, recent = [], program = {}, emailOk = true }) {
  const updates = []
  const promotions = []
  const mails = []
  const content = {
    retrieveProductReview: async () => ({ ...review }),
    listProductReviews: async () => recent,
    updateProductReviews: async (patch) => { updates.push(plain(patch)) },
  }
  const load = loader({
    "@medusajs/framework/utils": UTILS,
    "@medusajs/medusa/core-flows": {
      createPromotionsWorkflow: () => ({ run: async ({ input }) => { promotions.push(...input.promotionsData) } }),
      updateStoresWorkflow: () => ({ run: async () => ({}) }),
    },
    "../modules/content": { CONTENT_MODULE: "content" },
    "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
    "./send-email": { sendEmail: async (message) => { mails.push(message); return { ok: emailOk } } },
  })
  const { issueReviewReward } = load("lib/review-rewards.ts")
  const services = {
    logger: { warn() {}, error() {}, info() {} },
    content,
    store: { listStores: async () => [{ id: "store", metadata: { florayn_review_program: program } }] },
    promotion: { listPromotions: async () => [] },
    product: { retrieveProduct: async () => ({ title: "Grape Goo - Phone Case", metadata: { design_name: "Grape Goo" } }) },
  }
  const container = { resolve: (key) => services[key] }
  return { run: () => issueReviewReward(container, review.id), updates, promotions, mails }
}

test("publishing a photo review creates one single-use 15% code that expires, and mails it", async () => {
  const h = rewardHarness({ review: { id: "rev_1", status: "approved", rating: 5, images: ["https://x/1.jpg"], email: "Rafi@Example.com", author: "Rafi", product_id: "prod_1" } })
  const reward = await h.run()
  assert.match(reward.code, /^REV[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(reward.pct, 15)
  const promo = h.promotions[0]
  assert.equal(promo.code, reward.code)
  assert.equal(promo.status, "active")
  assert.equal(promo.is_automatic, false)
  assert.equal(promo.limit, 1, "one use")
  assert.deepEqual(plain(promo.application_method), { type: "percentage", target_type: "order", value: 15, currency_code: "bdt" })
  const days = (new Date(promo.campaign.ends_at) - new Date(promo.campaign.starts_at)) / 86_400_000
  assert.equal(Math.round(days), 60)
  assert.equal(h.mails[0].to, "rafi@example.com")
  assert.equal(h.mails[0].subject, `Your 15% off code from Florayn`)
  assert.match(h.mails[0].html, new RegExp(reward.code))
  assert.ok(h.updates.some((u) => u.coupon_code === reward.code && u.reward_pct === 15))
  assert.ok(h.updates.some((u) => u.reward_mailed_at))
})

test("no code inside the cooldown, below the rating, without an email or twice for one review", async () => {
  const base = { id: "rev_2", status: "approved", rating: 5, images: [], email: "a@b.co", author: "A", product_id: "p" }
  const cooldown = rewardHarness({ review: base, recent: [{ id: "older" }] })
  assert.equal(await cooldown.run(), null)
  assert.equal(cooldown.promotions.length, 0)
  assert.equal(cooldown.updates[0].reward_note, "cooldown")
  const low = rewardHarness({ review: { ...base, rating: 1 }, program: { rewards: { min_rating: 4 } } })
  assert.equal(await low.run(), null)
  assert.match(low.updates[0].reward_note, /below 4 stars/)
  const noEmail = rewardHarness({ review: { ...base, email: null } })
  assert.equal(await noEmail.run(), null)
  assert.equal(noEmail.updates[0].reward_note, "no email to send it to")
  const twice = rewardHarness({ review: { ...base, coupon_code: "REVAAAAAA" } })
  assert.equal(await twice.run(), null)
  assert.equal(twice.promotions.length, 0)
  const unsent = rewardHarness({ review: base, emailOk: false })
  const code = await unsent.run()
  assert.equal(code.pct, 10, "a text review earns the text rate")
  assert.ok(!unsent.updates.some((u) => u.reward_mailed_at), "a failed send is not recorded as mailed")
})

function submitHarness({ invite, program = {}, existing = [] }) {
  const steps = {}
  class MedusaError extends Error { static Types = { INVALID_DATA: "invalid", NOT_ALLOWED: "not_allowed", UNAUTHORIZED: "unauthorized", NOT_FOUND: "not_found" }; constructor(type, message) { super(message); this.type = type } }
  const created = []
  const load = loader({
    "@medusajs/framework/utils": { ...UTILS, MedusaError, Modules: { ...UTILS.Modules, CUSTOMER: "customer" } },
    "@medusajs/framework/workflows-sdk": { createStep: (name, fn) => { steps[name] = fn; return fn }, createWorkflow: () => ({}), StepResponse: class { constructor(value) { this.value = value } }, WorkflowResponse: class {} },
    "@medusajs/medusa/core-flows": { updateStoresWorkflow: () => ({}) },
    "../modules/content": { CONTENT_MODULE: "content" },
    "../modules/order-ops": { ORDER_OPS_MODULE: "order_ops" },
    "../lib/product-reviews": { reviewProduct: async () => ({ key: "design:grape-goo" }), reviewInput: (body) => ({ rating: body.rating, author: body.author, title: "", body: body.body, images: [] }) },
    "../lib/review-invites": { designKey: (p) => (p.design ? `design:${p.design}` : `product:${p.id}`), inviteFromToken: async (_c, token) => (token === "good" ? invite : null) },
  })
  load("workflows/product-reviews.ts")
  const services = {
    store: { listStores: async () => [{ id: "s", metadata: { florayn_review_program: program } }] },
    customer: { retrieveCustomer: async (id) => ({ id, email: "member@example.com" }) },
    content: {
      listProductReviews: async () => existing,
      listAndCountProductReviews: async () => [[], 0],
      createProductReviews: async (row) => { created.push(row); return { id: "rev_new", ...row } },
    },
  }
  const container = { resolve: (key) => services[key] }
  return { submit: (input) => steps["submit-product-review"](input, { container }).then((r) => plain(r.value)), created }
}

test("a review link lets the order's customer review what they bought, as a verified buyer, without signing in", async () => {
  const invite = { orderId: "order_1", email: "guest@example.com", customerId: null, products: [{ id: "p1", design: "grape-goo" }] }
  const h = submitHarness({ invite })
  const result = await h.submit({ productId: "p1", token: "good", body: { rating: 5, author: "Guest", body: "Lovely" } })
  assert.deepEqual(result, { id: "rev_new", status: "pending" })
  assert.equal(h.created[0].customer_id, "order:order_1")
  assert.equal(h.created[0].email, "guest@example.com")
  assert.equal(h.created[0].order_id, "order_1")
  assert.equal(h.created[0].verified, true)

  const other = submitHarness({ invite: { ...invite, products: [{ id: "p9", design: "sonar" }] } })
  await assert.rejects(other.submit({ productId: "p1", token: "good", body: { rating: 5, author: "G", body: "x" } }), /products in your order/)
  await assert.rejects(h.submit({ productId: "p1", token: "forged", body: { rating: 5, author: "G", body: "x" } }), /not valid/)
  await assert.rejects(h.submit({ productId: "p1", body: { rating: 5, author: "G", body: "x" } }), /Sign in/)
  await assert.rejects(submitHarness({ invite, existing: [{ id: "old" }] }).submit({ productId: "p1", token: "good", body: { rating: 5, author: "G", body: "x" } }), /already/)
})

test("a signed-in customer's review keeps their email for the reward and follows the approval setting", async () => {
  const h = submitHarness({ invite: null, program: { auto_approve: true } })
  const result = await h.submit({ productId: "p1", customerId: "cus_1", body: { rating: 4, author: "Member", body: "Good" } })
  assert.equal(result.status, "approved")
  assert.equal(h.created[0].customer_id, "cus_1")
  assert.equal(h.created[0].email, "member@example.com")
  assert.equal(h.created[0].verified, false)
})
