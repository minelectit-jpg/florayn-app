export const SHOP_PRIORITY_IMAGES = 8
export const SHOP_IMAGE_WAIT_MS = 4_000

/** Keep cold image transforms for later rows behind the first two desktop rows. */
export function watchShopImages(
  grid: HTMLElement,
  admit: (index: number) => void,
  release: () => void
): () => void {
  const cards = Array.from(grid.children).filter((child) => child.classList.contains("fl-card"))
  const critical = cards.slice(0, SHOP_PRIORITY_IMAGES)
  const settled = new Set<Element>()
  let finished = false
  let observer: IntersectionObserver | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    finished = true
    grid.removeEventListener("load", onSettled, true)
    grid.removeEventListener("error", onSettled, true)
    observer?.disconnect()
    if (timeout !== undefined) clearTimeout(timeout)
  }
  const finish = () => {
    if (finished) return
    stop()
    release()
  }
  const check = () => {
    if (critical.every((card) => {
      const image = card.querySelector<HTMLImageElement>(".fl-card__media > img")
      // Missing-image fallbacks and failed complete images must never hold up
      // other rows. The complete check also catches pre-hydration load events.
      return !image || image.complete || settled.has(card)
    })) finish()
  }
  function onSettled(event: Event) {
    if (finished) return
    const card = critical.find((candidate) => candidate.querySelector(".fl-card__media > img") === event.target)
    if (!card) return
    settled.add(card)
    check()
  }

  grid.addEventListener("load", onSettled, true)
  grid.addEventListener("error", onSettled, true)
  check()
  if (finished) return stop

  // A fast scroll must reveal images even when an earlier image is still slow.
  // Use one observer for the grid rather than one observer per product card.
  if (typeof IntersectionObserver === "undefined") {
    finish()
    return stop
  }
  const indices = new Map(cards.slice(SHOP_PRIORITY_IMAGES).map((card, index) => [card, index + SHOP_PRIORITY_IMAGES]))
  observer = new IntersectionObserver((entries) => {
    if (finished) return
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const index = indices.get(entry.target)
      if (index === undefined) continue
      admit(index)
      observer?.unobserve(entry.target)
      indices.delete(entry.target)
    }
  }, { rootMargin: "100px 0px", threshold: 0 })
  for (const card of indices.keys()) observer.observe(card)
  timeout = setTimeout(finish, SHOP_IMAGE_WAIT_MS)
  return stop
}
