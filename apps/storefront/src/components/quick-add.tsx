"use client"

import { useEffect, useRef, useState } from "react"

import { useCart } from "@/components/cart-provider"

/**
 * The card's quick-add control, matching .fl-qadd on florayn.com: a bare 23px
 * glyph in a 28px box - no border, background or shadow - that turns Florayn
 * violet and lifts slightly on hover. It is visible at rest rather than
 * appearing on hover, because it has to be reachable on touch.
 *
 * The 44x44 ::before is a transparent tap target. The glyph itself is well
 * under the WCAG 2.5.8 minimum, so the hit area is enlarged without changing
 * the visual size.
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
        <BagPlusIcon />
      </button>
    </span>
  )
}

/** Shopping bag with a small plus at the top right, on a 24 grid. */
function BagPlusIcon() {
  return (
    <svg
      className="fl-qadd__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 8.5h11l-.9 11a1.6 1.6 0 0 1-1.6 1.5H7a1.6 1.6 0 0 1-1.6-1.5z" />
      <path d="M7.6 8.5V6.4A2.4 2.4 0 0 1 10 4a2.4 2.4 0 0 1 2.4 2.4v2.1" />
      <path d="M18.5 3.2v4.6M20.8 5.5h-4.6" />
    </svg>
  )
}
