"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"

import { useCart } from "@/components/cart-provider"
import ProductImage from "@/components/product-image"
import { ButtonLink } from "@/components/ui/button"
import { formatPrice } from "@/lib/money"

export default function CartDrawer() {
  const { isDrawerOpen, closeDrawer, lastAdded, summary } = useCart()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Escape to close, and keep focus inside the panel while it is open.
  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }

    previouslyFocused.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer()
        return
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return
      }

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable.length) {
        return
      }

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

  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={[
          "fixed inset-0 z-40 bg-ink/40 transition-opacity duration-300",
          isDrawerOpen
            ? "opacity-100"
            : "pointer-events-none opacity-0",
        ].join(" ")}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Added to cart"
        tabIndex={-1}
        aria-hidden={!isDrawerOpen}
        className={[
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col",
          "border-l border-line bg-paper shadow-2xl outline-none",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          isDrawerOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <p className="eyebrow">Added to cart</p>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close"
            className="px-2 py-1 text-xl leading-none text-ink-faint transition-colors hover:text-ink"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {lastAdded ? (
            <div className="flex gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden border border-line bg-paper">
                <ProductImage
                  src={lastAdded.thumbnail}
                  alt=""
                  label={lastAdded.productTitle}
                  sizes="96px"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="display text-base leading-snug">
                  {lastAdded.productTitle}
                </p>
                <p className="text-sm text-ink-muted">
                  {lastAdded.variantTitle}
                </p>
                {lastAdded.sku ? (
                  <p className="eyebrow">
                    {lastAdded.sku}
                  </p>
                ) : null}
                <p className="pt-1 text-sm">
                  {formatPrice(
                    lastAdded.unitPrice,
                    summary?.currencyCode
                  )}
                  <span className="text-ink-faint">
                    {" "}
                    &times; {lastAdded.quantity}
                  </span>
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 border-t border-line bg-surface px-6 py-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">
              Subtotal
              {summary ? (
                <span>
                  {" "}
                  ({summary.itemCount}{" "}
                  {summary.itemCount === 1 ? "item" : "items"})
                </span>
              ) : null}
            </span>
            <span className="display text-xl tabular-nums">
              {formatPrice(summary?.subtotal, summary?.currencyCode)}
            </span>
          </div>

          <ButtonLink href="/cart/" onClick={closeDrawer} size="lg" fullWidth>
            View cart
          </ButtonLink>

          <button
            type="button"
            onClick={closeDrawer}
            className="w-full text-center text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            Continue shopping
          </button>
        </div>
      </div>
    </>
  )
}
