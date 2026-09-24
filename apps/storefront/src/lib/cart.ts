"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { cartDiscount, getBundleConfig, type BundleLine } from "./bundles"
import {
  placeOrder,
  fetchCheckoutQuote,
  type CheckoutInput,
} from "./checkout"
import { getCustomerToken } from "./customer"
import { getRegionId, sdk } from "./medusa"

const CART_COOKIE = "florayn_cart_id"

const CART_FIELDS =
  "id,completed_at,currency_code,subtotal,item_subtotal,shipping_total,tax_total,total,item_total," +
  "*items,*items.variant,*items.variant.product,items.variant.product.metadata"

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
    metadata?: Record<string, unknown> | null
    product?: {
      title: string
      handle: string
      thumbnail?: string | null
      metadata?: Record<string, unknown> | null
    }
  }
}

export type Cart = {
  id: string
  currency_code: string
  subtotal: number
  total: number
  items?: CartItem[]
  /** The multi-buy / Matching Set saving on this cart, for display. */
  bundleDiscount?: number
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
  /** Multi-buy / Matching Set saving, so the drawer and badge can show it. */
  bundleDiscount: number
}

export type AddedLine = {
  id: string
  /** The variant, so an optimistic line can merge with one already in the bag. */
  variantId?: string
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
  bundleDiscount: 0,
}

function summarize(cart: Cart | null): CartSummary {
  if (!cart) {
    return EMPTY_SUMMARY
  }

  return {
    itemCount: (cart.items ?? []).reduce((sum, i) => sum + i.quantity, 0),
    subtotal: cart.subtotal ?? 0,
    currencyCode: cart.currency_code ?? "bdt",
    bundleDiscount: cart.bundleDiscount ?? 0,
  }
}

/** Whether a device name is a phone case (the pack scope), inferred by family. */
function deviceIsCase(name: string): boolean {
  return /iphone|galaxy|samsung/i.test(name)
}

/** The saving this cart earns, mirrored from the backend for display. */
async function computeBundleDiscount(cart: Cart): Promise<number> {
  const lines: BundleLine[] = (cart.items ?? []).map((i) => {
    const meta = i.variant?.product?.metadata ?? {}
    return {
      unit_price: i.unit_price,
      quantity: i.quantity,
      is_case: deviceIsCase(i.variant?.title ?? ""),
      form: (meta.form as string) ?? undefined,
      design: (meta.design_slug as string) ?? undefined,
    }
  })
  if (!lines.length) return 0
  try {
    return cartDiscount(lines, await getBundleConfig())
  } catch {
    return 0
  }
}

async function readCartId(): Promise<string | undefined> {
  const store = await cookies()
  return store.get(CART_COOKIE)?.value
}

/** A cart as the storefront shows it: item subtotal and the bundle saving. */
async function prepareCart(cart: unknown): Promise<Cart> {
  const typed = cart as Cart
  // Medusa subtotal includes shipping once checkout has attached a method.
  typed.subtotal = Number((cart as { item_subtotal?: number }).item_subtotal ?? typed.subtotal)
  typed.bundleDiscount = await computeBundleDiscount(typed)
  return typed
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
    if (cart.completed_at) return null
    return await prepareCart(cart)
  } catch {
    // The cart was completed or pruned server-side; treat it as empty.
    return null
  }
}

/** Used by the header badge to hydrate itself after the page loads. */
export async function getCartSummary(): Promise<CartSummary> {
  return summarize(await getCart())
}

async function cartIsOpen(cartId: string): Promise<boolean> {
  try {
    const { cart } = await sdk.store.cart.retrieve(cartId, { fields: "id,completed_at" })
    return !cart.completed_at
  } catch {
    return false
  }
}

async function createCartId(): Promise<string> {
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
 * Add lines and get the whole cart back in the same round trip (Medusa returns
 * the cart from createLineItem; asking for the drawer's fields there saves a
 * second read). The existing cart is used directly; only if it is gone or
 * already ordered is a new one made, so a normal add is one request.
 */
async function addLines(lines: { variantId: string; quantity: number }[]): Promise<Cart> {
  let added = 0
  const add = async (cartId: string) => {
    let cart: unknown = null
    for (const [index, line] of lines.entries()) {
      const last = index === lines.length - 1
      ;({ cart } = await sdk.store.cart.createLineItem(
        cartId,
        { variant_id: line.variantId, quantity: line.quantity },
        last ? { fields: CART_FIELDS } : { fields: "id" }
      ))
      added++
    }
    return prepareCart(cart)
  }
  const existing = await readCartId()
  if (existing) {
    try {
      return await add(existing)
    } catch (error) {
      // Only a cart that is gone or already ordered is replaced. Any other
      // failure (a sold-out variant) keeps the shopper's bag and is reported,
      // and a failure after a line went in must not add the pack twice.
      if (added || (await cartIsOpen(existing))) throw error
    }
  }
  return add(await createCartId())
}

/**
 * Returns the line as the server now holds it, not as the caller assumed. If
 * the device was already in the cart the quantity is the merged total, and the
 * drawer should show that rather than "1". The full list of lines comes back
 * too, so the drawer never waits on a second request.
 */
export async function addToCart(
  variantId: string,
  quantity = 1
): Promise<{ summary: CartSummary; added: AddedLine | null; items: CartItem[] }> {
  const cart = await addLines([{ variantId, quantity }])
  const line = (cart?.items ?? []).find((i) => i.variant?.id === variantId)

  revalidatePath("/cart")

  return {
    summary: summarize(cart),
    items: cart.items ?? [],
    added: line
      ? {
          id: line.id,
          variantId,
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

/**
 * Adds several variants in one go (a 2-pack / 3-pack / bundle). Line items are
 * created sequentially so the same cart is not mutated concurrently, then one
 * fresh summary is returned. The multi-buy discount itself is layered on at the
 * cart/checkout level by the backend, not here.
 */
export async function addManyToCart(
  items: { variantId: string; quantity?: number }[]
): Promise<{ summary: CartSummary; items: CartItem[] }> {
  const clean = items.filter((i) => i.variantId)
  if (!clean.length) {
    const cart = await getCart()
    return { summary: summarize(cart), items: cart?.items ?? [] }
  }

  const cart = await addLines(clean.map((i) => ({ variantId: i.variantId, quantity: i.quantity ?? 1 })))
  revalidatePath("/cart")
  return { summary: summarize(cart), items: cart.items ?? [] }
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

/**
 * Places the order for the cart in the cookie.
 *
 * The cart id is httpOnly, so the checkout form never sees it and cannot post
 * an order for someone else's cart. Retain the completed capability so a lost
 * Server Action response can recover the order. Reads hide completed carts;
 * the next add creates a fresh cart and replaces this cookie.
 */
export async function submitOrder(
  input: Omit<CheckoutInput, "cart_id">
): ReturnType<typeof placeOrder> {
  const cartId = await readCartId()
  if (!cartId) {
    return { ok: false, errors: { form: "Your cart is empty." } }
  }

  // Pass the customer session token when signed in, so the order links to the
  // account and shows up under "My orders" (guests send none, unchanged).
  const customerToken = await getCustomerToken()
  const result = await placeOrder({ ...input, cart_id: cartId }, customerToken)

  if (result.ok) {
    revalidatePath("/cart")
  }

  return result
}

/** The store's own per-cart offers; they are managed by the quote, never typed in. */
const INTERNAL_CODE = /^(BUNDLE|FREESHIP)-/i

/** The discount codes the shopper has applied (review rewards and the like). */
export async function cartPromoCodes(): Promise<string[]> {
  const cartId = await readCartId()
  if (!cartId) return []
  try {
    const { cart } = await sdk.store.cart.retrieve(cartId, { fields: "id,promotions.code" })
    return ((cart as unknown as { promotions?: { code?: string }[] }).promotions ?? [])
      .map((p) => p.code ?? "")
      .filter((code) => code && !INTERNAL_CODE.test(code))
  } catch {
    return []
  }
}

type PromoResult = { ok: true; codes: string[] } | { ok: false; message: string }

/**
 * Apply a discount code to the bag. Medusa ignores a code it cannot use
 * (unknown, expired, used up), so success is read back from the cart itself.
 * The checkout then asks for a fresh quote, which keeps the code alongside the
 * bundle savings.
 */
export async function applyPromoCode(input: string): Promise<PromoResult> {
  const code = String(input ?? "").trim().toUpperCase()
  if (!/^[A-Z0-9-]{3,40}$/.test(code) || INTERNAL_CODE.test(code)) return { ok: false, message: "Enter the code as it appears in your email." }
  const cartId = await readCartId()
  if (!cartId) return { ok: false, message: "Your bag is empty." }
  try {
    await sdk.client.fetch(`/store/carts/${cartId}/promotions`, { method: "POST", body: { promo_codes: [code] } })
  } catch {
    return { ok: false, message: "That code isn't valid or has already been used." }
  }
  const codes = await cartPromoCodes()
  return codes.includes(code) ? { ok: true, codes } : { ok: false, message: "That code isn't valid or has already been used." }
}

export async function removePromoCode(input: string): Promise<PromoResult> {
  const code = String(input ?? "").trim()
  const cartId = await readCartId()
  if (!cartId || !code || INTERNAL_CODE.test(code)) return { ok: false, message: "That code is not on your bag." }
  try {
    await sdk.client.fetch(`/store/carts/${cartId}/promotions`, { method: "DELETE", body: { promo_codes: [code] } })
  } catch {
    return { ok: false, message: "Could not remove the code. Please try again." }
  }
  return { ok: true, codes: await cartPromoCodes() }
}

/** The cart capability stays in its httpOnly cookie, including quote requests. */
export async function quoteCheckout(district: string) {
  const cartId = await readCartId()
  if (!cartId) return { ok: false as const, errors: { form: "Your cart is empty. Please return to your bag." } }
  return fetchCheckoutQuote(cartId, district)
}
