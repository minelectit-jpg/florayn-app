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
 *
 * `indicator` adds a thin slider bar under the rail that shows how far along
 * it is. Phones hide native scrollbars, so this is what tells a shopper there
 * is more to swipe to. It hides itself when everything already fits, and moves
 * by direct style updates (no re-render per scroll frame).
 */
export default function DragScroll({
  className,
  children,
  indicator = false,
  "aria-label": ariaLabel,
}: {
  className?: string
  children: ReactNode
  indicator?: boolean
  "aria-label"?: string
}) {
  const ref = useRef<HTMLUListElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
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

  useEffect(() => {
    const el = ref.current
    const bar = barRef.current
    const thumb = thumbRef.current
    if (!indicator || !el || !bar || !thumb) return

    let frame = 0
    function update() {
      frame = 0
      if (!el || !bar || !thumb) return
      const overflow = el.scrollWidth - el.clientWidth
      if (overflow <= 1) {
        bar.dataset.hidden = "true"
        return
      }
      delete bar.dataset.hidden
      const share = el.clientWidth / el.scrollWidth
      const travel = bar.clientWidth * (1 - share)
      thumb.style.width = `${share * 100}%`
      thumb.style.transform = `translateX(${(el.scrollLeft / overflow) * travel}px)`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    el.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [indicator])

  const list = (
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

  if (!indicator) return list
  return (
    <>
      {list}
      {/* Decorative: the list itself is the scrollable, labelled element. */}
      <div ref={barRef} className="fl-scrollbar" aria-hidden="true">
        <span ref={thumbRef} />
      </div>
    </>
  )
}
