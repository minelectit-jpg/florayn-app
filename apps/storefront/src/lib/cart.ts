"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { getRegionId, sdk } from "./medusa"

const CART_COOKIE = "florayn_cart_id"

const CART_FIELDS =
  "id,currency_code,subtotal,shipping_total,tax_total,total,item_total," +
  "*items,*items.variant,*items.variant.product"

export type CartItem = {
  id: string
  title: string
  quantity: number
  unit_price: number
  subtitle?: string | null
  thumbnail?: string | null
  variant?: {
    id: string
    title: string
    sku?: string | null
    product?: { title: string; handle: string; thumbnail?: string | null }
  }
}

export type Cart = {
  id: string
  currency_code: string
  subtotal: number
  total: number
  items?: CartItem[]
}

/**
 * The slice of the cart the header badge and the drawer need. Kept small and
 * separate from the full cart so every mutation can hand one back cheaply and
 * the UI never has to guess what the server now holds.
 */
export type CartSummary = {
  itemCount: number
  subtotal: number
  currencyCode: string
}

export type AddedLine = {
  id: string
  productTitle: string
  variantTitle: string
  sku: string | null
  quantity: number
  unitPrice: number
  thumbnail: string | null
}

const EMPTY_SUMMARY: CartSummary = {
  itemCount: 0,
  subtotal: 0,
  currencyCode: "bdt",
}

function summarize(cart: Cart | null): CartSummary {
  if (!cart) {
    return EMPTY_SUMMARY
  }

  return {
    itemCount: (cart.items ?? []).reduce((sum, i) => sum + i.quantity, 0),
    subtotal: cart.subtotal ?? 0,
    currencyCode: cart.currency_code ?? "bdt",
  }
}

async function readCartId(): Promise<string | undefined> {
  const store = await cookies()
  return store.get(CART_COOKIE)?.value
}

export async function getCart(): Promise<Cart | null> {
  const cartId = await readCartId()
  if (!cartId) {
    return null
  }

  try {
    const { cart } = await sdk.store.cart.retrieve(cartId, {
      fields: CART_FIELDS,
    })
    return cart as unknown as Cart
  } catch {
    // The cart was completed or pruned server-side; treat it as empty.
    return null
  }
}

/** Used by the header badge to hydrate itself after the page loads. */
export async function getCartSummary(): Promise<CartSummary> {
  return summarize(await getCart())
}

async function getOrCreateCartId(): Promise<string> {
  const existing = await readCartId()
  if (existing) {
    try {
      await sdk.store.cart.retrieve(existing, { fields: "id" })
      return existing
    } catch {
      // Fall through and create a new one.
    }
  }

  const region_id = await getRegionId()
  const { cart } = await sdk.store.cart.create({ region_id })
  const store = await cookies()
  store.set(CART_COOKIE, cart.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })
  return cart.id
}

/**
 * Returns the line as the server now holds it, not as the caller assumed. If
 * the device was already in the cart the quantity is the merged total, and the
 * drawer should show that rather than "1".
 */
export async function addToCart(
  variantId: string,
  quantity = 1
): Promise<{ summary: CartSummary; added: AddedLine | null }> {
  const cartId = await getOrCreateCartId()
  await sdk.store.cart.createLineItem(cartId, {
    variant_id: variantId,
    quantity,
  })

  const cart = await getCart()
  const line = (cart?.items ?? []).find((i) => i.variant?.id === variantId)

  revalidatePath("/cart")

  return {
    summary: summarize(cart),
    added: line
      ? {
          id: line.id,
          productTitle: line.variant?.product?.title ?? line.title,
          variantTitle: line.variant?.title ?? "",
          sku: line.variant?.sku ?? null,
          quantity: line.quantity,
          unitPrice: line.unit_price,
          thumbnail: line.thumbnail ?? line.variant?.product?.thumbnail ?? null,
        }
      : null,
  }
}

export async function setLineItemQuantity(
  lineId: string,
  quantity: number
): Promise<CartSummary> {
  const cartId = await readCartId()
  if (!cartId) {
    return EMPTY_SUMMARY
  }

  if (quantity <= 0) {
    await sdk.store.cart.deleteLineItem(cartId, lineId)
  } else {
    await sdk.store.cart.updateLineItem(cartId, lineId, { quantity })
  }

  revalidatePath("/cart")
  return summarize(await getCart())
}

export async function removeLineItem(lineId: string): Promise<CartSummary> {
  return setLineItemQuantity(lineId, 0)
}
