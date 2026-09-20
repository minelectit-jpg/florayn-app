const http = require("node:http")

// Local, disposable fixtures only. No request is forwarded to a real service.
const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="540" height="540" fill="#eee6fa"/><rect x="165" y="60" width="210" height="420" rx="36" fill="#8d66b1"/><text x="270" y="285" text-anchor="middle" fill="white" font-size="26">Test case</text></svg>')
const devices = [
  { id: "dev_16", slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", family: "iphone", brand: "Apple" },
  { id: "dev_17", slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", family: "iphone", brand: "Apple" },
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
const products = [makeProduct("audit-bloom", "Audit Bloom"), makeProduct("audit-midnight", "Audit Midnight"), makeProduct("audit-bloom", "Audit Bloom", "airpods")]
const content = {
  sections: [{ key: "releases", type: "product_carousel", title: "Test products", config: { limit: 5 } }],
  primary: [{ id: "menu_phone", label: "Phone Case", href: "/shop/iphone-17-pro-max/signature/", groups: [] }],
  footer: [], footerNote: "Local verification", social: [],
}
const bundle = { settings: { heading: "Choose a pack", single_label: "Single", free_shipping_threshold: 3000, scope: "cases", is_active: true, matching_set_enabled: true, matching_set_discount: 250, matching_set_default_airpods: "AirPods Pro 3" }, tiers: [{ id: "tier_two", quantity: 2, badge: null, discount_amount: 200, min_pct: 0, max_pct: 0 }] }
const stock = Object.fromEntries(caseTypes.flatMap((c) => c.devices.map((d) => [`${c.name}|${d.name}`, 20])))
const carts = new Map()
const metrics = []
let revision = 0
let stockRevision = 0
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
    revision, stockRevision,
    requests: metrics.reduce((counts, item) => {
      counts[item.path] = (counts[item.path] ?? 0) + 1
      return counts
    }, {}),
  })
  metrics.push({ path: url.pathname, method: req.method, fields: url.searchParams.get("fields"), handles: filters(url, "handle") })
  let body = ""
  for await (const chunk of req) body += chunk
  const data = body ? JSON.parse(body) : {}
  if (url.pathname === "/__test/revision" && req.method === "POST") {
    if (!Number.isInteger(data.revision) || data.revision < 0 ||
        (data.stockRevision !== undefined && (!Number.isInteger(data.stockRevision) || data.stockRevision < 0))) {
      return send(res, { message: "Expected nonnegative integer revision and optional stockRevision" }, 400)
    }
    revision = data.revision
    if (data.stockRevision !== undefined) stockRevision = data.stockRevision
    return send(res, { revision, stockRevision })
  }
  switch (url.pathname) {
    case "/store/regions": return send(res, { regions: [{ id: "reg_test", currency_code: "bdt", name: "Bangladesh" }] })
    case "/store/devices": return send(res, { devices })
    case "/store/case-types": return send(res, { case_types: caseTypes })
    case "/store/stock": return send(res, { stock: Object.fromEntries(Object.entries(stock).map(([key, quantity]) => [key, quantity + stockRevision])) })
    case "/store/content": return send(res, { ...content, footerNote: `Local verification revision ${revision}` })
    case "/store/bundles": return send(res, bundle)
    case "/store/content/product-sections": return send(res, { featureBlocks: [], featuredPicks: ["audit-midnight"] })
    case "/store/content/gallery-videos": return send(res, { videos: {} })
    case "/store/seo": return send(res, { templates: { title: "{design} {device} Case", description: "{design} test case for {device}", heading: "{design} {device} Case", fit_copy_enabled: true }, overrides: [] })
    case "/store/shop-catalog": {
      // Form-scope like the real route: a device query returns only that form's
      // designs and constructions; AirPods resolve to signature-earbuds.
      const deviceObj = devices.find((d) => d.slug === url.searchParams.get("device"))
      const targetForm = deviceObj ? (deviceObj.family === "iphone" || deviceObj.family === "samsung" ? "phone" : deviceObj.family) : null
      const bySlug = new Map()
      for (const p of products) {
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
      const cart = { id: `cart_test_${carts.size}`, currency_code: "bdt", items: [], subtotal: 0, total: 0 }
      carts.set(cart.id, cart)
      return send(res, { cart })
    }
  }
  if (url.pathname.startsWith("/store/collection-pages/")) return send(res, { page: null })
  const cartMatch = url.pathname.match(/^\/store\/carts\/([^/]+)(\/line-items)?$/)
  if (cartMatch) {
    const cart = carts.get(cartMatch[1])
    if (!cart) return send(res, { message: "No test cart" }, 404)
    if (cartMatch[2] && req.method === "POST") {
      const product = products.find((p) => p.variants.some((v) => v.id === data.variant_id))
      const variant = product?.variants.find((v) => v.id === data.variant_id)
      if (!variant) return send(res, { message: "Unknown test variant" }, 400)
      cart.items.push({ id: `item_${cart.items.length}`, title: product.title, quantity: data.quantity, unit_price: variant.calculated_price.calculated_amount, thumbnail: product.thumbnail, variant: { ...variant, product } })
      cart.subtotal = cart.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      cart.total = cart.subtotal
    }
    return send(res, { cart })
  }
  return send(res, { message: `Unmocked route ${url.pathname}` }, 404)
})
server.listen(Number(process.env.MOCK_STORE_PORT ?? 9901), "127.0.0.1", () => {
  console.log(`Local fixture API on 127.0.0.1:${server.address().port}`)
})
