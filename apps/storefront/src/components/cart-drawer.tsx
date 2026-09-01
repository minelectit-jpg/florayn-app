"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef } from "react"

import { useCart } from "@/components/cart-provider"
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
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
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
          "border-l border-[var(--color-line)] bg-[var(--color-paper)] shadow-xl outline-none",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          isDrawerOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <p className="text-sm font-medium">Added to cart</p>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close"
            className="px-2 py-1 text-xl leading-none text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {lastAdded ? (
            <div className="flex gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden border border-[var(--color-line)] bg-white">
                {lastAdded.thumbnail ? (
                  <Image
                    src={lastAdded.thumbnail}
                    alt=""
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug">
                  {lastAdded.productTitle}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  {lastAdded.variantTitle}
                </p>
                {lastAdded.sku ? (
                  <p className="text-xs text-[var(--color-ink-soft)]">
                    {lastAdded.sku}
                  </p>
                ) : null}
                <p className="pt-1 text-sm">
                  {formatPrice(
                    lastAdded.unitPrice,
                    summary?.currencyCode
                  )}
                  <span className="text-[var(--color-ink-soft)]">
                    {" "}
                    &times; {lastAdded.quantity}
                  </span>
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 border-t border-[var(--color-line)] px-5 py-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-[var(--color-ink-soft)]">
              Subtotal
              {summary ? (
                <span>
                  {" "}
                  ({summary.itemCount}{" "}
                  {summary.itemCount === 1 ? "item" : "items"})
                </span>
              ) : null}
            </span>
            <span className="display text-xl">
              {formatPrice(summary?.subtotal, summary?.currencyCode)}
            </span>
          </div>

          <Link
            href="/cart/"
            onClick={closeDrawer}
            className="block bg-[var(--color-ink)] px-6 py-3 text-center text-sm text-white"
          >
            View cart
          </Link>

          <button
            type="button"
            onClick={closeDrawer}
            className="w-full text-center text-sm underline underline-offset-4"
          >
            Continue shopping
          </button>
        </div>
      </div>
    </>
  )
}
