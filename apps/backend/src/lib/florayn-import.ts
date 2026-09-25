import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import { localMobile, NO_EMAIL_DOMAIN, realEmail } from "./contact"
import { buildCatalog, matchLine, type LineMatch } from "./florayn-import-match"
import { opsService, type WorkflowStatus } from "./order-ops"

/**
 * Bring florayn.com's order history (WooCommerce) into this store, so every
 * old customer and order is listed in the admin.
 *
 * - Read-only on florayn.com: WooCommerce REST API v3 with a Read key.
 * - Orders are written with the Order module directly: no stock is reserved
 *   or checked, no promotions or taxes are recomputed, no "order placed"
 *   event fires (so no emails). Totals are WooCommerce's own: each line's
 *   price is what the customer paid for it, fees and delivery as charged.
 * - A customer is matched by real email, else by mobile (the same
 *   `<phone>@no-email.florayn.local` placeholder checkout uses), so a phone
 *   number's old and new orders land on one customer.
 * - `imported_order` remembers which WooCommerce order became which order:
 *   running it again adds new orders and moves changed statuses, never
 *   duplicates. Imported orders are marked `source: florayn.com` on their
 *   workflow row: never booked with the courier or asked for a review here.
 * - When the mapping improves, IMPORT_VERSION goes up and the next run
 *   rebuilds older imports in place: the order is created afresh under its
 *   old number, its workflow row (status, note) moves across, then the old
 *   copy is deleted. florayn.com stays the source, so nothing is lost.
 */
export const IMPORT_SOURCE = "florayn.com"
/** 2: totals = what was paid (advance + COD), items linked to this store's products. */
export const IMPORT_VERSION = 2
const PAGE = 50

type Money = string | number | null | undefined
export type WcAddress = { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; email?: string | null; phone?: string }
export type WcMeta = { id?: number; key: string; value: unknown; display_key?: string; display_value?: unknown }
export type WcLine = { id: number; name: string; product_id: number; variation_id?: number; quantity: number; subtotal: Money; total: Money; sku?: string; meta_data?: WcMeta[]; image?: { src?: string } | null; parent_name?: string | null }
export type WcOrder = {
  id: number
  number?: string
  status: string
  currency?: string
  date_created_gmt?: string | null
  date_modified_gmt?: string | null
  date_completed_gmt?: string | null
  date_paid_gmt?: string | null
  total: Money
  shipping_total?: Money
  discount_total?: Money
  customer_note?: string
  payment_method?: string
  payment_method_title?: string
  billing?: WcAddress
  shipping?: WcAddress
  line_items?: WcLine[]
  shipping_lines?: { id?: number; method_title?: string; total: Money }[]
  fee_lines?: { id?: number; name?: string; total: Money }[]
  coupon_lines?: { code?: string; discount?: Money }[]
  meta_data?: WcMeta[]
}

/** WooCommerce status -> this store's workflow tab and Medusa order status. Unknown/draft statuses are not imported. */
const STATUS_MAP: Record<string, [WorkflowStatus, "completed" | "canceled" | "pending"]> = {
  completed: ["delivered", "completed"],
  "otm-delivered": ["delivered", "completed"],
  "otm-partial-del": ["delivered", "completed"],
  pending: ["processing", "pending"],
  processing: ["processing", "pending"],
  "on-hold": ["processing", "pending"],
  "otm-confirmed": ["confirmed", "pending"],
  printing: ["confirmed", "pending"],
  printed: ["confirmed", "pending"],
  "ready-for-delive": ["confirmed", "pending"],
  "otm-ready-for": ["confirmed", "pending"],
  "otm-in-transit": ["shipped", "pending"],
  "otm-zone-chan": ["shipped", "pending"],
  "otm-returned": ["returned", "canceled"],
  refunded: ["refunded", "canceled"],
  cancelled: ["cancelled", "canceled"],
  failed: ["cancelled", "canceled"],
  fraud: ["cancelled", "canceled"],
}

export function mapWcStatus(status: string): { workflow: WorkflowStatus; order: "completed" | "canceled" | "pending" } | null {
  const hit = STATUS_MAP[String(status ?? "").replace(/^wc-/, "")]
  return hit ? { workflow: hit[0], order: hit[1] } : null
}

/** WooCommerce's Bangladesh state codes (ISO 3166-2:BD) as district names. */
const BD_DISTRICTS: Record<string, string> = {
  "01": "Bandarban", "02": "Barguna", "03": "Bogura", "04": "Brahmanbaria", "05": "Bagerhat", "06": "Barishal", "07": "Bhola", "08": "Cumilla",
  "09": "Chandpur", "10": "Chattogram", "11": "Cox's Bazar", "12": "Chuadanga", "13": "Dhaka", "14": "Dinajpur", "15": "Faridpur", "16": "Feni",
  "17": "Gopalganj", "18": "Gazipur", "19": "Gaibandha", "20": "Habiganj", "21": "Jamalpur", "22": "Jashore", "23": "Jhenaidah", "24": "Joypurhat",
  "25": "Jhalokati", "26": "Kishoreganj", "27": "Khulna", "28": "Kurigram", "29": "Khagrachhari", "30": "Kushtia", "31": "Lakshmipur", "32": "Lalmonirhat",
  "33": "Manikganj", "34": "Mymensingh", "35": "Munshiganj", "36": "Madaripur", "37": "Magura", "38": "Moulvibazar", "39": "Meherpur", "40": "Narayanganj",
  "41": "Netrokona", "42": "Narsingdi", "43": "Narail", "44": "Natore", "45": "Chapai Nawabganj", "46": "Nilphamari", "47": "Noakhali", "48": "Naogaon",
  "49": "Pabna", "50": "Pirojpur", "51": "Patuakhali", "52": "Panchagarh", "53": "Rajbari", "54": "Rajshahi", "55": "Rangpur", "56": "Rangamati",
  "57": "Sherpur", "58": "Satkhira", "59": "Sirajganj", "60": "Sylhet", "61": "Sunamganj", "62": "Shariatpur", "63": "Tangail", "64": "Thakurgaon",
}

export function districtName(state: unknown): string {
  const value = String(state ?? "").trim()
  const code = value.match(/^BD-(\d{2})$/i)?.[1]
  return code ? BD_DISTRICTS[code] ?? value : value
}

/** A WooCommerce money string as a number of taka (two decimals at most). */
export function money(value: Money): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

const text = (value: unknown, max = 250) => String(value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max)

/** The customer and delivery details of an order, preferring the shipping fields that were filled in. */
export function orderContact(wc: WcOrder) {
  const b = wc.billing ?? {}
  const s = wc.shipping ?? {}
  const pick = (key: keyof WcAddress) => text(s[key]) || text(b[key])
  const rawPhone = text(b.phone) || text(s.phone)
  const phone = localMobile(rawPhone) ?? (rawPhone || null)
  const email = realEmail(b.email)
  const first = pick("first_name")
  const last = pick("last_name")
  return {
    email,
    phone,
    /** What the order is stored under: the real email, else checkout's placeholder for the phone. */
    orderEmail: email ?? `${localMobile(rawPhone) ?? `wc-${wc.id}`}@${NO_EMAIL_DOMAIN}`,
    first_name: first,
    last_name: last,
    address: {
      first_name: first,
      last_name: last,
      phone: phone ?? "",
      address_1: pick("address_1"),
      address_2: pick("address_2"),
      city: pick("city"),
      province: districtName(s.state || b.state),
      postal_code: pick("postcode"),
      country_code: "bd",
    },
  }
}

/** A line item's chosen options (Device, Case type…), without WooCommerce's hidden `_` keys. */
export function lineOptions(line: WcLine): { name: string; value: string }[] {
  return (line.meta_data ?? [])
    .filter((m) => typeof m.key === "string" && !m.key.startsWith("_"))
    .map((m) => ({ name: text(m.display_key ?? m.key, 60), value: text(m.display_value ?? m.value, 120) }))
    .filter((o) => o.name && o.value && !/^[[{]/.test(o.value))
    .slice(0, 10)
}

/** A WooCommerce order's meta value by key (the first one). */
function metaValue(wc: WcOrder, key: string): unknown {
  return (wc.meta_data ?? []).find((m) => m.key === key)?.value
}

/** A numeric meta value, or null when it is missing or blank ("0" is 0). */
function metaNumber(wc: WcOrder, key: string): number | null {
  const value = metaValue(wc, key)
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? money(n) : null
}

/**
 * What the customer actually paid. florayn.com's order manager keeps a bKash
 * advance and the courier's cash-on-delivery amount apart from WooCommerce's
 * `total`, which is sometimes only what was left to collect (0, or just the
 * delivery charge, after a full advance) and sometimes edited by hand (a
 * bundle price, a surcharge). Paid = COD booked with the courier + advance.
 * Without a courier booking, `total` (+ the advance, when `total` is only the
 * remainder) is the best measure: whichever is closer to the items' own sum.
 */
export function paidAmounts(wc: WcOrder, linesTotal: number) {
  const advance = metaNumber(wc, "_otm_advance_paid_amount") || metaNumber(wc, "_advance_paid_amount") || metaNumber(wc, "_florayn_qo_advance") || 0
  const courierCod = metaNumber(wc, "_otm_courier_cod_amount")
  const total = money(wc.total)
  if (courierCod !== null) return { paid: money(courierCod + advance), advance, cod: courierCod }
  if (advance > 0 && Math.abs(total + advance - linesTotal) < Math.abs(total - linesTotal)) return { paid: money(total + advance), advance, cod: total }
  return { paid: total, advance: Math.min(advance, total), cod: money(total - Math.min(advance, total)) }
}

/** florayn.com's payment method in words. */
function paymentWords(wc: WcOrder, advance: number, cod: number): string {
  const method = String(wc.payment_method ?? "")
  if (advance > 0 && cod > 0) return "bKash advance + cash on delivery"
  if (advance > 0) return "Paid in advance (bKash)"
  if (/bkash/i.test(method)) return "bKash"
  return text(wc.payment_method_title, 80) || (method === "cod" ? "Cash on delivery" : method) || "Cash on delivery"
}

/** How far an imported order's items + delivery must move to equal what was paid. */
export const ADJUSTMENT_TITLE = "Price adjustment on florayn.com"

/**
 * One WooCommerce order as Medusa order input, plus what the importer needs
 * around it. Pure: the region, sales channel, customer and the line matcher
 * are passed in.
 *
 * Items keep their florayn.com name and price; each is linked to this store's
 * product when its name matches (see florayn-import-match.ts), with our own
 * image. The order total is what the customer paid: when that differs from
 * items + delivery, an adjustment says so (a credit when less was paid, an
 * extra line when more was).
 */
export function mapWcOrder(
  wc: WcOrder,
  ctx: { regionId: string; salesChannelId?: string | null; customerId: string; match?: (title: string) => LineMatch | null; displayId?: number | null }
) {
  const status = mapWcStatus(wc.status)
  if (!status) return null
  const contact = orderContact(wc)
  let linked = 0
  const items: any[] = (wc.line_items ?? []).map((line) => {
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1))
    const total = money(line.total)
    const options = lineOptions(line)
    const title = text(line.name, 200) || "Item"
    const match = ctx.match?.(title) ?? null
    if (match) linked++
    return {
      title,
      quantity,
      unit_price: Math.round((total / quantity) * 100) / 100,
      thumbnail: match?.image || match?.product.thumbnail || line.image?.src || null,
      ...(match
        ? { product_id: match.product.id, product_handle: match.product.handle, product_title: match.product.designName || match.product.title, ...(match.variant ? { variant_id: match.variant.id } : {}) }
        : { product_title: text(line.parent_name || line.name, 200) }),
      variant_title: options.map((o) => o.value).join(" / ") || match?.device || null,
      variant_sku: line.sku || null,
      requires_shipping: true,
      is_discountable: false,
      metadata: { wc_line_id: line.id, wc_product_id: line.product_id, wc_variation_id: line.variation_id ?? 0, options, wc_subtotal: money(line.subtotal), ...(match?.device ? { device: match.device } : {}) },
    }
  })
  const credit_lines: { amount: number; reference: string; reference_id: string; metadata: Record<string, unknown> }[] = []
  for (const fee of wc.fee_lines ?? []) {
    const amount = money(fee.total)
    if (amount > 0) items.push({ title: text(fee.name, 200) || "Fee", quantity: 1, unit_price: amount, thumbnail: null, product_title: text(fee.name, 200) || "Fee", variant_title: null, variant_sku: null, requires_shipping: false, is_discountable: false, metadata: { wc_fee: true } })
    else if (amount < 0) credit_lines.push({ amount: -amount, reference: "florayn.com discount", reference_id: String(fee.id ?? ""), metadata: { name: text(fee.name, 200) } })
  }
  const shipping_methods = (wc.shipping_lines ?? []).map((line) => ({ name: text(line.method_title, 120) || "Delivery", amount: money(line.total), data: {} }))
  if (!shipping_methods.length && money(wc.shipping_total) > 0) shipping_methods.push({ name: "Delivery", amount: money(wc.shipping_total), data: {} })

  const sum = () => money(items.reduce((n, i) => n + i.unit_price * i.quantity, 0) + shipping_methods.reduce((n, s) => n + s.amount, 0) - credit_lines.reduce((n, c) => n + c.amount, 0))
  const linesTotal = sum()
  const { paid, advance, cod } = paidAmounts(wc, linesTotal)
  const adjustment = money(paid - linesTotal)
  if (adjustment <= -1) {
    credit_lines.push({ amount: -adjustment, reference: ADJUSTMENT_TITLE, reference_id: String(wc.id), metadata: { lines_total: linesTotal, paid } })
  } else if (adjustment >= 1) {
    items.push({ title: ADJUSTMENT_TITLE, quantity: 1, unit_price: adjustment, thumbnail: null, product_title: ADJUSTMENT_TITLE, variant_title: null, variant_sku: null, requires_shipping: false, is_discountable: false, metadata: { wc_adjustment: true, lines_total: linesTotal, paid } })
  }
  const wcTotal = money(wc.total)
  const createdAt = parseWcDate(wc.date_created_gmt) ?? new Date()
  const statusAt = parseWcDate(wc.date_completed_gmt) ?? parseWcDate(wc.date_modified_gmt) ?? createdAt
  const tracking = text(metaValue(wc, "_otm_courier_tracking_code"), 60) || null
  return {
    status,
    contact,
    createdAt,
    statusChangedAt: statusAt,
    modifiedAt: parseWcDate(wc.date_modified_gmt),
    totals: { lines: linesTotal, paid, wc: wcTotal, advance, cod, total: sum(), adjusted: Math.abs(adjustment) >= 1 },
    linked: { lines: (wc.line_items ?? []).length, matched: linked },
    input: {
      ...(ctx.displayId ? { display_id: ctx.displayId } : {}),
      region_id: ctx.regionId,
      ...(ctx.salesChannelId ? { sales_channel_id: ctx.salesChannelId } : {}),
      customer_id: ctx.customerId,
      email: contact.orderEmail,
      currency_code: "bdt",
      status: status.order,
      no_notification: true,
      shipping_address: contact.address,
      billing_address: contact.address,
      items,
      shipping_methods,
      ...(credit_lines.length ? { credit_lines } : {}),
      metadata: {
        source: IMPORT_SOURCE,
        wc_order_id: String(wc.id),
        wc_order_number: String(wc.number ?? wc.id),
        wc_status: wc.status,
        wc_total: wcTotal,
        wc_discount_total: money(wc.discount_total),
        coupon_codes: (wc.coupon_lines ?? []).map((c) => text(c.code, 60)).filter(Boolean),
        payment_method: paymentWords(wc, advance, cod),
        advance_paid: advance,
        cod_amount: cod,
        paid_at: wc.date_paid_gmt ? parseWcDate(wc.date_paid_gmt)?.toISOString() ?? null : null,
        order_note: text(wc.customer_note, 1000) || null,
        customer_phone: contact.phone,
        customer_has_email: Boolean(contact.email),
        district: contact.address.province || null,
        ...(tracking ? { tracking_code: tracking, courier: "Steadfast", consignment_id: text(metaValue(wc, "_otm_courier_consignment_id"), 40) || null } : {}),
        ...(Math.abs(adjustment) >= 1 ? { total_adjusted: { lines: linesTotal, paid } } : {}),
        import_version: IMPORT_VERSION,
      },
    },
  }
}

/** WooCommerce's *_gmt dates come without a zone. */
export function parseWcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}


// ---------------------------------------------------------------- settings --

export type ImportProgress = {
  total: number
  seen: number
  created: number
  /** Older imports rebuilt with the current mapping (IMPORT_VERSION). */
  rebuilt: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  /** Orders whose items + delivery differ from what was paid, so an adjustment was added. */
  adjusted: number
  /** Line items linked to a product in this store, of all line items written. */
  linked: number
  lines: number
  /** Older imports whose order florayn.com no longer lists (left as they are). */
  missing: number
  errors: { id: string; message: string }[]
}

export const emptyProgress = (): ImportProgress => ({ total: 0, seen: 0, created: 0, rebuilt: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, adjusted: 0, linked: 0, lines: 0, missing: 0, errors: [] })

export async function getImportSettings(container: any): Promise<any> {
  const svc = opsService(container)
  const [row] = await svc.listOrderImports({}, { take: 1 })
  return row ?? (await svc.createOrderImports({}))
}

export function presentImport(s: any) {
  const mask = (v: string | null) => (v && v.length > 8 ? `${v.slice(0, 3)}••••••${v.slice(-4)}` : v ? "••••" : "")
  const running = s.state === "running" && !isStale(s)
  return {
    site_url: s.site_url,
    consumer_key_masked: mask(s.consumer_key ?? null),
    consumer_secret_set: Boolean(s.consumer_secret),
    ready: Boolean(s.consumer_key && s.consumer_secret),
    state: s.state === "running" && !running ? "failed" : s.state,
    progress: s.progress ?? null,
    started_at: s.started_at ?? null,
    finished_at: s.finished_at ?? null,
    last_error: s.state === "running" && !running ? "The last run stopped part-way (the server restarted). Run it again: it carries on where it stopped." : s.last_error ?? null,
  }
}

/** A run that has not reported for ten minutes died with its server. */
function isStale(s: any): boolean {
  return Date.now() - new Date(s.updated_at ?? s.started_at ?? 0).getTime() > 10 * 60_000
}

/** How many imported orders an older IMPORT_VERSION made (the next run rebuilds them). */
export async function outdatedImports(container: any): Promise<number> {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const [{ count }] = await knex("order")
    .whereNull("deleted_at")
    .whereRaw("metadata->>'source' = ?", [IMPORT_SOURCE])
    .whereRaw("coalesce(metadata->>'wc_missing', 'false') <> 'true'")
    .andWhere((w: any) => w.whereRaw("metadata->>'import_version' is null").orWhereRaw("(metadata->>'import_version')::int < ?", [IMPORT_VERSION]))
    .count({ count: "id" })
  return Number(count) || 0
}

// ------------------------------------------------------------ WooCommerce --

type Fetch = typeof fetch

/**
 * GET from florayn.com's WooCommerce REST API. The key goes in the
 * Authorization header; hosts that strip it get it as query parameters
 * (HTTPS only), as WooCommerce documents.
 */
export async function wcGet(s: { site_url: string; consumer_key: string; consumer_secret: string }, path: string, params: Record<string, string | number>, fetchImpl: Fetch = fetch) {
  const site = String(s.site_url || "").replace(/\/+$/, "")
  if (!/^https:\/\//.test(site)) throw new Error("The shop address must start with https://")
  const url = new URL(`${site}/wp-json/wc/v3/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const call = async (target: URL, headers: Record<string, string>) => {
    const res = await fetchImpl(target, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(60_000) })
    return { res, body: (await res.json().catch(() => null)) as any }
  }
  let { res, body } = await call(url, { Authorization: `Basic ${Buffer.from(`${s.consumer_key}:${s.consumer_secret}`).toString("base64")}` })
  if (res.status === 401) {
    const withKey = new URL(url)
    withKey.searchParams.set("consumer_key", s.consumer_key)
    withKey.searchParams.set("consumer_secret", s.consumer_secret)
    ;({ res, body } = await call(withKey, {}))
  }
  if (!res.ok) {
    const reason = body?.message ? String(body.message).replace(/<[^>]*>/g, "") : `answered ${res.status}`
    throw new Error(res.status === 401 ? `florayn.com refused the key (${reason}). Check it has Read access.` : `florayn.com: ${reason}`)
  }
  return { data: body, total: Number(res.headers.get("x-wp-total") ?? 0), pages: Number(res.headers.get("x-wp-totalpages") ?? 0) }
}

/** This store's products with their options, for matching florayn.com line items by name. */
export async function loadLineMatcher(container: any): Promise<(title: string) => LineMatch | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "thumbnail", "metadata", "variants.id", "variants.metadata", "variants.options.value", "variants.options.option.title"],
    filters: { status: "published" },
  })
  const catalog = buildCatalog(data ?? [])
  const cache = new Map<string, LineMatch | null>()
  return (title: string) => {
    if (!cache.has(title)) cache.set(title, matchLine(title, catalog))
    return cache.get(title) ?? null
  }
}

/** The customer an imported order belongs to: found by email (an account first), else created as a guest. */
async function customerFor(container: any, contact: ReturnType<typeof orderContact>): Promise<string> {
  const customers: any = container.resolve(Modules.CUSTOMER)
  const found = await customers.listCustomers({ email: contact.orderEmail }, { take: 5, select: ["id", "has_account"] })
  const existing = found.find((c: any) => c.has_account) ?? found[0]
  if (existing) return existing.id
  const created = await customers.createCustomers({
    email: contact.orderEmail,
    first_name: contact.first_name || null,
    last_name: contact.last_name || null,
    phone: contact.phone,
    has_account: false,
    metadata: { source: IMPORT_SOURCE },
  })
  return created.id
}

// ------------------------------------------------------------------ runner --

let running = false

/** Store progress on the settings row (throttled by the caller to once per page). */
async function saveProgress(container: any, id: string, patch: Record<string, unknown>) {
  await opsService(container).updateOrderImports({ id, ...patch })
}

/**
 * One import run over every florayn.com order, oldest first. Each order is
 * its own step: one that fails is recorded and the rest carry on. Safe to run
 * again at any time: it adds new orders, moves changed statuses, and rebuilds
 * imports made by an older IMPORT_VERSION under their own order numbers.
 */
export async function runFloraynImport(container: any, fetchImpl: Fetch = fetch): Promise<ImportProgress> {
  if (running) throw new Error("An import is already running.")
  running = true
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc = opsService(container)
  const settings = await getImportSettings(container)
  const progress = emptyProgress()
  try {
    if (!settings.consumer_key || !settings.consumer_secret) throw new Error("Save the WooCommerce key first.")
    await saveProgress(container, settings.id, { state: "running", started_at: new Date(), finished_at: null, last_error: null, progress })
    const [region] = await container.resolve(Modules.REGION).listRegions({ currency_code: "bdt" }, { take: 1, select: ["id"] })
    if (!region) throw new Error("There is no taka (BDT) region to import orders into.")
    const [store] = await container.resolve(Modules.STORE).listStores({}, { take: 1, select: ["id", "default_sales_channel_id"] })
    const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const orders: any = container.resolve(Modules.ORDER)
    const match = await loadLineMatcher(container)
    const base = { regionId: region.id, salesChannelId: store?.default_sales_channel_id ?? null, match }

    /** Write one mapped order under its date (and old number, on a rebuild). */
    const write = async (mapped: NonNullable<ReturnType<typeof mapWcOrder>>, displayId: number | null) => {
      if (mapped.totals.adjusted) progress.adjusted++
      progress.lines += mapped.linked.lines
      progress.linked += mapped.linked.matched
      const created = await orders.createOrders(mapped.input)
      await knex("order").where({ id: created.id }).update({
        created_at: mapped.createdAt,
        updated_at: mapped.modifiedAt ?? mapped.createdAt,
        ...(displayId ? { display_id: displayId } : {}),
      })
      return created
    }

    const content: any = container.resolve(CONTENT_MODULE)
    const upToDate = (order: any) => Number(order?.metadata?.import_version) === IMPORT_VERSION
    const seen = new Set<string>()

    for (let page = 1; ; page++) {
      const { data, total } = await wcGet(settings, "orders", { per_page: PAGE, page, orderby: "id", order: "asc" }, fetchImpl)
      const batch: WcOrder[] = Array.isArray(data) ? data : []
      if (page === 1) progress.total = total || batch.length
      if (!batch.length) break
      const wcIds = batch.map((o) => String(o.id))
      const known = await svc.listImportedOrders({ source: IMPORT_SOURCE, source_id: wcIds }, { take: batch.length })
      const bySource = new Map<string, any>(known.map((row: any) => [row.source_id, row]))
      // Every copy of these orders here, including any an interrupted run left.
      const copyRows: any[] = await knex("order")
        .whereNull("deleted_at")
        .whereRaw("metadata->>'source' = ?", [IMPORT_SOURCE])
        .whereIn(knex.raw("metadata->>'wc_order_id'"), wcIds)
        .select("id", "display_id", "customer_id", "metadata")
      const copiesByWc = new Map<string, any[]>()
      for (const row of copyRows) {
        const key = String(row.metadata?.wc_order_id)
        copiesByWc.set(key, [...(copiesByWc.get(key) ?? []), row])
      }

      for (const wc of batch) {
        progress.seen++
        const wcId = String(wc.id)
        seen.add(wcId)
        try {
          const status = mapWcStatus(wc.status)
          if (!status) { progress.skipped++; continue }
          const existing = bySource.get(wcId) ?? null
          const copies = copiesByWc.get(wcId) ?? []
          const current = existing ? copies.find((o) => o.id === existing.order_id) ?? null : null

          if (existing && current && upToDate(current) && copies.length === 1) {
            if (existing.source_status === wc.status) { progress.unchanged++; continue }
            const [op] = await svc.listOrderOps({ order_id: current.id }, { take: 1 })
            const changedAt = parseWcDate(wc.date_modified_gmt) ?? new Date()
            if (op) await svc.updateOrderOps({ id: op.id, workflow_status: status.workflow, status_changed_at: changedAt })
            await orders.updateOrders(current.id, { status: status.order, metadata: { ...(current.metadata ?? {}), wc_status: wc.status } })
            await svc.updateImportedOrders({ id: existing.id, source_status: wc.status, source_modified_at: changedAt })
            progress.updated++
            continue
          }

          // Write (or rebuild) the order. Each step can be repeated: a copy this
          // version already wrote is adopted rather than written again, so a run
          // stopped part-way is finished by the next one without duplicates.
          const reused = (current && upToDate(current) ? current : null) ?? copies.find(upToDate) ?? null
          let target: any = reused
          let targetMeta: Record<string, unknown> = reused?.metadata ?? {}
          if (!target) {
            const keepNumber = current?.display_id ?? copies[0]?.display_id ?? null
            const customerId = current?.customer_id ?? copies[0]?.customer_id ?? (await customerFor(container, orderContact(wc)))
            const mapped = mapWcOrder(wc, { ...base, customerId, displayId: keepNumber })!
            target = await write(mapped, keepNumber)
            targetMeta = mapped.input.metadata
          }
          const others = copies.filter((o) => o.id !== target.id)
          const statusAt = parseWcDate(wc.date_completed_gmt) ?? parseWcDate(wc.date_modified_gmt) ?? new Date()
          const moveStatus = !existing || existing.source_status !== wc.status

          // One workflow row: the tracked order's (its status and note), else any copy's.
          const ops: any[] = await svc.listOrderOps({ order_id: [target.id, ...others.map((o) => o.id)] }, { take: 20 })
          const keep = ops.find((op) => op.order_id === existing?.order_id) ?? ops.find((op) => op.order_id === target.id) ?? ops[0] ?? null
          if (keep) {
            await svc.updateOrderOps({ id: keep.id, order_id: target.id, source: IMPORT_SOURCE, ...(moveStatus ? { workflow_status: status.workflow, status_changed_at: statusAt } : {}) })
          } else {
            const fresh = await svc.createOrderOps({ order_id: target.id, workflow_status: status.workflow, status_changed_at: statusAt, source: IMPORT_SOURCE })
            await knex("order_op").where({ id: fresh.id }).update({ created_at: parseWcDate(wc.date_created_gmt) ?? new Date() })
          }
          const extra = ops.filter((op) => op.id !== keep?.id)
          if (extra.length) await svc.deleteOrderOps(extra.map((op) => op.id))

          if (existing) await svc.updateImportedOrders({ id: existing.id, order_id: target.id, source_status: wc.status, source_modified_at: parseWcDate(wc.date_modified_gmt) })
          else await svc.createImportedOrders({ source: IMPORT_SOURCE, source_id: wcId, order_id: target.id, source_status: wc.status, source_modified_at: parseWcDate(wc.date_modified_gmt) })

          if (others.length) {
            // Reviews and review links already sent follow the order to its new id.
            const ids = others.map((o) => o.id)
            const reviews: any[] = await content.listProductReviews({ order_id: ids }, { take: 200, select: ["id"] })
            if (reviews.length) await content.updateProductReviews(reviews.map((r) => ({ id: r.id, order_id: target.id })))
            const replaced = [...new Set([
              ...((targetMeta.replaced_order_ids as string[] | undefined) ?? []),
              ...ids,
              ...others.flatMap((o) => (o.metadata?.replaced_order_ids as string[] | undefined) ?? []),
            ])]
            await orders.updateOrders(target.id, { metadata: { ...targetMeta, replaced_order_ids: replaced } })
            await orders.deleteOrders(ids)
          }
          if (existing) progress.rebuilt++
          else progress.created++
        } catch (error: any) {
          progress.failed++
          if (progress.errors.length < 50) progress.errors.push({ id: wcId, message: String(error?.message ?? error).slice(0, 300) })
        }
      }
      await saveProgress(container, settings.id, { progress })
      if (batch.length < PAGE) break
    }
    // Imports made by an older version whose order florayn.com no longer lists
    // (trashed or deleted there) cannot be rebuilt: mark them, so they stop
    // counting as waiting for a rebuild.
    const imported: any[] = await knex("order")
      .whereNull("deleted_at")
      .whereRaw("metadata->>'source' = ?", [IMPORT_SOURCE])
      .select("id", "metadata")
    const gone = imported.filter((o) => !upToDate(o) && !o.metadata?.wc_missing && !seen.has(String(o.metadata?.wc_order_id))).map((o) => o.id)
    if (gone.length) await knex("order").whereIn("id", gone).update({ metadata: knex.raw("metadata || ?::jsonb", [JSON.stringify({ wc_missing: true })]) })
    progress.missing = gone.length
    // A rebuild writes old numbers back; keep the next new order after the highest one.
    if (progress.rebuilt) {
      await knex.raw(`select setval(pg_get_serial_sequence('"order"', 'display_id'), greatest((select coalesce(max(display_id), 1) from "order"), 1))`)
    }
    await saveProgress(container, settings.id, { state: "done", finished_at: new Date(), progress })
    logger.info(`[florayn-import] ${progress.created} created, ${progress.rebuilt} rebuilt, ${progress.updated} updated, ${progress.unchanged} unchanged, ${progress.skipped} skipped, ${progress.failed} failed, ${progress.adjusted} adjusted, ${progress.linked}/${progress.lines} lines linked`)
    return progress
  } catch (error: any) {
    await saveProgress(container, settings.id, { state: "failed", finished_at: new Date(), progress, last_error: String(error?.message ?? error).slice(0, 500) }).catch(() => undefined)
    throw error
  } finally {
    running = false
  }
}

/**
 * The newest few florayn.com orders as they would be imported, without
 * writing anything: proves the key works and shows the mapping.
 */
export async function previewFloraynImport(container: any, fetchImpl: Fetch = fetch) {
  const settings = await getImportSettings(container)
  if (!settings.consumer_key || !settings.consumer_secret) throw new Error("Save the WooCommerce key first.")
  const { data, total } = await wcGet(settings, "orders", { per_page: 5, page: 1, orderby: "date", order: "desc" }, fetchImpl)
  const batch: WcOrder[] = Array.isArray(data) ? data : []
  const match = await loadLineMatcher(container)
  const already = await opsService(container).listAndCountImportedOrders({ source: IMPORT_SOURCE }, { take: 1, select: ["id"] })
  return {
    total,
    imported: already[1],
    orders: batch.map((wc) => {
      const mapped = mapWcOrder(wc, { regionId: "preview", customerId: "preview", match })
      if (!mapped) return { number: String(wc.number ?? wc.id), status: wc.status, skipped: true }
      return {
        number: String(wc.number ?? wc.id),
        date: mapped.createdAt.toISOString(),
        status: wc.status,
        becomes: mapped.status.workflow,
        name: [mapped.contact.first_name, mapped.contact.last_name].filter(Boolean).join(" "),
        phone: mapped.contact.phone,
        email: mapped.contact.email,
        district: mapped.contact.address.province,
        items: mapped.input.items.map((i: any) => ({ title: i.title, quantity: i.quantity, price: i.unit_price, options: i.variant_title, linked: Boolean(i.product_id) })),
        delivery: mapped.input.shipping_methods.reduce((n, s) => n + s.amount, 0),
        total: mapped.totals.paid,
        advance: mapped.totals.advance,
        adjusted: mapped.totals.adjusted,
        payment: mapped.input.metadata.payment_method,
      }
    }),
  }
}
