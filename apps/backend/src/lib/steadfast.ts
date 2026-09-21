import { opsService, type WorkflowStatus } from "./order-ops"

/**
 * Steadfast Courier (Bangladesh) merchant API client.
 * Base https://portal.packzy.com/api/v1, auth via `Api-Key` + `Secret-Key`
 * headers. There is NO sandbox and NO label endpoint - labels are built by us
 * from the tracking code. Credentials live in the courier_settings DB row and
 * are read here; nothing is ever hard-coded or logged.
 */
const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_BASE_URL = "https://portal.packzy.com/api/v1"

/** Every delivery_status Steadfast can return, mapped to our workflow tabs. */
const STATUS_MAP: Record<string, WorkflowStatus> = {
  pending: "shipped",
  in_review: "shipped",
  hold: "shipped",
  unknown: "shipped",
  unknown_approval_pending: "shipped",
  delivered: "delivered",
  delivered_approval_pending: "delivered",
  partial_delivered: "delivered",
  partial_delivered_approval_pending: "delivered",
  cancelled: "returned",
  cancelled_approval_pending: "returned",
}

/** Map a raw Steadfast delivery_status to our workflow status (defaults to shipped). */
export function mapSteadfastStatus(deliveryStatus: unknown): WorkflowStatus {
  const key = typeof deliveryStatus === "string" ? deliveryStatus.trim().toLowerCase() : ""
  return STATUS_MAP[key] ?? "shipped"
}

/** Reduce any BD number to the 11-digit 01XXXXXXXXX form, or null if impossible. */
export function normalizeBdPhone(raw: unknown): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.startsWith("880")) digits = digits.slice(3)
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`
  return /^01\d{9}$/.test(digits) ? digits : null
}

/** A Steadfast-safe invoice: alphanumeric plus - and _ only. */
export function sanitizeInvoice(raw: unknown): string {
  return String(raw ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "order"
}

export type CourierSettings = {
  id: string
  provider: string
  api_key: string | null
  secret_key: string | null
  base_url: string
  enabled: boolean
  default_delivery_type: number
}

/** Read the single courier settings row, seeding it on first access. */
export async function getCourierSettings(container: any): Promise<CourierSettings> {
  const svc = opsService(container)
  const existing = await svc.listCourierSettings({}, { take: 1 })
  if (existing?.[0]) return existing[0]
  return svc.createCourierSettings({})
}

export type SteadfastReady =
  | { ok: true; settings: CourierSettings }
  | { ok: false; error: string }

/** Settings with usable credentials, or a reason they are not ready. */
export async function courierReady(container: any): Promise<SteadfastReady> {
  const settings = await getCourierSettings(container)
  if (!settings.enabled) return { ok: false, error: "Courier is turned off in settings." }
  if (!settings.api_key || !settings.secret_key) {
    return { ok: false, error: "Steadfast API credentials are not set." }
  }
  return { ok: true, settings }
}

async function steadfastFetch(
  settings: CourierSettings,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: any }> {
  const base = settings.base_url?.trim() || DEFAULT_BASE_URL
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Api-Key": settings.api_key ?? "",
        "Secret-Key": settings.secret_key ?? "",
        "Content-Type": "application/json",
        Accept: "application/json",
        ...((init.headers as Record<string, string>) ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } catch (e: any) {
    return { ok: false, status: 0, body: { message: e?.message ?? "network error" } }
  }
}

export type ConsignmentInput = {
  invoice: string
  recipient_name: string
  recipient_phone: string
  recipient_address: string
  cod_amount: number
  note?: string
  delivery_type?: number
}

export type ConsignmentResult = {
  invoice: string
  ok: boolean
  consignment_id?: string
  tracking_code?: string
  status?: string
  error?: string
}

function readConsignment(invoice: string, node: any): ConsignmentResult {
  const c = node?.consignment ?? node ?? {}
  const id = c.consignment_id
  const tracking = c.tracking_code
  const okItem = (node?.status === "success" || c.consignment_id != null) && tracking
  return okItem
    ? {
        invoice,
        ok: true,
        consignment_id: id != null ? String(id) : undefined,
        tracking_code: typeof tracking === "string" ? tracking : String(tracking),
        status: typeof c.status === "string" ? c.status : undefined,
      }
    : { invoice, ok: false, error: node?.message || "Steadfast rejected this order." }
}

/** Create a single consignment. */
export async function createConsignment(
  container: any,
  input: ConsignmentInput
): Promise<ConsignmentResult> {
  const ready = await courierReady(container)
  if (!ready.ok) return { invoice: input.invoice, ok: false, error: ready.error }
  const res = await steadfastFetch(ready.settings, "/create_order", {
    method: "POST",
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    return { invoice: input.invoice, ok: false, error: res.body?.message || `Steadfast error (${res.status}).` }
  }
  return readConsignment(input.invoice, res.body)
}

/** Steadfast caps a bulk request at 500 orders. */
export const STEADFAST_BULK_LIMIT = 500

/**
 * Create many consignments in one call. The array is posted as a JSON-encoded
 * string under `data` (a Steadfast quirk). Returns one result per input,
 * matched back by invoice. Inputs beyond the 500 cap are chunked.
 */
export async function createBulkConsignments(
  container: any,
  inputs: ConsignmentInput[]
): Promise<{ ok: boolean; error?: string; results: ConsignmentResult[] }> {
  const ready = await courierReady(container)
  if (!ready.ok) return { ok: false, error: ready.error, results: [] }
  if (!inputs.length) return { ok: true, results: [] }

  const results: ConsignmentResult[] = []
  for (let i = 0; i < inputs.length; i += STEADFAST_BULK_LIMIT) {
    const chunk = inputs.slice(i, i + STEADFAST_BULK_LIMIT)
    const res = await steadfastFetch(ready.settings, "/create_order/bulk-order", {
      method: "POST",
      body: JSON.stringify({ data: JSON.stringify(chunk) }),
    })
    if (!res.ok) {
      // Whole chunk failed - mark each as errored but keep going.
      for (const c of chunk) {
        results.push({ invoice: c.invoice, ok: false, error: res.body?.message || `Steadfast error (${res.status}).` })
      }
      continue
    }
    const rows: any[] = Array.isArray(res.body) ? res.body : res.body?.data ?? []
    const byInvoice = new Map(rows.map((r) => [String(r.invoice), r]))
    for (const c of chunk) {
      const row = byInvoice.get(c.invoice)
      results.push(row ? readConsignment(c.invoice, row) : { invoice: c.invoice, ok: false, error: "No response for this order." })
    }
  }
  return { ok: true, results }
}

/** Query the current delivery status for a consignment id. */
export async function statusByConsignment(
  container: any,
  consignmentId: string
): Promise<{ ok: boolean; deliveryStatus?: string; error?: string }> {
  const ready = await courierReady(container)
  if (!ready.ok) return { ok: false, error: ready.error }
  const res = await steadfastFetch(
    ready.settings,
    `/status_by_cid/${encodeURIComponent(consignmentId)}`
  )
  if (!res.ok) return { ok: false, error: res.body?.message || `Steadfast error (${res.status}).` }
  return { ok: true, deliveryStatus: res.body?.delivery_status }
}

/** Current Steadfast account balance (BDT), or an error. */
export async function courierBalance(
  container: any
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  const ready = await courierReady(container)
  if (!ready.ok) return { ok: false, error: ready.error }
  const res = await steadfastFetch(ready.settings, "/get_balance")
  if (!res.ok) return { ok: false, error: res.body?.message || `Steadfast error (${res.status}).` }
  return { ok: true, balance: Number(res.body?.current_balance ?? 0) }
}
