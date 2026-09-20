import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"
import type { CheckoutLine } from "./checkout-form-data"

export type CheckoutSettings = {
  heading: string
  description: string
  delivery_note: string
  support_phone: string
  support_label: string
  show_order_note: boolean
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  heading: "Checkout",
  description: "Enter your delivery details to place your order.",
  delivery_note: "",
  support_phone: "",
  support_label: "Need help?",
  show_order_note: true,
}

export type CheckoutQuote = {
  version: string
  currency_code: string
  subtotal: number
  discount_total: number
  bundle_discount: number
  shipping_total: number
  shipping_subtotal: number
  tax_total: number
  total: number
  free_shipping: boolean
  shipping_option_id: string
  shipping_label: string
  district: string
  item_count: number
  payment_method: "cash_on_delivery"
  items: CheckoutLine[]
}

export type CheckoutFailure = { ok: false; errors: Record<string, string>; quote?: CheckoutQuote }

export type DistrictsResponse = {
  districts: string[]
  count: number
  inside_dhaka: string[]
  shipping: {
    inside_dhaka: number
    outside_dhaka: number
  }
}

export type CheckoutInput = {
  cart_id: string
  full_name: string
  phone: string
  email?: string
  address: string
  district: string
  area: string
  note?: string
  quote_version: string
}

export type PlacedOrder = {
  id: string
  display_id: number | null
  total: number | null
  currency_code: string
}

export type OrderSummary = {
  id: string
  display_id: number | null
  created_at: string
  currency_code: string
  subtotal: number
  shipping_total: number
  total: number
  payment_method: string
  free_shipping: boolean
  shipping_method: string | null
  items: {
    id: string
    title: string
    variant_title: string | null
    sku: string | null
    quantity: number
    unit_price: number
    thumbnail: string | null
  }[]
  delivery: {
    name: string
    address: string
    area: string
    district: string
    phone: string
  }
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
  }
}

export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/checkout-settings`, {
      headers: headers(),
      next: { revalidate: 60, tags: ["content", "content:checkout"] },
    })
    if (!res.ok) return DEFAULT_CHECKOUT_SETTINGS
    const data = await res.json() as { settings: CheckoutSettings }
    return { ...DEFAULT_CHECKOUT_SETTINGS, ...data.settings }
  } catch {
    return DEFAULT_CHECKOUT_SETTINGS
  }
}

function checkoutErrors(data: unknown): Record<string, string> {
  const supplied = (data as { errors?: unknown })?.errors
  if (supplied && typeof supplied === "object" && !Array.isArray(supplied)) {
    const result = Object.fromEntries(Object.entries(supplied).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    if (Object.keys(result).length) return result
  }
  return { form: "We could not update your checkout. Please try again." }
}

function isCheckoutQuote(value: unknown): value is CheckoutQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const quote = value as CheckoutQuote
  const amounts = [quote.subtotal, quote.discount_total, quote.bundle_discount, quote.shipping_total,
    quote.shipping_subtotal, quote.tax_total, quote.total]
  return typeof quote.version === "string" && /^[a-f0-9]{64}$/.test(quote.version)
    && typeof quote.district === "string" && quote.district.length > 0
    && typeof quote.currency_code === "string" && /^[a-z]{3}$/i.test(quote.currency_code)
    && typeof quote.shipping_option_id === "string" && typeof quote.shipping_label === "string"
    && typeof quote.free_shipping === "boolean" && quote.payment_method === "cash_on_delivery"
    && Number.isInteger(quote.item_count) && quote.item_count > 0
    && amounts.every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
    && Array.isArray(quote.items) && quote.items.length > 0 && quote.items.every((item) =>
      item && typeof item.id === "string" && typeof item.title === "string"
      && typeof item.variant_title === "string" && Number.isInteger(item.quantity) && item.quantity > 0
      && [item.unit_price, item.subtotal, item.total].every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
      && (item.thumbnail === null || typeof item.thumbnail === "string"))
}

export async function fetchCheckoutQuote(cartId: string, district: string): Promise<
  { ok: true; quote: CheckoutQuote } | CheckoutFailure
> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/checkout/quote`, {
      method: "POST", headers: headers(), cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ cart_id: cartId, district }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, errors: checkoutErrors(data) }
    if (!isCheckoutQuote(data?.quote) || data.quote.district !== district) throw new Error("Invalid quote")
    return { ok: true, quote: data.quote }
  } catch {
    return { ok: false, errors: { form: "Could not confirm delivery and total. Check your connection and try again." } }
  }
}

export async function getDistricts(): Promise<DistrictsResponse | null> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/districts`, {
      headers: headers(),
      next: { revalidate: 3600, tags: ["catalog", "catalog:districts"] },
    })
    if (!res.ok) {
      return null
    }
    return (await res.json()) as DistrictsResponse
  } catch {
    return null
  }
}

export async function getOrderSummary(
  id: string
): Promise<OrderSummary | null> {
  try {
    const res = await fetch(
      `${MEDUSA_BACKEND_URL}/store/checkout/${encodeURIComponent(id)}`,
      { headers: headers(), cache: "no-store" }
    )
    if (!res.ok) {
      return null
    }
    const data = (await res.json()) as { order: OrderSummary }
    return data.order
  } catch {
    return null
  }
}

/**
 * Places the order. Field-level errors come back as `errors`, keyed by field
 * name, so the form can put each message next to the input it belongs to.
 */
export async function placeOrder(
  input: CheckoutInput
): Promise<
  { ok: true; order: PlacedOrder } | CheckoutFailure
> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/checkout`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: headers(),
      body: JSON.stringify(input),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return {
        ok: false,
        errors: checkoutErrors(data),
        ...(isCheckoutQuote((data as any)?.quote) ? { quote: (data as any).quote as CheckoutQuote } : {}),
      }
    }

    if (typeof (data as any)?.order?.id !== "string" || !(data as any).order.id.trim()) throw new Error("Missing order")
    return { ok: true, order: (data as any).order as PlacedOrder }
  } catch {
    return {
      ok: false,
      errors: { form: "Could not reach the server. Check your connection." },
    }
  }
}
