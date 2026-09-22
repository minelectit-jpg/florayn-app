const http = require("node:http")
const { createHash } = require("node:crypto")

// Local, disposable fixtures only. No request is forwarded to a real service.
const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="540" height="540" fill="#eee6fa"/><rect x="165" y="60" width="210" height="420" rx="36" fill="#8d66b1"/><text x="270" y="285" text-anchor="middle" fill="white" font-size="26">Test case</text></svg>')
const devices = [
  { id: "dev_16", slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", family: "iphone", brand: "Apple" },
  { id: "dev_17", slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", brand: "Apple" },
  { id: "dev_air_max", slug: "airpods-max", name: "AirPods Max", family: "airpods", brand: "Apple" },
  { id: "dev_air", slug: "airpods-pro-3", name: "AirPods Pro 3", family: "airpods", brand: "Apple" },
]
// devices carries the family the storefront derives each construction's forms
// from (getCaseTypes). Signature is phone-only; AirPods sell Signature Earbuds.
const caseTypes = [
  { id: "case_signature", name: "Signature", slug: "signature", price: 1400, is_active: true, description: "Test signature case", forms: ["phone"], devices: devices.filter((d) => d.family === "iphone") },
  { id: "case_armor", name: "Armor Black", slug: "armor-black", price: 1700, is_active: true, description: "Test armor case", forms: ["phone"], devices: devices.filter((d) => d.family === "iphone") },
  { id: "case_earbuds", name: "Signature Earbuds", slug: "signature-earbuds", price: 750, is_active: true, description: "Test earbuds case", forms: ["airpods"], devices: devices.filter((d) => d.family === "airpods") },
]
const collection = { id: "col_test", title: "Test Collection", handle: "test-collection" }
function makeProduct(slug, title, form = "phone") {
  const handle = form === "phone" ? slug : `${slug}-${form}`
  const productDevices = devices.filter((device) => form === "phone" ? device.family === "iphone" : device.family === "airpods")
  const formCaseTypes = caseTypes.filter((c) => c.forms.includes(form))
  const options = [
    { id: `opt_case_${handle}`, title: "Case Type", values: formCaseTypes.map((c) => ({ id: c.id, value: c.name })) },
    { id: `opt_device_${handle}`, title: "Device", values: productDevices.map((d) => ({ id: d.id, value: d.name })) },
  ]
  const variants = formCaseTypes.flatMap((c) => productDevices.map((d) => ({
    id: `variant_${handle}_${c.slug}_${d.slug}`,
    title: `${c.name} / ${d.name}`,
    options: [{ id: `ovc_${c.id}`, option_id: options[0].id, value: c.name }, { id: `ovd_${d.id}`, option_id: options[1].id, value: d.name }],
    metadata: { images: [image], unused_audit_field: "not needed by the browser" },
    calculated_price: { calculated_amount: c.price, currency_code: "bdt" },
    manage_inventory: false,
  })))
  const card = { pairs: Object.fromEntries(variants.map((v) => [`${v.options[1].value}|${v.options[0].value}`, { variantId: v.id, price: v.calculated_price.calculated_amount, image }])) }
  return { id: `prod_${handle}`, title, handle, description: "Local test product only.", subtitle: form === "phone" ? "Phone Case" : "AirPods Case", thumbnail: image, images: [{ id: `img_${handle}`, url: image }], collection, categories: [], options, variants, metadata: { design_name: title, design_slug: slug, form, card } }
}
const products = [makeProduct("audit-bloom", "Audit Bloom"), makeProduct("audit-midnight", "Audit Midnight"), makeProduct("audit-bloom", "Audit Bloom", "airpods"), makeProduct("audit-midnight", "Audit Midnight", "airpods")]
const content = {
  sections: [{ key: "releases", type: "product_carousel", title: "Test products", config: { limit: 5 } }],
  primary: [{ id: "menu_phone", label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", groups: [] }],
  footer: [], footerNote: "Local verification", social: [],
}
if (process.env.UI_REFINEMENT_FIXTURE === "1") products.push({
 id: "prod_stickpad", title: "StickPad Pro", handle: "audit-stickpad", description: "Local regular product fixture.",
 thumbnail: image, images: [{ id: "img_stickpad", url: image }], options: [{ id: "color", title: "Color" }],
 variants: [{ id: "variant_stickpad", title: "Rose", options: [{ option_id: "color", value: "Rose" }], metadata: { images: [image] }, calculated_price: { calculated_amount: 350, currency_code: "bdt" }, manage_inventory: false }],
 metadata: { florayn_manual_recommendations: { recommended: [products[0].variants[0].id], featured: [products[3].variants[0].id] } },
})
const bundle = { settings: { heading: "Choose a pack", single_label: "Single", free_shipping_threshold: 3000, scope: "cases", is_active: true, matching_set_enabled: true, matching_set_discount: 250, matching_set_default_airpods: "AirPods Pro 3" }, tiers: [{ id: "tier_two", quantity: 2, badge: null, discount_amount: 200, min_pct: 0, max_pct: 0 }] }
const stock = Object.fromEntries(caseTypes.flatMap((c) => c.devices.map((d) => [`${c.name}|${d.name}`, 20])))
const carts = new Map()
const orders = new Map()
// Opt-in account UI checks. These fake codes never send email or contact Medusa.
const accountFixture = process.env.UI_REFINEMENT_FIXTURE === "1"
const fixtureCustomer = { id: "cus_fixture", email: "shopper@example.invalid", first_name: "Alex", last_name: "Rahman", phone: "01700000000" }
const fixtureAddresses = [{ id: "addr_fixture", first_name: "Alex", last_name: "Rahman", address_1: "12 Fixture Road", city: "Dhaka", country_code: "bd", phone: "01700000000" }]
const districts = ["Chattogram", "Dhaka", "Gazipur", "Narayanganj", "Rajshahi", "Sylhet"]
const checkoutSettings = {
  heading: "Checkout", description: "Enter your delivery details to place your order.",
  delivery_note: "", support_phone: "+8801310007055", support_label: "Need help?", show_order_note: true,
}
const contactSettings = {
  eyebrow: "Contact", title: "Talk to us",
  description: "Questions about an order, a device we do not list yet, or an exchange - the fastest answer is a phone call.",
  phone_label: "Phone", phone: "+8801700000000", phone_note: "Saturday to Thursday, 10am - 8pm",
  email_label: "Email", email: "support@example.invalid", email_note: "We reply within one working day",
  address_label: "Address", address: "12 Fixture Road\nDhaka, Bangladesh", address_note: "",
  faq_eyebrow: "FAQs", faq_title: "Common questions", faq_description: "A few helpful answers before you get in touch.",
  help_title: "Still have a question?", help_description: "Call or email us about your order, device compatibility or an exchange.",
  faqs: [
    { id: "delivery", question: "How long does delivery take?", answer: "Three to five days across Bangladesh." },
    { id: "payment", question: "How do I pay?", answer: "Cash on delivery. You pay the courier when the parcel reaches you." },
  ],
}
const checkoutControl = { price_delta: 0, fail_quote_once: false, fail_complete_once: false, lose_complete_response_once: false }

// Static confirmation previews do not insert orders or need checkout/payment.
const previewCaseImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="540" height="540" fill="#f8f1f1"/><rect x="153" y="48" width="234" height="444" rx="45" fill="#bc6880"/><rect x="171" y="66" width="104" height="112" rx="25" fill="#e9c2cd"/><g fill="#29242c"><circle cx="198" cy="94" r="18"/><circle cx="246" cy="98" r="18"/><circle cx="207" cy="145" r="18"/></g><path d="M193 300 Q270 180 345 300 Q270 415 193 300" fill="#f0d8b0"/><text x="270" y="444" text-anchor="middle" fill="#fff" font-size="18">FLORAYN</text></svg>')
const previewStrapImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="540" height="540" fill="#f2f0ec"/><path d="M235 392 C70 147 200 62 270 138 C340 62 470 147 305 392" fill="none" stroke="#b59778" stroke-width="44"/><rect x="230" y="360" width="80" height="95" rx="18" fill="#d1b38f"/><circle cx="270" cy="451" r="29" fill="none" stroke="#b2a690" stroke-width="13"/></svg>')

function previewOrder(id) {
  const order = {
    id, display_id: id === "order_test_discount" ? 2049 : id === "order_test_cancelled" ? 2050 : 2048,
    created_at: "2026-09-21T08:30:00.000Z", currency_code: "bdt", status: "pending", payment_status: "authorized",
    subtotal: 1750, discount_total: 0, tax_total: 0, shipping_subtotal: 100, shipping_total: 100, total: 1850,
    payment_method: "Cash on Delivery", free_shipping: false, shipping_method: "Outside Dhaka",
    items: [
      { id: "item_preview_case", title: "Blush Bloom", variant_title: "Signature / iPhone 17 Pro Max", sku: null,
        quantity: 1, unit_price: 1400, subtotal: 1400, discount_total: 0, tax_total: 0, total: 1400, thumbnail: previewCaseImage },
      { id: "item_preview_strap", title: "Everyday Wrist Strap", variant_title: "Sand / One size", sku: null,
        quantity: 1, unit_price: 350, subtotal: 350, discount_total: 0, tax_total: 0, total: 350, thumbnail: previewStrapImage },
    ],
    delivery: { name: "Sample Customer", address: "12 Sample Road", area: "Sample Area", district: "Gazipur", phone: "017*****678" },
  }
  if (id === "order_test_discount") {
    order.items[0] = { ...order.items[0], quantity: 3, subtotal: 4200, discount_total: 200, total: 4000 }
    order.subtotal = 4550
    order.discount_total = 200
    order.shipping_total = 0
    order.total = 4350
    order.free_shipping = true
  }
  if (id === "order_test_cancelled") { order.status = "canceled"; order.payment_status = "canceled" }
  return order
}

function recalculateCart(cart) {
  for (const item of cart.items) item.unit_price = item.fixture_base_price + checkoutControl.price_delta
  cart.item_subtotal = cart.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  cart.subtotal = cart.item_subtotal + (cart.shipping_subtotal || 0)
  cart.total = cart.item_subtotal + (cart.shipping_total || 0)
}

// Disposable arithmetic is intentionally limited to this fixture's one tier.
// The backend regression suite verifies the real Medusa promotion workflows.
function quoteCart(cart, district) {
  recalculateCart(cart)
  const phoneItems = cart.items.filter((item) => item.variant.product.metadata.form === "phone")
  const phoneQuantity = phoneItems.reduce((count, item) => count + item.quantity, 0)
  let discount = Math.floor(phoneQuantity / 2) * 200
  for (const slug of new Set(cart.items.map((item) => item.variant.product.metadata.design_slug))) {
    const byForm = (form) => cart.items.filter((item) => item.variant.product.metadata.design_slug === slug && item.variant.product.metadata.form === form)
      .reduce((sum, item) => sum + item.quantity, 0)
    discount += Math.min(byForm("phone"), byForm("airpods")) * 250
  }
  discount = Math.min(discount, cart.item_subtotal)
  cart.shipping_subtotal = district === "Dhaka" ? 60 : 100
  cart.shipping_total = cart.item_subtotal - discount >= bundle.settings.free_shipping_threshold ? 0 : cart.shipping_subtotal
  cart.subtotal = cart.item_subtotal + cart.shipping_subtotal
  cart.total = cart.item_subtotal - discount + cart.shipping_total
  let allocated = 0
  const items = cart.items.map((item, index) => {
    const subtotal = item.quantity * item.unit_price
    const saving = index === cart.items.length - 1 ? discount - allocated : Math.round(discount * subtotal / cart.item_subtotal * 100) / 100
    allocated += saving
    return { id: item.id, title: item.title, variant_title: item.variant.title, quantity: item.quantity,
      unit_price: item.unit_price, subtotal, total: Math.round((subtotal - saving) * 100) / 100, thumbnail: item.thumbnail }
  })
  const quote = { currency_code: "bdt", subtotal: cart.item_subtotal, discount_total: discount,
    bundle_discount: discount, shipping_total: cart.shipping_total, shipping_subtotal: cart.shipping_subtotal,
    tax_total: 0, total: cart.total, free_shipping: cart.shipping_total === 0,
    shipping_option_id: district === "Dhaka" ? "ship_inside_test" : "ship_outside_test",
    shipping_label: district === "Dhaka" ? "Inside Dhaka" : "Outside Dhaka", district,
    item_count: items.reduce((sum, item) => sum + item.quantity, 0), payment_method: "cash_on_delivery", items }
  return { version: createHash("sha256").update(JSON.stringify({ cart_id: cart.id, ...quote })).digest("hex"), ...quote }
}
const metrics = []
let revision = 0
let stockRevision = 0
let contactRevision = 0
function filters(url, key) { return [...url.searchParams].filter(([k]) => k === key || k.startsWith(`${key}[`)).map(([, value]) => value) }
function send(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-publishable-api-key" })
  res.end(JSON.stringify(body))
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:9901")
  if (req.method === "OPTIONS") return send(res, {})
  if (url.pathname === "/__audit/health") return send(res, { fixture: true })
  if (url.pathname === "/__audit/metrics") return send(res, metrics)
  if (url.pathname === "/__test/status") return send(res, {
    revision, stockRevision, contactRevision, orderCount: orders.size,
    requests: metrics.reduce((counts, item) => {
      counts[item.path] = (counts[item.path] ?? 0) + 1
      return counts
    }, {}),
  })
  metrics.push({ path: url.pathname, method: req.method, fields: url.searchParams.get("fields"), handles: filters(url, "handle") })
  let body = ""
  for await (const chunk of req) body += chunk
  const data = body ? JSON.parse(body) : {}
  if (accountFixture && url.pathname === "/store/auth/otp/request") {
    return send(res, { message: "Local fixture only. Use 123456." })
  }
  if (accountFixture && url.pathname === "/store/auth/otp/verify") {
    return data.code === "123456" ? send(res, { token: "local-account-fixture" }) : send(res, { message: "Invalid or expired code." }, 400)
  }
  if (accountFixture && (url.pathname.startsWith("/store/customers/me") || url.pathname === "/store/orders")) {
    if (req.headers.authorization !== "Bearer local-account-fixture") return send(res, { message: "Sign in" }, 401)
    if (url.pathname === "/store/customers/me") {
      if (req.method === "POST") for (const key of ["first_name", "last_name", "phone"]) if (typeof data[key] === "string") fixtureCustomer[key] = data[key]
      return send(res, { customer: fixtureCustomer })
    }
    if (url.pathname === "/store/customers/me/addresses") {
      if (req.method === "POST") fixtureAddresses.push({ id: `addr_${fixtureAddresses.length}`, ...data })
      return send(res, { addresses: fixtureAddresses })
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/store/customers/me/addresses/")) {
      const index = fixtureAddresses.findIndex((a) => a.id === url.pathname.split("/").pop())
      if (index >= 0) fixtureAddresses.splice(index, 1)
      return send(res, { deleted: true })
    }
    if (url.pathname === "/store/orders") return send(res, { orders: [
      { id: "order_test_preview", display_id: 2048, status: "pending", created_at: "2026-09-21T08:30:00Z", currency_code: "bdt", total: 1850, items: [{ title: "Blush Bloom", quantity: 1 }, { title: "Everyday Wrist Strap", quantity: 1 }] },
      { id: "order_test_discount", display_id: 2049, status: "completed", created_at: "2026-09-18T08:30:00Z", currency_code: "bdt", total: 2600, items: [{ title: "Audit Midnight", quantity: 2 }] },
    ] })
  }
  if (url.pathname === "/__test/checkout" && req.method === "POST") {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some((key) => !Object.hasOwn(checkoutControl, key)) ||
        Object.entries(data).some(([key, value]) => key === "price_delta" ? !Number.isFinite(value) || value < 0 || value > 1000 : typeof value !== "boolean")) {
      return send(res, { message: "Invalid local checkout control" }, 400)
    }
    Object.assign(checkoutControl, data)
    return send(res, { fixture: true, ...checkoutControl })
  }
  if (["/store/checkout/quote", "/store/checkout"].includes(url.pathname) && req.method === "POST") {
    const complete = url.pathname === "/store/checkout"
    const failureKey = complete ? "fail_complete_once" : "fail_quote_once"
    if (checkoutControl[failureKey]) {
      checkoutControl[failureKey] = false
      return send(res, { errors: { form: "Local test connection failure. Please try again." } }, 503)
    }
    const cart = carts.get(data.cart_id)
    if (!cart) return send(res, { errors: { form: "Your cart could not be found. Please return to your bag." } }, 404)
    if (complete && cart.fixture_order_id) return send(res, { order: orders.get(cart.fixture_order_id) })
    if (cart.completed_at || !cart.items.length) return send(res, { errors: { form: "Your cart is empty. Please return to your bag." } }, 400)
    if (!districts.includes(data.district)) return send(res, { errors: { district: "Select your delivery district." } }, 400)
    if (complete) {
      const errors = {}
      for (const key of ["full_name", "phone", "address", "area"]) {
        if (typeof data[key] !== "string" || !data[key].trim()) errors[key] = `Enter ${key.replaceAll("_", " ")}.`
      }
      if (Object.keys(errors).length) return send(res, { errors }, 400)
    }
    const quote = quoteCart(cart, data.district)
    if (!complete) return send(res, { quote })
    if (data.quote_version !== quote.version) {
      return send(res, { errors: { form: "Your order total has changed. Please review the updated total and place your order again." }, quote }, 409)
    }
    const order = { id: `order_test_${orders.size + 1}`, display_id: 1001 + orders.size,
      created_at: new Date().toISOString(), currency_code: "bdt", status: "pending", payment_status: "authorized", subtotal: quote.subtotal,
      discount_total: quote.discount_total, tax_total: quote.tax_total, shipping_subtotal: quote.shipping_subtotal,
      shipping_total: quote.shipping_total, total: quote.total, payment_method: "Cash on Delivery",
      free_shipping: quote.free_shipping, shipping_method: quote.shipping_label,
      items: quote.items.map((item) => ({ ...item, discount_total: Math.round((item.subtotal - item.total) * 100) / 100, tax_total: 0, sku: null })),
      delivery: { name: data.full_name, address: data.address, area: data.area, district: data.district,
        phone: `${data.phone.slice(0, 3)}${"*".repeat(Math.max(0, data.phone.length - 6))}${data.phone.slice(-3)}` } }
    orders.set(order.id, order)
    cart.fixture_order_id = order.id
    cart.completed_at = order.created_at
    if (checkoutControl.lose_complete_response_once) {
      checkoutControl.lose_complete_response_once = false
      req.socket.destroy()
      return
    }
    return send(res, { order })
  }
  const previewMatch = url.pathname.match(/^\/store\/checkout\/(order_test_(?:preview|discount|cancelled))$/)
  if (previewMatch && req.method === "GET") return send(res, { order: previewOrder(previewMatch[1]) })
  const orderMatch = url.pathname.match(/^\/store\/checkout\/(order_test_\d+)$/)
  if (orderMatch && req.method === "GET") {
    const order = orders.get(orderMatch[1])
    return send(res, order ? { order } : { message: "No test order" }, order ? 200 : 404)
  }
  if (url.pathname === "/__test/revision" && req.method === "POST") {
    if (!Number.isInteger(data.revision) || data.revision < 0 ||
        (data.stockRevision !== undefined && (!Number.isInteger(data.stockRevision) || data.stockRevision < 0)) ||
        (data.contactRevision !== undefined && (!Number.isInteger(data.contactRevision) || data.contactRevision < 0))) {
      return send(res, { message: "Expected nonnegative integer revision and optional stockRevision/contactRevision" }, 400)
    }
    revision = data.revision
    if (data.stockRevision !== undefined) stockRevision = data.stockRevision
    if (data.contactRevision !== undefined) contactRevision = data.contactRevision
    return send(res, { revision, stockRevision, contactRevision })
  }
  switch (url.pathname) {
    case "/store/regions": return send(res, { regions: [{ id: "reg_test", currency_code: "bdt", name: "Bangladesh" }] })
    case "/store/devices": return send(res, { devices })
    case "/store/case-types": return send(res, { case_types: caseTypes })
    case "/store/stock": return send(res, { stock: Object.fromEntries(Object.entries(stock).map(([key, quantity]) => [key, quantity + stockRevision])) })
    case "/store/content": return send(res, { ...content, footerNote: `Local verification revision ${revision}` })
    case "/store/bundles": return send(res, bundle)
    case "/store/districts": return send(res, { districts, count: districts.length, inside_dhaka: ["Dhaka"], shipping: { inside_dhaka: 60, outside_dhaka: 100 } })
    case "/store/checkout-settings": return send(res, { settings: checkoutSettings })
    case "/store/contact-settings": return send(res, { settings: { ...contactSettings, ...(contactRevision ? { title: `Contact revision ${contactRevision}` } : {}) } })
    case "/store/content/product-sections": return send(res, { featureBlocks: [], featuredPicks: ["audit-midnight"] })
    case "/store/content/gallery-videos": return send(res, { videos: {} })
    case "/store/seo": return send(res, { templates: { title: "{design} {device} Case", description: "{design} test case for {device}", heading: "{design} {device} Case", fit_copy_enabled: true }, overrides: [] })
    case "/store/shop-catalog": {
      // Form-scope like the real route: a device query returns only that form's
      // designs and constructions; AirPods resolve to signature-earbuds.
      const deviceObj = devices.find((d) => d.slug === url.searchParams.get("device"))
      const targetForm = deviceObj ? (deviceObj.family === "iphone" || deviceObj.family === "samsung" ? "phone" : deviceObj.family) : null
      const bySlug = new Map()
      for (const p of products.filter((p) => p.metadata.design_slug)) {
        if (targetForm && p.metadata.form !== targetForm) continue
        const entry = bySlug.get(p.metadata.design_slug) ?? { slug: p.metadata.design_slug, name: p.title, caseTypes: [], forms: [] }
        for (const c of caseTypes.filter((c) => c.forms.includes(p.metadata.form))) if (!entry.caseTypes.includes(c.slug)) entry.caseTypes.push(c.slug)
        if (!entry.forms.includes(p.metadata.form)) entry.forms.push(p.metadata.form)
        bySlug.set(p.metadata.design_slug, entry)
      }
      return send(res, { designs: [...bySlug.values()] })
    }
    case "/store/shop-cards": {
      const handles = (url.searchParams.get("handles") || "").split(",")
      const prefix = `${url.searchParams.get("device")}|`
      const caseType = url.searchParams.get("case_type")
      return send(res, { cards: products.filter((p) => handles.includes(p.handle)).map((p) => {
        const pairs = p.metadata.card.pairs
        const selected = pairs[`${prefix}${caseType}`]
        return {
          handle: p.handle, variantId: selected?.variantId ?? null, image: selected?.image ?? null,
          imagesByCaseType: Object.fromEntries(Object.entries(pairs).filter(([key]) => key.startsWith(prefix)).map(([key, pair]) => [key.slice(prefix.length), pair.image])),
        }
      }) })
    }
    case "/store/collections": return send(res, { collections: !filters(url, "handle").length || filters(url, "handle").includes(collection.handle) ? [collection] : [] })
    case "/store/product-categories": return send(res, { product_categories: [] })
    case "/store/product-variants": {
      const ids = filters(url, "id")
      return send(res, { variants: products.flatMap((p) => p.variants.filter((v) => ids.includes(v.id)).map((v) => ({ ...v, product: { id: p.id, title: p.title, handle: p.handle, thumbnail: p.thumbnail } }))) })
    }
    case "/store/products": {
      const handles = filters(url, "handle"), ids = filters(url, "id")
      const filtered = products.filter((p) => (!handles.length || handles.includes(p.handle)) && (!ids.length || ids.includes(p.id)))
      const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 24)
      const selected = structuredClone(filtered.slice(offset, offset + limit))
      const fields = url.searchParams.get('fields') || ''
      if (fields && !fields.includes('calculated_price')) {
        for (const product of selected) for (const variant of product.variants) delete variant.calculated_price
      }
      if (fields && !fields.includes('variants.metadata') && !fields.includes('*variants')) {
        for (const product of selected) for (const variant of product.variants) delete variant.metadata
      }
      return send(res, { products: selected, count: filtered.length, offset, limit })
    }
    case "/store/product-variants": {
      const ids = filters(url, 'id')
      const variants = products.flatMap(product => product.variants).filter(variant => !ids.length || ids.includes(variant.id))
      return send(res, { variants, count: variants.length, offset: 0, limit: Number(url.searchParams.get('limit') || 100) })
    }
    case "/store/carts": {
      const cart = { id: `cart_test_${carts.size}`, currency_code: "bdt", items: [], subtotal: 0, item_subtotal: 0, total: 0 }
      carts.set(cart.id, cart)
      return send(res, { cart })
    }
  }
  if (url.pathname.startsWith("/store/collection-pages/")) return send(res, { page: null })
  const cartMatch = url.pathname.match(/^\/store\/carts\/([^/]+)(\/line-items)?(?:\/([^/]+))?$/)
  if (cartMatch) {
    const cart = carts.get(cartMatch[1])
    if (!cart) return send(res, { message: "No test cart" }, 404)
    if (cartMatch[2] && cart.completed_at) return send(res, { message: "Test cart completed" }, 409)
    if (cartMatch[3]) {
      const item = cart.items.find((line) => line.id === cartMatch[3])
      if (!item) return send(res, { message: "No test cart item" }, 404)
      if (req.method === "DELETE") cart.items = cart.items.filter((line) => line.id !== item.id)
      else if (req.method === "POST" && Number.isInteger(data.quantity) && data.quantity > 0) item.quantity = data.quantity
      else return send(res, { message: "Invalid item quantity" }, 400)
      recalculateCart(cart)
      return send(res, req.method === "DELETE" ? { id: item.id, object: "line-item", deleted: true, parent: cart } : { cart })
    }
    if (cartMatch[2] && req.method === "POST") {
      const product = products.find((p) => p.variants.some((v) => v.id === data.variant_id))
      const variant = product?.variants.find((v) => v.id === data.variant_id)
      if (!variant) return send(res, { message: "Unknown test variant" }, 400)
      if (!Number.isInteger(data.quantity) || data.quantity < 1) return send(res, { message: "Invalid item quantity" }, 400)
      const existing = cart.items.find((item) => item.variant.id === variant.id)
      if (existing) existing.quantity += data.quantity
      else cart.items.push({ id: `item_${cart.id}_${metrics.length}`, title: product.title, quantity: data.quantity,
        unit_price: variant.calculated_price.calculated_amount, fixture_base_price: variant.calculated_price.calculated_amount,
        thumbnail: product.thumbnail, variant: { ...variant, product } })
      recalculateCart(cart)
    }
    return send(res, { cart })
  }
  return send(res, { message: `Unmocked route ${url.pathname}` }, 404)
})
server.listen(Number(process.env.MOCK_STORE_PORT ?? 9901), "127.0.0.1", () => {
  console.log(`Local fixture API on 127.0.0.1:${server.address().port}`)
})
