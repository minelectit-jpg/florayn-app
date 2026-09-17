"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * A horizontal scroller you can drag with the mouse, not just the scrollbar.
 *
 * The move/up listeners live on `document`, so a drag keeps tracking even when
 * the pointer leaves the rail or moves fast — the earlier element-only version
 * stuttered and dropped the drag. `mousedown` preventDefault stops text
 * selection and the browser's native image drag; a click that ends a real drag
 * is swallowed so a card link does not navigate. Touch keeps its native swipe.
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

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0 || !el) return
      drag.current = {
        down: true,
        startX: e.clientX,
        startScroll: el.scrollLeft,
        moved: false,
      }
      el.style.cursor = "grabbing"
      // Stop the native image/link drag and text selection.
      e.preventDefault()
    }

    function onMouseMove(e: MouseEvent) {
      if (!drag.current.down || !el) return
      const dx = e.clientX - drag.current.startX
      if (Math.abs(dx) > 3) drag.current.moved = true
      el.scrollLeft = drag.current.startScroll - dx
    }

    function onMouseUp() {
      if (!drag.current.down || !el) return
      drag.current.down = false
      el.style.cursor = "grab"
    }

    function onClickCapture(e: MouseEvent) {
      if (drag.current.moved) {
        e.preventDefault()
        e.stopPropagation()
        drag.current.moved = false
      }
    }

    el.addEventListener("mousedown", onMouseDown)
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    el.addEventListener("click", onClickCapture, true)
    return () => {
      el.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      el.removeEventListener("click", onClickCapture, true)
    }
  }, [])

  return (
    <ul
      ref={ref}
      aria-label={ariaLabel}
      className={className}
      draggable={false}
      style={{ cursor: "grab", userSelect: "none" }}
    >
      {children}
    </ul>
  )
}
