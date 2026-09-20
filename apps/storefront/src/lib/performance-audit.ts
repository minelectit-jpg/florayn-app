export type PerformanceReading = {
  path: string
  kind: "document" | "navigation"
  ttfbMs?: number
  lcpMs?: number
  /** Observed upper bound: the diagnostic may mount after the page is ready. */
  productReadyMs?: number
  resourceKB?: number
}

/** Opt-in, local measurements only. No storage, fetches or analytics calls. */
export function startPerformanceAudit(onReading: (reading: PerformanceReading) => void) {
  let started = 0
  let target = window.location.pathname
  let generation = 0
  let ready = false
  let stopped = false
  let frame = 0
  let latest: PerformanceReading = { path: target, kind: "document" }
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  if (navigation) latest.ttfbMs = Math.round(navigation.responseStart)
  onReading({ ...latest })

  const observer = typeof PerformanceObserver === "undefined" ? null : new PerformanceObserver((list) => {
    if (stopped || latest.kind !== "document") return
    const last = list.getEntries().at(-1)
    if (last) {
      latest.lcpMs = Math.round(last.startTime)
      onReading({ ...latest })
    }
  })
  try { observer?.observe({ type: "largest-contentful-paint", buffered: true }) } catch {}

  const check = () => {
    if (stopped || ready || target !== window.location.pathname) return
    const root = Array.from(document.querySelectorAll<HTMLElement>("[data-product-ready]"))
      .find((element) => element.dataset.productPath === target && element.dataset.productHydrated === "true")
    const img = root?.querySelector<HTMLImageElement>("[data-product-hero] img")
    if (!root || !img?.complete || !img.naturalWidth) return
    const attempt = generation
    const source = img.currentSrc || img.src
    const isCurrent = () => !stopped && attempt === generation &&
      target === window.location.pathname && root.isConnected &&
      root.dataset.productPath === target && root.dataset.productHydrated === "true" &&
      root.querySelector("[data-product-hero] img") === img &&
      (img.currentSrc || img.src) === source && img.complete && img.naturalWidth > 0
    const retryCurrent = () => {
      if (!stopped && attempt === generation) {
        ready = false
        check()
      }
    }
    ready = true
    void img.decode().then(() => {
      if (!isCurrent()) return retryCurrent()
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!isCurrent()) return retryCurrent()
          latest.productReadyMs = Math.round(performance.now() - started)
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
          latest.resourceKB = Math.round(resources.filter((entry) => entry.startTime >= started)
            .reduce((sum, entry) => sum + entry.transferSize, 0) / 1024)
          onReading({ ...latest })
        })
      })
    }).catch(() => {
      // A failed decode is not a decoded hero. Wait for a subsequent load or
      // source change instead of reporting a successful readiness reading.
      if (attempt === generation) ready = false
    })
  }
  const mutations = new MutationObserver(check)
  mutations.observe(document.querySelector("main") ?? document.body, {
    childList: true, subtree: true, attributes: true,
  })
  const beginNavigation = (path: string) => {
    generation += 1
    cancelAnimationFrame(frame)
    target = path
    started = performance.now()
    ready = false
    latest = { path: target, kind: "navigation" }
    onReading({ ...latest })
  }
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") ||
        anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return
    beginNavigation(anchor.pathname)
  }
  const popstate = () => {
    beginNavigation(window.location.pathname)
    check()
  }
  document.addEventListener("click", click, true)
  document.addEventListener("load", check, true)
  window.addEventListener("popstate", popstate)
  check()
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    observer?.disconnect()
    mutations.disconnect()
    document.removeEventListener("click", click, true)
    document.removeEventListener("load", check, true)
    window.removeEventListener("popstate", popstate)
  }
}
