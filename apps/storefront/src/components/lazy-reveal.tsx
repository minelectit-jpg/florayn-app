"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/**
 * Defer mounting below-the-fold content until the viewport nears it.
 *
 * Both server and client render `null` on the first pass (useState(false)), so
 * there is no hydration mismatch — the wrapped tree is simply never in the
 * initial DOM and never hydrated until an IntersectionObserver (or the timeout
 * fallback) flips it on ~`rootMargin` before it scrolls in, which keeps the
 * initial main-thread work off a low-end phone without a visible pop-in. A
 * reserved `minHeight` holds space so revealing it does not shift the page.
 */
export default function LazyReveal({
  children,
  minHeight = 320,
  rootMargin = "800px",
}: {
  children: ReactNode
  minHeight?: number
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin }
    )
    io.observe(el)
    // Safety net: reveal after a short idle even if the observer never fires
    // (e.g. a page tall enough that it is already past, or an odd viewport).
    const t = setTimeout(() => setShown(true), 2500)
    return () => {
      io.disconnect()
      clearTimeout(t)
    }
  }, [shown, rootMargin])

  return (
    <div ref={ref} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  )
}
