"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"

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
  const { applySummary } = useCart()
  const [quantity, setQuantity] = useState(item.quantity)
  const [pending, startUpdate] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const productTitle = item.variant?.product?.title ?? item.title
  const handle = item.variant?.product?.handle
  const thumbnail = item.thumbnail ?? item.variant?.product?.thumbnail ?? null

  useEffect(() => setQuantity(item.quantity), [item.quantity])

  function commit(next: number) {
    if (pending || next < 1) return
    const previous = quantity
    setQuantity(next)
    setError(null)

    // The action revalidates /cart and returns fresh server-rendered totals.
    // Keep one transition through that update; a second refresh can race it.
    startUpdate(async () => {
      try {
        applySummary(await setLineItemQuantity(item.id, next))
      } catch {
        setQuantity(previous)
        setError("Could not update. Try again.")
      }
    })
  }

  function remove() {
    if (pending) return
    setError(null)
    startUpdate(async () => {
      try {
        applySummary(await removeLineItem(item.id))
      } catch {
        setError("Could not remove. Try again.")
      }
    })
  }

  return (
    <li
      className={[
        "fl-bag-item",
        pending ? "opacity-60" : "opacity-100",
      ].join(" ")}
      aria-busy={pending}
    >
      <div className="fl-bag-item__image">
        <ProductImage
          src={thumbnail}
          alt=""
          label={productTitle}
          sizes="(max-width: 640px) 88px, 112px"
        />
      </div>

      <div className="fl-bag-item__details">
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
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          {item.variant?.title}
        </p>
        <p className="mt-2 text-xs text-ink-muted">{formatPrice(item.unit_price, currencyCode)} each</p>
        {error ? <p role="alert" className="pt-1 text-xs text-danger">{error}</p> : null}
      </div>

      <div className="fl-bag-item__quantity">
        <button
          type="button"
          onClick={() => commit(quantity - 1)}
          disabled={pending || quantity <= 1}
          aria-label={`Decrease quantity of ${productTitle}`}
          className="disabled:opacity-30"
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
        <button
          type="button"
          onClick={() => commit(quantity + 1)}
          disabled={pending}
          aria-label={`Increase quantity of ${productTitle}`}
          className="disabled:opacity-30"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <p className="fl-bag-item__price">
        {formatPrice(item.unit_price * quantity, currencyCode)}
      </p>

      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Remove ${productTitle} from bag`}
        className="fl-bag-item__remove"
      >
        <Trash2 size={15} aria-hidden="true" /><span>Remove</span>
      </button>
    </li>
  )
}
