"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"

/**
 * Customer accounts are passwordless: the shopper proves ownership of their
 * email with a 6-digit code (see the backend /store/auth/otp/* routes), and the
 * backend hands back a native Medusa CUSTOMER session token. We keep that token
 * in an httpOnly cookie - exactly like the cart id - so the browser never sees
 * it and every authenticated call is made server-side with a Bearer header.
 */
const CUSTOMER_COOKIE = "florayn_customer_jwt"
const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days; a stale/expired token reads as logged-out
const REQUEST_TIMEOUT_MS = 15_000

export type Customer = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  metadata?: Record<string, unknown> | null
}

export type CustomerAddress = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  address_1: string | null
  address_2: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
  is_default_shipping?: boolean
}

/** One row in the account order history - a live Medusa order or an imported one. */
export type AccountOrder = {
  id: string | null
  displayId: string | number | null
  date: string
  status: string
  total: number
  currencyCode: string
  items: string
  legacy: boolean
  href: string | null
}

export type ActionResult = { ok: boolean; error?: string }

function baseHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
  }
}

async function readToken(): Promise<string | undefined> {
  const store = await cookies()
  return store.get(CUSTOMER_COOKIE)?.value
}

/** True when a session cookie is present (it may still be expired server-side). */
export async function hasSession(): Promise<boolean> {
  return Boolean(await readToken())
}

/** The raw customer session token, for server-side authenticated requests (e.g. checkout). */
export async function getCustomerToken(): Promise<string | undefined> {
  return readToken()
}

/** An authenticated request, or null when there is no token / it cannot be sent. */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await readToken()
  if (!token) return null
  try {
    return await fetch(`${MEDUSA_BACKEND_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...baseHeaders(),
        authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  } catch {
    return null
  }
}

// --- Auth --------------------------------------------------------------------

/** Email a fresh sign-in code. Never reveals whether the email has an account. */
export async function requestLoginCode(rawEmail: string): Promise<ActionResult> {
  const email = typeof rawEmail === "string" ? rawEmail.trim() : ""
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." }
  }
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/auth/otp/request`, {
      method: "POST",
      headers: baseHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ email }),
    })
    const data = (await res.json().catch(() => ({}))) as { message?: string }
    if (!res.ok) return { ok: false, error: data?.message || "Could not send the code. Try again." }
    return { ok: true }
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." }
  }
}

/** Verify the code and, on success, store the customer session cookie. */
export async function verifyLoginCode(rawEmail: string, rawCode: string): Promise<ActionResult> {
  const email = typeof rawEmail === "string" ? rawEmail.trim() : ""
  const code = typeof rawCode === "string" ? rawCode.trim() : ""
  if (!email || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "Enter the 6-digit code from your email." }
  }
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/auth/otp/verify`, {
      method: "POST",
      headers: baseHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ email, code }),
    })
    const data = (await res.json().catch(() => ({}))) as { token?: string; message?: string }
    if (!res.ok || typeof data?.token !== "string" || !data.token) {
      return { ok: false, error: data?.message || "Invalid or expired code." }
    }
    const store = await cookies()
    store.set(CUSTOMER_COOKIE, data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    })
    return { ok: true }
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." }
  }
}

/** Clear the session cookie. */
export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(CUSTOMER_COOKIE)
  revalidatePath("/account")
  revalidatePath("/")
}

// --- Profile -----------------------------------------------------------------

const CUSTOMER_FIELDS = "id,email,first_name,last_name,phone,metadata"

export async function getCurrentCustomer(): Promise<Customer | null> {
  const res = await authedFetch(`/store/customers/me?fields=${encodeURIComponent(CUSTOMER_FIELDS)}`)
  if (!res || !res.ok) return null
  try {
    const data = (await res.json()) as { customer?: Customer }
    return data?.customer ?? null
  } catch {
    return null
  }
}

export async function updateProfile(input: {
  first_name?: string
  last_name?: string
  phone?: string
}): Promise<ActionResult> {
  const body: Record<string, string> = {}
  for (const key of ["first_name", "last_name", "phone"] as const) {
    const value = input[key]
    if (typeof value === "string") body[key] = value.trim()
  }
  const res = await authedFetch(`/store/customers/me`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res) return { ok: false, error: "You are signed out. Please sign in again." }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string }
    return { ok: false, error: data?.message || "Could not save your profile." }
  }
  revalidatePath("/account")
  return { ok: true }
}

// --- Addresses ---------------------------------------------------------------

const ADDRESS_FIELDS =
  "id,first_name,last_name,phone,address_1,address_2,city,province,postal_code,country_code,is_default_shipping"

export async function listAddresses(): Promise<CustomerAddress[]> {
  const res = await authedFetch(
    `/store/customers/me/addresses?fields=${encodeURIComponent(ADDRESS_FIELDS)}&limit=50`
  )
  if (!res || !res.ok) return []
  try {
    const data = (await res.json()) as { addresses?: CustomerAddress[] }
    return Array.isArray(data?.addresses) ? data.addresses : []
  } catch {
    return []
  }
}

export type AddressInput = {
  first_name?: string
  last_name?: string
  phone?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
}

function cleanAddress(input: AddressInput): Record<string, string> {
  const body: Record<string, string> = { country_code: "bd" }
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) body[key] = value.trim()
  }
  return body
}

export async function addAddress(input: AddressInput): Promise<ActionResult> {
  if (!input.address_1?.trim() || !input.city?.trim()) {
    return { ok: false, error: "A street address and city are required." }
  }
  const res = await authedFetch(`/store/customers/me/addresses`, {
    method: "POST",
    body: JSON.stringify(cleanAddress(input)),
  })
  if (!res) return { ok: false, error: "You are signed out. Please sign in again." }
  if (!res.ok) return { ok: false, error: "Could not save the address." }
  revalidatePath("/account")
  return { ok: true }
}

export async function deleteAddress(addressId: string): Promise<ActionResult> {
  if (!addressId) return { ok: false, error: "Missing address." }
  const res = await authedFetch(`/store/customers/me/addresses/${encodeURIComponent(addressId)}`, {
    method: "DELETE",
  })
  if (!res) return { ok: false, error: "You are signed out. Please sign in again." }
  if (!res.ok) return { ok: false, error: "Could not remove the address." }
  revalidatePath("/account")
  return { ok: true }
}

// --- Orders (live Medusa + imported florayn.com history) ---------------------

type LiveOrderItem = { title?: string; quantity?: number }
type LiveOrder = {
  id: string
  display_id?: number | null
  status?: string
  created_at?: string
  currency_code?: string
  total?: number
  items?: LiveOrderItem[]
}

type LegacyOrder = {
  n?: string | number
  date?: string
  status?: string
  total?: number
  items?: string
}

function summariseItems(items: LiveOrderItem[] | undefined): string {
  const parts = (items ?? [])
    .map((i) => (i.quantity && i.quantity > 1 ? `${i.title} ×${i.quantity}` : i.title))
    .filter((x): x is string => Boolean(x))
  return parts.join(", ")
}

async function fetchLiveOrders(): Promise<AccountOrder[]> {
  const fields = "id,display_id,status,created_at,currency_code,total,items.title,items.quantity"
  const res = await authedFetch(
    `/store/orders?fields=${encodeURIComponent(fields)}&limit=50&order=-created_at`
  )
  if (!res || !res.ok) return []
  try {
    const data = (await res.json()) as { orders?: LiveOrder[] }
    return (data?.orders ?? []).map((o) => ({
      id: o.id,
      displayId: o.display_id ?? null,
      date: o.created_at ?? "",
      status: o.status ?? "pending",
      total: Number(o.total ?? 0),
      currencyCode: o.currency_code ?? "bdt",
      items: summariseItems(o.items),
      legacy: false,
      href: `/order/${o.id}`,
    }))
  } catch {
    return []
  }
}

function readLegacyOrders(customer: Customer | null): AccountOrder[] {
  const meta = (customer?.metadata ?? {}) as Record<string, unknown>
  const rows = Array.isArray(meta.legacy_orders) ? (meta.legacy_orders as LegacyOrder[]) : []
  return rows.map((o) => ({
    id: null,
    displayId: o.n ?? null,
    date: typeof o.date === "string" ? o.date : "",
    status: typeof o.status === "string" ? o.status : "completed",
    total: Number(o.total ?? 0),
    currencyCode: "bdt",
    items: typeof o.items === "string" ? o.items : "",
    legacy: true,
    href: null,
  }))
}

function orderTime(order: AccountOrder): number {
  const t = Date.parse(order.date)
  return Number.isNaN(t) ? 0 : t
}

/** The full order history: live Medusa orders first, then imported ones, newest first. */
export async function getAccountOrders(): Promise<AccountOrder[]> {
  const customer = await getCurrentCustomer()
  if (!customer) return []
  const [live, legacy] = [await fetchLiveOrders(), readLegacyOrders(customer)]
  return [...live, ...legacy].sort((a, b) => orderTime(b) - orderTime(a))
}
