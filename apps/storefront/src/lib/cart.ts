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

export async function addToCart(variantId: string, quantity = 1) {
  const cartId = await getOrCreateCartId()
  await sdk.store.cart.createLineItem(cartId, {
    variant_id: variantId,
    quantity,
  })
  revalidatePath("/cart")
}

export async function updateLineItem(lineId: string, quantity: number) {
  const cartId = await readCartId()
  if (!cartId) {
    return
  }

  if (quantity <= 0) {
    await sdk.store.cart.deleteLineItem(cartId, lineId)
  } else {
    await sdk.store.cart.updateLineItem(cartId, lineId, { quantity })
  }
  revalidatePath("/cart")
}
