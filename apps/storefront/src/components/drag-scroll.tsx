"use client"

import { useRef, type ReactNode } from "react"

/**
 * A horizontal scroller you can drag with the mouse, not just the scrollbar.
 * Touch keeps its native swipe (we only hijack the mouse), and a click that
 * ends a real drag is swallowed so a card link inside does not navigate.
 */
export default function DragScroll({
  className,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string
  children: ReactNode
  "aria-label"?: string
}) {
  const ref = useRef<HTMLUListElement>(null)
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false })

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "mouse") return
    const el = ref.current
    if (!el) return
    drag.current = {
      down: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current
    if (!el || !drag.current.down) return
    const dx = e.clientX - drag.current.startX
    if (Math.abs(dx) > 4) drag.current.moved = true
    el.scrollLeft = drag.current.startScroll - dx
  }

  function endDrag() {
    drag.current.down = false
  }

  function onClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }

  return (
    <ul
      ref={ref}
      aria-label={ariaLabel}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
      style={{ cursor: "grab", userSelect: "none" }}
    >
      {children}
    </ul>
  )
}
