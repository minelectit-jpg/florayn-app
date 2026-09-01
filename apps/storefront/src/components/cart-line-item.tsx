"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { useCart } from "@/components/cart-provider"
import ProductImage from "@/components/product-image"
import { removeLineItem, setLineItemQuantity, type CartItem } from "@/lib/cart"
import { formatPrice } from "@/lib/money"

/**
 * The quantity stepper writes straight through to the server rather than
 * offering an "Update" button that looks inert until the page reloads. The row
 * dims while the write is in flight and the header badge moves with it.
 */
export default function CartLineItem({
  item,
  currencyCode,
}: {
  item: CartItem
  currencyCode: string
}) {
  const router = useRouter()
  const { applySummary } = useCart()
  const [quantity, setQuantity] = useState(item.quantity)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productTitle = item.variant?.product?.title ?? item.title
  const handle = item.variant?.product?.handle
  const thumbnail = item.thumbnail ?? item.variant?.product?.thumbnail ?? null

  async function commit(next: number) {
    const previous = quantity
    setQuantity(next)
    setBusy(true)
    setError(null)

    try {
      const summary = await setLineItemQuantity(item.id, next)
      applySummary(summary)
      router.refresh()
    } catch {
      setQuantity(previous)
      setError("Could not update. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const summary = await removeLineItem(item.id)
      applySummary(summary)
      router.refresh()
    } catch {
      setError("Could not remove. Try again.")
      setBusy(false)
    }
  }

  return (
    <li
      className={[
        "flex flex-wrap items-center gap-4 py-5 transition-opacity",
        busy ? "opacity-50" : "opacity-100",
      ].join(" ")}
      aria-busy={busy}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden border border-line bg-paper">
        <ProductImage
          src={thumbnail}
          alt=""
          label={productTitle}
          sizes="80px"
        />
      </div>

      <div className="min-w-0 flex-1">
        {handle ? (
          <Link
            href={`/product/${handle}/`}
            className="display text-base transition-colors hover:text-purple"
          >
            {productTitle}
          </Link>
        ) : (
          <p className="display text-base">{productTitle}</p>
        )}
        <p className="eyebrow pt-1">
          {item.variant?.title}
          {item.variant?.sku ? ` · ${item.variant.sku}` : ""}
        </p>
        {error ? <p className="pt-1 text-xs text-danger">{error}</p> : null}
      </div>

      <div className="flex items-center border border-line bg-surface">
        <button
          type="button"
          onClick={() => commit(quantity - 1)}
          disabled={busy || quantity <= 1}
          aria-label={`Decrease quantity of ${productTitle}`}
          className="px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          &minus;
        </button>
        <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
        <button
          type="button"
          onClick={() => commit(quantity + 1)}
          disabled={busy}
          aria-label={`Increase quantity of ${productTitle}`}
          className="px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          +
        </button>
      </div>

      <p className="w-24 text-right text-sm tabular-nums">
        {formatPrice(item.unit_price * quantity, currencyCode)}
      </p>

      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="eyebrow transition-colors hover:text-danger disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  )
}
