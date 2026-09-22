"use client"

import { useEffect, useRef, useState } from "react"

import { useCart } from "@/components/cart-provider"
import ShoppingBagIcon from "@/components/shopping-bag-icon"

/**
 * Compact bag button with a visible circular surface and a 44px touch target.
 * The selected variant stays authoritative; adding opens the cart drawer.
 */
export default function QuickAdd({
  variantId,
  productTitle,
  variantTitle,
  unitPrice,
  thumbnail,
  disabled,
}: {
  variantId: string | null
  productTitle: string
  variantTitle: string
  unitPrice: number
  thumbnail: string | null
  disabled?: boolean
}) {
  const { add } = useCart()
  const [state, setState] = useState<"idle" | "loading" | "added">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [])

  if (!variantId || disabled) {
    return <span className="fl-qadd-wrap" aria-hidden="true" />
  }

  async function onClick(event: React.MouseEvent) {
    // The control sits inside the card's link; adding must not navigate.
    event.preventDefault()
    event.stopPropagation()

    if (state === "loading") {
      return
    }

    setState("loading")
    try {
      await add(variantId!, 1, {
        productTitle,
        variantTitle,
        unitPrice,
        thumbnail,
      })
      setState("added")
    } catch {
      setState("idle")
    }
    if (timer.current) {
      clearTimeout(timer.current)
    }
    timer.current = setTimeout(() => setState("idle"), 2000)
  }

  return (
    <span className="fl-qadd-wrap">
      <button
        type="button"
        onClick={onClick}
        className={`fl-qadd${state === "loading" ? " is-loading" : ""}${
          state === "added" ? " is-added" : ""
        }`}
        aria-label={`Add ${productTitle}, ${variantTitle}, to cart`}
      >
        <ShoppingBagIcon className="fl-qadd__icon" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[2px] top-[1px] text-[11px] font-semibold leading-none"
        >
          +
        </span>
      </button>
    </span>
  )
}
