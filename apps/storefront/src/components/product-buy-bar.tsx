"use client"

import { ChevronDown } from "lucide-react"
import { useEffect, useState, type RefObject } from "react"

import { Spinner } from "@/components/ui/button"

/**
 * True once the element has scrolled up under the sticky header, false while
 * it is on screen or still below. One IntersectionObserver, no scroll or
 * resize listeners; it is rebuilt when the phone header tucks its logo row
 * away or brings it back (data-tuck), so "under the header" always means the
 * part of the header covering the page. It starts false on the server and on
 * the first client render, so the markup is identical until after mount (no
 * hydration mismatch).
 */
export function useScrolledPast(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el || typeof IntersectionObserver === "undefined") {
      setPast(false)
      return
    }
    const header = document.querySelector<HTMLElement>("[data-store-header]")
    let observer: IntersectionObserver | null = null
    const watch = () => {
      observer?.disconnect()
      const tucked = header?.dataset.tuck !== undefined ? (header.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0 : 0
      const cover = Math.max(0, Math.round((header?.getBoundingClientRect().height ?? 0) - tucked))
      observer = new IntersectionObserver(
        ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? cover)),
        { rootMargin: `-${cover}px 0px 0px 0px` }
      )
      observer.observe(el)
    }
    watch()
    const tuck = header && typeof MutationObserver !== "undefined" ? new MutationObserver(watch) : null
    if (header) tuck?.observe(header, { attributes: true, attributeFilter: ["data-tuck"] })
    return () => {
      tuck?.disconnect()
      observer?.disconnect()
    }
  }, [ref, enabled])
  return past
}

/**
 * The quick-buy bar on phones and tablets (below 1024px): the price, the
 * chosen model (tap to change it) and one button, shown once the shopper has
 * scrolled past the buy buttons. Rendered in place inside the buy box: the
 * details column is only sticky from 1024px up, where this bar is hidden, so
 * nothing below 1024px gives it a containing block. If the details panel ever
 * gets sticky, a transform or a filter below 1024px, move this to a portal.
 * Results are announced by the buy box's one status region, not here.
 */
export default function ProductBuyBar({
  visible,
  armed,
  price,
  detail,
  onDetail,
  action,
  label,
  soldOut,
  busy,
  pending,
  added,
  onAction,
  onIntent,
}: {
  visible: boolean
  /** Whether the bar can show at all here (not in bundle mode, a case selected); the page keeps room for it only then. */
  armed: boolean
  price: string
  detail: string
  onDetail: (() => void) | null
  action: "buy_now" | "add_to_cart"
  label: string
  soldOut: boolean
  busy: boolean
  pending: boolean
  added: boolean
  onAction: () => void
  onIntent?: () => void
}) {
  const summary = (
    <>
      <span className="fl-buybar__price">{price}</span>
      <span className="fl-buybar__variant">
        <span className="truncate">{detail}</span>
        {onDetail ? <ChevronDown size={12} aria-hidden="true" className="shrink-0" /> : null}
      </span>
    </>
  )
  const blocked = busy && !pending
  return (
    <div className="fl-buybar" data-visible={visible ? "true" : "false"} data-armed={armed ? "true" : "false"} inert={!visible} aria-hidden={!visible} role="region" aria-label="Quick buy">
      <div className="fl-buybar__inner">
        {onDetail ? (
          <button type="button" className="fl-buybar__detail" onClick={onDetail} aria-label={`Change model. ${detail}, ${price}`}>
            {summary}
          </button>
        ) : (
          <div className="fl-buybar__detail">{summary}</div>
        )}
        <button
          type="button"
          className={`fl-buy-cta fl-buybar__cta ${action === "buy_now" ? "fl-buy-cta--primary" : "fl-buy-cta--ink"}`}
          disabled={soldOut}
          aria-disabled={blocked || undefined}
          aria-busy={pending || undefined}
          aria-label={soldOut ? `Sold out, ${detail}` : `${label}, ${detail}, ${price}`}
          onClick={() => { if (!blocked) onAction() }}
          onPointerEnter={onIntent}
          onPointerDown={onIntent}
          onFocus={onIntent}
        >
          {soldOut ? "Sold out" : pending ? (
            <><Spinner />{action === "buy_now" ? "Checkout…" : "Adding…"}</>
          ) : added ? (
            <>Added <span aria-hidden="true">&#10003;</span></>
          ) : (
            <span className="fl-buy-cta__label">{label}</span>
          )}
        </button>
      </div>
    </div>
  )
}
