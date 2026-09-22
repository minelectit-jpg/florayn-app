"use client"

import { useEffect, useRef, type ReactNode } from "react"

/** A tall buy box scrolls into view before its bottom sticks. No nested scroll area. */
export default function ProductDetailsSticky({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    const header = document.querySelector<HTMLElement>("[data-store-header]")
    const measure = () => {
      const headerOffset = (header?.getBoundingClientRect().height ?? 126) + 24
      const bottomOffset = window.innerHeight - panel.getBoundingClientRect().height - 24
      panel.style.setProperty("--product-sticky-top", `${Math.min(headerOffset, bottomOffset)}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    if (header) observer.observe(header)
    window.addEventListener("resize", measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  return <div ref={ref} className="fl-product-details lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start">{children}</div>
}
