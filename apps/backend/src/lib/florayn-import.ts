import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { localMobile, NO_EMAIL_DOMAIN, realEmail } from "./contact"
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
 */
export const IMPORT_SOURCE = "florayn.com"
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
export type MatchedProduct = { id: string; handle: string; title: string; thumbnail: string | null }

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

/**
 * One WooCommerce order as Medusa order input, plus what the importer needs
 * around it. Pure: the region, sales channel, customer and matched products
 * are passed in.
 */
export function mapWcOrder(
  wc: WcOrder,
  ctx: { regionId: string; salesChannelId?: string | null; customerId: string; products: Map<number, MatchedProduct> }
) {
  const status = mapWcStatus(wc.status)
  if (!status) return null
  const contact = orderContact(wc)
  const items = (wc.line_items ?? []).map((line) => {
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1))
    const total = money(line.total)
    const options = lineOptions(line)
    const match = ctx.products.get(Number(line.product_id))
    return {
      title: text(line.name, 200) || "Item",
      quantity,
      unit_price: Math.round((total / quantity) * 100) / 100,
      thumbnail: match?.thumbnail || line.image?.src || null,
      ...(match ? { product_id: match.id, product_handle: match.handle, product_title: match.title } : { product_title: text(line.parent_name || line.name, 200) }),
      variant_title: options.map((o) => o.value).join(" / ") || null,
      variant_sku: line.sku || null,
      requires_shipping: true,
      is_discountable: false,
      metadata: { wc_line_id: line.id, wc_product_id: line.product_id, wc_variation_id: line.variation_id ?? 0, options, wc_subtotal: money(line.subtotal) },
    }
  })
  const credit_lines: { amount: number; reference: string; reference_id: string; metadata: Record<string, unknown> }[] = []
  for (const fee of wc.fee_lines ?? []) {
    const amount = money(fee.total)
    if (amount > 0) items.push({ title: text(fee.name, 200) || "Fee", quantity: 1, unit_price: amount, thumbnail: null, product_title: text(fee.name, 200) || "Fee", variant_title: null, variant_sku: null, requires_shipping: false, is_discountable: false, metadata: { wc_fee: true } as any })
    else if (amount < 0) credit_lines.push({ amount: -amount, reference: "florayn.com discount", reference_id: String(fee.id ?? ""), metadata: { name: text(fee.name, 200) } })
  }
  const shipping_methods = (wc.shipping_lines ?? []).map((line) => ({ name: text(line.method_title, 120) || "Delivery", amount: money(line.total), data: {} }))
  if (!shipping_methods.length && money(wc.shipping_total) > 0) shipping_methods.push({ name: "Delivery", amount: money(wc.shipping_total), data: {} })

  const computed = Math.round((items.reduce((n, i) => n + i.unit_price * i.quantity, 0) + shipping_methods.reduce((n, s) => n + s.amount, 0) - credit_lines.reduce((n, c) => n + c.amount, 0)) * 100) / 100
  const wcTotal = money(wc.total)
  const createdAt = parseWcDate(wc.date_created_gmt) ?? new Date()
  const statusAt = parseWcDate(wc.date_completed_gmt) ?? parseWcDate(wc.date_modified_gmt) ?? createdAt
  return {
    status,
    contact,
    createdAt,
    statusChangedAt: statusAt,
    modifiedAt: parseWcDate(wc.date_modified_gmt),
    totals: { computed, wc: wcTotal, matches: Math.abs(computed - wcTotal) < 1 },
    input: {
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
        payment_method: text(wc.payment_method_title || wc.payment_method, 80) || null,
        paid_at: wc.date_paid_gmt ? parseWcDate(wc.date_paid_gmt)?.toISOString() ?? null : null,
        order_note: text(wc.customer_note, 1000) || null,
        customer_phone: contact.phone,
        customer_has_email: Boolean(contact.email),
        district: contact.address.province || null,
        ...(Math.abs(computed - wcTotal) >= 1 ? { total_mismatch: { computed, wc: wcTotal } } : {}),
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
  updated: number
  unchanged: number
  skipped: number
  failed: number
  mismatched: number
  errors: { id: string; message: string }[]
}

export const emptyProgress = (): ImportProgress => ({ total: 0, seen: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, mismatched: 0, errors: [] })

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

/** This store's products for WooCommerce product ids, matched by slug = handle. */
async function matchProducts(container: any, s: any, ids: number[], cache: Map<number, MatchedProduct | null>, fetchImpl: Fetch) {
  const wanted = [...new Set(ids)].filter((id) => id > 0 && !cache.has(id))
  if (!wanted.length) return
  const { data } = await wcGet(s, "products", { include: wanted.join(","), per_page: 100, _fields: "id,slug" }, fetchImpl)
  const slugs = new Map<number, string>((Array.isArray(data) ? data : []).map((p: any) => [Number(p.id), String(p.slug)]))
  const handles = [...new Set(slugs.values())]
  const products = handles.length
    ? await container.resolve(Modules.PRODUCT).listProducts({ handle: handles }, { select: ["id", "handle", "title", "thumbnail", "metadata"], take: handles.length })
    : []
  const byHandle = new Map<string, any>(products.map((p: any) => [p.handle, p]))
  for (const id of wanted) {
    const p = byHandle.get(slugs.get(id) ?? "")
    cache.set(id, p ? { id: p.id, handle: p.handle, title: (p.metadata?.design_name as string) || p.title, thumbnail: p.thumbnail ?? null } : null)
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
 * again at any time (it resumes, and moves changed statuses).
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
    const productCache = new Map<number, MatchedProduct | null>()

    for (let page = 1; ; page++) {
      const { data, total } = await wcGet(settings, "orders", { per_page: PAGE, page, orderby: "id", order: "asc" }, fetchImpl)
      const batch: WcOrder[] = Array.isArray(data) ? data : []
      if (page === 1) progress.total = total || batch.length
      if (!batch.length) break
      await matchProducts(container, settings, batch.flatMap((o) => (o.line_items ?? []).map((l) => Number(l.product_id))), productCache, fetchImpl).catch((error) => {
        logger.warn(`[florayn-import] product matching skipped for a page: ${error?.message ?? error}`)
      })
      const products = new Map<number, MatchedProduct>([...productCache].filter((entry): entry is [number, MatchedProduct] => Boolean(entry[1])))
      const known = await svc.listImportedOrders({ source: IMPORT_SOURCE, source_id: batch.map((o) => String(o.id)) }, { take: batch.length })
      const bySource = new Map<string, any>(known.map((row: any) => [row.source_id, row]))

      for (const wc of batch) {
        progress.seen++
        try {
          const status = mapWcStatus(wc.status)
          if (!status) { progress.skipped++; continue }
          const existing = bySource.get(String(wc.id))
          if (existing) {
            if (existing.source_status === wc.status) { progress.unchanged++; continue }
            const [op] = await svc.listOrderOps({ order_id: existing.order_id }, { take: 1 })
            const changedAt = parseWcDate(wc.date_modified_gmt) ?? new Date()
            if (op) await svc.updateOrderOps({ id: op.id, workflow_status: status.workflow, status_changed_at: changedAt })
            const [current] = await orders.listOrders({ id: existing.order_id }, { take: 1, select: ["id", "metadata"] })
            await orders.updateOrders(existing.order_id, { status: status.order, metadata: { ...(current?.metadata ?? {}), wc_status: wc.status } })
            await svc.updateImportedOrders({ id: existing.id, source_status: wc.status, source_modified_at: changedAt })
            progress.updated++
            continue
          }
          const contact = orderContact(wc)
          const customerId = await customerFor(container, contact)
          const mapped = mapWcOrder(wc, { regionId: region.id, salesChannelId: store?.default_sales_channel_id ?? null, customerId, products })!
          if (!mapped.totals.matches) progress.mismatched++
          const created = await orders.createOrders(mapped.input)
          await knex("order").where({ id: created.id }).update({ created_at: mapped.createdAt, updated_at: mapped.modifiedAt ?? mapped.createdAt })
          const op = await svc.createOrderOps({ order_id: created.id, workflow_status: mapped.status.workflow, status_changed_at: mapped.statusChangedAt, source: IMPORT_SOURCE })
          await knex("order_op").where({ id: op.id }).update({ created_at: mapped.createdAt })
          await svc.createImportedOrders({ source: IMPORT_SOURCE, source_id: String(wc.id), order_id: created.id, source_status: wc.status, source_modified_at: mapped.modifiedAt })
          progress.created++
        } catch (error: any) {
          progress.failed++
          if (progress.errors.length < 50) progress.errors.push({ id: String(wc.id), message: String(error?.message ?? error).slice(0, 300) })
        }
      }
      await saveProgress(container, settings.id, { progress })
      if (batch.length < PAGE) break
    }
    await saveProgress(container, settings.id, { state: "done", finished_at: new Date(), progress })
    logger.info(`[florayn-import] ${progress.created} created, ${progress.updated} updated, ${progress.unchanged} unchanged, ${progress.skipped} skipped, ${progress.failed} failed`)
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
  const cache = new Map<number, MatchedProduct | null>()
  await matchProducts(container, settings, batch.flatMap((o) => (o.line_items ?? []).map((l) => Number(l.product_id))), cache, fetchImpl).catch(() => undefined)
  const products = new Map<number, MatchedProduct>([...cache].filter((entry): entry is [number, MatchedProduct] => Boolean(entry[1])))
  const already = await opsService(container).listAndCountImportedOrders({ source: IMPORT_SOURCE }, { take: 1, select: ["id"] })
  return {
    total,
    imported: already[1],
    orders: batch.map((wc) => {
      const mapped = mapWcOrder(wc, { regionId: "preview", customerId: "preview", products })
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
        items: mapped.input.items.map((i) => ({ title: i.title, quantity: i.quantity, price: i.unit_price, options: i.variant_title, linked: Boolean((i as any).product_id) })),
        delivery: mapped.input.shipping_methods.reduce((n, s) => n + s.amount, 0),
        total: mapped.totals.wc,
        totals_match: mapped.totals.matches,
      }
    }),
  }
}
