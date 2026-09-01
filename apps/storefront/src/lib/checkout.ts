import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"

export type DistrictsResponse = {
  districts: string[]
  count: number
  inside_dhaka: string[]
  shipping: {
    inside_dhaka: number
    outside_dhaka: number
    free_threshold: number
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

export async function getDistricts(): Promise<DistrictsResponse | null> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/districts`, {
      headers: headers(),
      next: { revalidate: 3600 },
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
  { ok: true; order: PlacedOrder } | { ok: false; errors: Record<string, string> }
> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/checkout`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return {
        ok: false,
        errors: (data as any).errors ?? {
          form: "Something went wrong. Please try again.",
        },
      }
    }

    return { ok: true, order: (data as any).order as PlacedOrder }
  } catch {
    return {
      ok: false,
      errors: { form: "Could not reach the server. Check your connection." },
    }
  }
}
