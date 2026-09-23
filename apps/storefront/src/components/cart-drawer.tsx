"use client"

import Link from "@/components/audience-link"
import { useEffect, useRef, useState } from "react"

import { useCart } from "@/components/cart-provider"
import ProductImage from "@/components/product-image"
import {
  getCart,
  removeLineItem,
  setLineItemQuantity,
  type CartItem,
} from "@/lib/cart"
import { formatPrice } from "@/lib/money"

export default function CartDrawer() {
  const { isDrawerOpen, closeDrawer, summary, applySummary } = useCart()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  const [items, setItems] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const itemCount = summary?.itemCount ?? 0

  // Load the full cart whenever the drawer opens or the cart count changes.
  useEffect(() => {
    if (!isDrawerOpen) return
    let cancelled = false
    setLoading(true)
    getCart()
      .then((cart) => {
        if (!cancelled) setItems(cart?.items ?? [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isDrawerOpen, itemCount])

  // Escape to close + focus trap + lock body scroll while open.
  useEffect(() => {
    if (!isDrawerOpen) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [isDrawerOpen, closeDrawer])

  async function changeQty(item: CartItem, delta: number) {
    const next = item.quantity + delta
    if (next < 1 || busy) return
    setBusy(item.id)
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, quantity: next } : i))
    )
    try {
      applySummary(await setLineItemQuantity(item.id, next))
    } catch {
      const cart = await getCart()
      setItems(cart?.items ?? [])
    } finally {
      setBusy(null)
    }
  }

  async function remove(item: CartItem) {
    if (busy) return
    setBusy(item.id)
    setItems((list) => list.filter((i) => i.id !== item.id))
    try {
      applySummary(await removeLineItem(item.id))
    } catch {
      const cart = await getCart()
      setItems(cart?.items ?? [])
    } finally {
      setBusy(null)
    }
  }

  const currency = summary?.currencyCode
  const subtotal =
    summary?.subtotal ??
    items.reduce((n, i) => n + i.unit_price * i.quantity, 0)
  const discount = summary?.bundleDiscount ?? 0
  const total = Math.max(0, subtotal - discount)
  const isEmpty = !loading && items.length === 0

  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={[
          "fixed inset-0 z-40 bg-ink/40 transition-opacity duration-300",
          isDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        tabIndex={-1}
        aria-hidden={!isDrawerOpen}
        className={[
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col",
          "bg-paper outline-none",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          // The shadow only while open: parked off-screen it bled a grey
          // smudge along the right edge of every page.
          isDrawerOpen ? "translate-x-0 shadow-2xl" : "translate-x-full",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="display text-lg tracking-tight">
            Shopping Cart
            {itemCount > 0 ? (
              <span className="text-ink-muted"> ({itemCount})</span>
            ) : null}
          </h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="display text-lg">Your cart is empty</p>
              <p className="text-sm text-ink-muted">Add a case to get started.</p>
              <Link
                href="/shop/"
                onClick={closeDrawer}
                className="mt-1 text-sm font-medium text-purple underline underline-offset-4"
              >
                Browse designs
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const title = item.variant?.product?.title ?? item.title
                const sub = item.variant?.title ?? item.subtitle ?? ""
                const thumb =
                  item.thumbnail ?? item.variant?.product?.thumbnail ?? null
                return (
                  <li key={item.id} className="flex gap-3.5 py-4">
                    <div className="relative size-[76px] shrink-0 overflow-hidden rounded-[10px] border border-line bg-surface">
                      <ProductImage src={thumb} alt="" label={title} sizes="76px" />
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold leading-snug text-ink">
                          {title}
                        </p>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={busy === item.id}
                          aria-label={`Remove ${title}`}
                          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0-.6 12a2 2 0 0 1-2 1.9H7.6a2 2 0 0 1-2-1.9L5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>

                      {sub ? (
                        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                          {sub}
                        </p>
                      ) : null}

                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex h-9 items-center rounded-full border border-line">
                          <button
                            type="button"
                            onClick={() => changeQty(item, -1)}
                            disabled={busy === item.id || item.quantity <= 1}
                            aria-label="Decrease quantity"
                            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
                          >
                            &minus;
                          </button>
                          <span className="min-w-6 text-center text-sm tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeQty(item, 1)}
                            disabled={busy === item.id}
                            aria-label="Increase quantity"
                            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-[15px] font-semibold tabular-nums text-ink">
                          {formatPrice(item.unit_price * item.quantity, currency)}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {!isEmpty ? (
          <div className="border-t border-line px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Subtotal</span>
              <span className="flex items-center gap-2">
                {discount > 0 ? (
                  <span className="text-sm text-ink-faint line-through tabular-nums">
                    {formatPrice(subtotal, currency)}
                  </span>
                ) : null}
                <span className="display text-xl tabular-nums">
                  {formatPrice(total, currency)}
                </span>
              </span>
            </div>

            {discount > 0 ? (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-medium text-purple">
                  Bundle savings
                </span>
                <span className="text-sm font-semibold tabular-nums text-purple">
                  &minus;{formatPrice(discount, currency)}
                </span>
              </div>
            ) : null}

            <p className="mt-1 text-[12px] text-ink-faint">
              Shipping calculated at checkout.
            </p>

            <Link
              href="/checkout/"
              onClick={closeDrawer}
              className="mt-4 flex h-[52px] w-full items-center justify-center rounded-full bg-ink text-[15px] font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Checkout
            </Link>
            <Link
              href="/cart/"
              onClick={closeDrawer}
              className="mt-2 flex h-[52px] w-full items-center justify-center rounded-full border border-line text-[15px] font-semibold text-ink transition-colors hover:bg-surface"
            >
              View cart
            </Link>
          </div>
        ) : null}
      </div>
    </>
  )
}
