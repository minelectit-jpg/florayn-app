"use client"

import { Search, X } from "lucide-react"
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react"

import SearchSheet from "@/components/header/search-sheet"
import { stripAudience, withAudience, type Audience } from "@/lib/audience"
import type { HeaderData } from "@/lib/header-data"
import { loadSearchIndex } from "@/lib/search/load-index"

import { LoadBoundary, loadable, retryImport } from "./load-on-intent"
import { DRAWER_ID, SEARCH_ID, SEARCH_INPUT_ID, type NavDrawerProps } from "./types"

/*
 * The header's two sheets, the menu drawer and search, are native <dialog>s
 * that are always in the page and opened with showModal(): the browser then
 * gives the top layer, an inert page behind, Esc, Android Back and focus
 * containment for free. This file opens and closes them (with a short exit
 * animation), returns focus to whatever opened them, and loads their heavier
 * parts only when the shopper shows intent.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/* ---- Loading on intent (load-on-intent.tsx) ------------------------------ */

export { LoadBoundary, loadable, retryImport }

/** The menu's levels (nav-drawer.tsx): starts downloading on intent, before the tap. */
const drawerPart = loadable(() => import("./nav-drawer"))
export const preloadNavDrawer = drawerPart.preload
const LazyNavDrawer = lazy(drawerPart.render)

/** Mounted on the first open: the levels as they are if already here, else lazily. */
function DrawerLevels(props: NavDrawerProps) {
  const [Levels] = useState(() => drawerPart.loaded()?.default ?? LazyNavDrawer)
  return <Levels {...props} />
}

const preloadSearchResults = loadable(() => import("./search-results")).preload

/** The search index and the results code, on the first sign of wanting to search. */
export function preloadSearch() {
  loadSearchIndex().catch(() => {
    // The sheet shows "Press Enter to search"; the next intent tries again.
  })
  preloadSearchResults().catch(() => {})
}

/** Pointer, touch, focus and hover on a search trigger all start loading search. */
export const searchIntent = {
  onPointerDown: preloadSearch,
  onTouchStart: preloadSearch,
  onFocus: preloadSearch,
  onMouseEnter: preloadSearch,
}

/**
 * The same without focus, for the menu drawer's search field: showModal()
 * focuses the drawer's first focusable element, which is that field, so
 * focus there means "opened the menu", not "wants to search". A shopper who
 * only browses the menu never downloads the index or the results code; one
 * who activates the field still loads it at once (openSearch preloads).
 */
export const searchPressIntent = {
  onPointerDown: preloadSearch,
  onTouchStart: preloadSearch,
  onMouseEnter: preloadSearch,
}

/* ---- Opening and closing ------------------------------------------------- */

/** What opened each sheet, to hand focus back to on close. */
const triggers = new WeakMap<HTMLDialogElement, HTMLElement | null>()
/** A running exit animation's cleanup, per sheet. */
const exits = new WeakMap<HTMLDialogElement, () => void>()

export function sheetById(id: string): HTMLDialogElement | null {
  if (typeof document === "undefined") return null
  const element = document.getElementById(id)
  return element instanceof HTMLDialogElement ? element : null
}

function anySheetOpen() {
  return !!document.querySelector("dialog.fl-sheet[open]")
}

function closeNow(dialog: HTMLDialogElement) {
  exits.get(dialog)?.()
  exits.delete(dialog)
  if (!dialog.open) return
  if (dialog.dataset.fallback === undefined && typeof dialog.close === "function") {
    dialog.close()
  } else {
    dialog.removeAttribute("open")
    dialog.dispatchEvent(new Event("close"))
  }
}

/**
 * Open a sheet as a modal. Where showModal() is missing (very old browsers)
 * it falls back to the open attribute; useFocusTrap then keeps focus inside.
 * Returns false when there is no such sheet, so a link can still navigate.
 */
export function openSheet(dialog: HTMLDialogElement | null, trigger?: HTMLElement | null): boolean {
  if (!dialog) return false
  if (dialog.dataset.closing !== undefined) closeNow(dialog)
  if (dialog.open) return true
  const active = document.activeElement
  triggers.set(dialog, trigger ?? (active instanceof HTMLElement && active !== document.body ? active : null))
  delete dialog.dataset.closing
  try {
    dialog.showModal()
  } catch {
    dialog.dataset.fallback = ""
    dialog.setAttribute("open", "")
    dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }
  return true
}

/**
 * Close a sheet. Animated: data-closing starts the exit (see header.css and
 * the panels' own CSS), then it closes when the panel's transition ends or
 * after 300ms. Esc and Android Back skip this and close at once (native).
 */
export function closeSheet(dialog: HTMLDialogElement | null, animate = true) {
  if (!dialog?.open) return
  if (!animate) return closeNow(dialog)
  if (dialog.dataset.closing !== undefined) return
  dialog.dataset.closing = ""
  const onEnd = (event: TransitionEvent) => {
    // Only the panel's own exit counts (a direct child), not a button's hover fade.
    if ((event.target as Element | null)?.parentElement === dialog && !event.pseudoElement) closeNow(dialog)
  }
  const timer = window.setTimeout(() => closeNow(dialog), 300)
  dialog.addEventListener("transitionend", onEnd)
  exits.set(dialog, () => {
    window.clearTimeout(timer)
    dialog.removeEventListener("transitionend", onEnd)
  })
}

/**
 * Open search from any trigger: showModal() then focus the always-mounted
 * input, in the same tap, so the phone keyboard comes up on the first press.
 */
export function openSearch(trigger?: HTMLElement | null): boolean {
  preloadSearch()
  if (!openSheet(sheetById(SEARCH_ID), trigger)) return false
  document.getElementById(SEARCH_INPUT_ID)?.focus()
  return true
}

/** A search link's click: open the sheet instead of the /search/ page (a new-tab click still navigates). */
export function onSearchLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (openSearch(event.currentTarget)) event.preventDefault()
}

function trapTab(root: HTMLElement, event: KeyboardEvent) {
  const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Keep Tab inside `ref` and close on Escape while `active` (a flag, or a
 * check made on each key press). The cart drawer's trap, shared.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean | (() => boolean), onEscape?: () => void) {
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })
  useEffect(() => {
    if (active === false) return
    function onKeyDown(event: KeyboardEvent) {
      const root = ref.current
      if (!root || (typeof active === "function" && !active())) return
      if (event.key === "Escape") escape.current?.()
      else if (event.key === "Tab") trapTab(root, event)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [ref, active])
}

/**
 * What every sheet does: tidy up and hand focus back on close, trap focus in
 * the fallback, and close on a press outside the panel (on the dialog itself,
 * which fills the screen behind the panel).
 */
function useSheet(ref: RefObject<HTMLDialogElement | null>, onClosed?: () => void) {
  const closed = useRef(onClosed)
  useEffect(() => {
    closed.current = onClosed
  })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    function onClose() {
      if (!dialog || dialog.open) return // Stale: the sheet was opened again meanwhile.
      exits.get(dialog)?.()
      exits.delete(dialog)
      delete dialog.dataset.closing
      delete dialog.dataset.fallback
      const trigger = triggers.get(dialog)
      triggers.delete(dialog)
      // Handing over to the other sheet (menu -> search) keeps focus there.
      if (trigger?.isConnected && !anySheetOpen()) trigger.focus({ preventScroll: true })
      closed.current?.()
    }
    dialog.addEventListener("close", onClose)
    return () => dialog.removeEventListener("close", onClose)
  }, [ref])

  const inFallback = useCallback(() => !!ref.current?.open && ref.current.dataset.fallback !== undefined, [ref])
  useFocusTrap(ref, inFallback, () => closeSheet(ref.current, false))

  const pressedOutside = useRef(false)
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = event.target === event.currentTarget
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      // Both ends of the press on the dialog itself, so a drag out of the panel never closes it.
      if (pressedOutside.current && event.target === event.currentTarget) closeSheet(event.currentTarget)
      pressedOutside.current = false
    },
  }
}

/* ---- The menu drawer ----------------------------------------------------- */

function DrawerSkeleton() {
  return (
    <div className="py-2" aria-busy="true">
      <p role="status" className="sr-only">Loading the menu</p>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex h-[72px] items-center gap-3.5 px-4">
          <span className="size-[52px] shrink-0 rounded-full bg-field" />
          <span className="h-3.5 w-[120px] rounded-full bg-field" />
        </div>
      ))}
    </div>
  )
}

/**
 * dialog#site-drawer: the top bar (search field and Close) paints at once;
 * the levels below (nav-drawer.tsx) arrive lazily, over a skeleton the first
 * time. It closes when the page changes (a WOMEN/MEN switch keeps it open)
 * and when the window grows to the desktop layout, which has no drawer.
 */
export function MenuDrawer({
  dialogRef,
  data,
  audience,
  pathname,
  openCount,
  onClosed,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>
  data: HeaderData
  audience: Audience
  pathname: string
  openCount: number
  onClosed: () => void
}) {
  const sheet = useSheet(dialogRef, onClosed)
  const close = useCallback(() => closeSheet(dialogRef.current), [dialogRef])

  const page = useRef(stripAudience(pathname))
  useEffect(() => {
    const plain = stripAudience(pathname)
    if (plain !== page.current) closeSheet(dialogRef.current)
    page.current = plain
  }, [pathname, dialogRef])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width:1024px)")
    const onChange = () => {
      if (desktop.matches) closeSheet(dialogRef.current, false)
    }
    desktop.addEventListener("change", onChange)
    return () => desktop.removeEventListener("change", onChange)
  }, [dialogRef])

  // On phones and tablets, fetch the menu's code in a quiet moment after load.
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (saveData || !window.matchMedia("(max-width:1023px)").matches) return
    let timer: number | undefined
    let idle: number | undefined
    const start = () => {
      timer = window.setTimeout(() => {
        const warm = () => preloadNavDrawer().catch(() => {})
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(warm)
        else warm()
      }, 3000)
    }
    if (document.readyState === "complete") start()
    else window.addEventListener("load", start, { once: true })
    return () => {
      window.removeEventListener("load", start)
      window.clearTimeout(timer)
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
    }
  }, [])

  function toSearch(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !sheetById(SEARCH_ID)) return
    event.preventDefault()
    const drawer = dialogRef.current
    // Focus returns to Menu when search closes: the link pressed is gone by then.
    const menu = drawer ? triggers.get(drawer) ?? null : null
    if (drawer) closeNow(drawer)
    openSearch(menu)
  }

  const levels: NavDrawerProps = { data, audience, pathname, openCount, onNavigate: close }

  return (
    <dialog ref={dialogRef} id={DRAWER_ID} className="fl-sheet fl-sheet--left" aria-label="Menu" {...sheet}>
      <div className="fl-panel">
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-4">
          <a
            href={withAudience("/search/", audience)}
            onClick={toSearch}
            {...searchPressIntent}
            className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-field px-4 text-[14px] text-ink-muted"
          >
            <Search size={18} className="shrink-0 text-ink" aria-hidden="true" />
            <span className="truncate">{data.search.placeholder}</span>
          </a>
          <button type="button" aria-label="Close menu" onClick={close} className="grid size-11 shrink-0 place-items-center rounded-full text-ink">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        {openCount > 0 ? (
          <LoadBoundary>
            <Suspense fallback={<DrawerSkeleton />}>
              <DrawerLevels {...levels} />
            </Suspense>
          </LoadBoundary>
        ) : null}
      </div>
    </dialog>
  )
}

/* ---- Search -------------------------------------------------------------- */

function typingIn(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/**
 * dialog#site-search with the search sheet (search-sheet.tsx) always mounted
 * inside, so its input exists before the first tap. "/" or Ctrl/Cmd+K opens
 * it from anywhere but a text field or another open dialog.
 */
export function SearchDialog({ data, audience, pathname }: { data: HeaderData; audience: Audience; pathname: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const sheet = useSheet(ref)
  const close = useCallback(() => closeSheet(ref.current), [])

  const page = useRef(pathname)
  useEffect(() => {
    if (pathname !== page.current) closeSheet(ref.current)
    page.current = pathname
  }, [pathname])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey) return
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey
      const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k"
      if (!slash && !shortcut) return
      if (typingIn(event.target) || anySheetOpen() || document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])')) return
      event.preventDefault()
      const active = document.activeElement
      openSearch(active instanceof HTMLElement && active !== document.body ? active : null)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <dialog ref={ref} id={SEARCH_ID} className="fl-sheet fl-sheet--search" aria-label="Search" {...sheet}>
      <SearchSheet data={data} audience={audience} onClose={close} />
    </dialog>
  )
}
