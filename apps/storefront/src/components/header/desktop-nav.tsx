"use client"

import { ChevronDown } from "lucide-react"
import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"

import type { Audience } from "@/lib/audience"
import { sectionsFor, type HeaderData, type NavSection } from "@/lib/header-data"

import IntentLink from "./intent-link"
import { LoadBoundary, loadable } from "./load-on-intent"
import type { MegaPanelProps } from "./mega-panel"
import { collectionsConfig, collectionsFor, familiesOf, stylesOf } from "./nav-model"

/** An owner-set badge ("New") after a label, the same pill as in the phone menu. */
export function NavBadge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-purple px-1.5 py-[2px] text-[10px] font-bold uppercase leading-[1.2] tracking-[.04em] text-white ${className}`}>
      {children}
    </span>
  )
}

/** Whether a section opens a panel; one with nothing to show is a plain link. */
export function hasPanel(section: NavSection, data: HeaderData, audience: Audience): boolean {
  switch (section.kind) {
    case "devices":
      return familiesOf(section, data).length > 0
    case "case_types":
      return stylesOf(section, data).length > 0
    case "collections":
      return collectionsFor(data, audience, collectionsConfig(section).limit).length > 0
    default:
      return section.groups.some((group) => group.links.length > 0)
  }
}

/* The panels' code (mega-panel.tsx) loads when the pointer or focus reaches the nav. */
const panelPart = loadable(() => import("./mega-panel"))
const LazyMegaPanel = lazy(panelPart.render)
const preloadPanels = () => {
  panelPart.preload().catch(() => {})
}

function Panel(props: MegaPanelProps) {
  const [Part] = useState(() => panelPart.loaded()?.default ?? LazyMegaPanel)
  return <Part {...props} />
}

const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 200

/**
 * The desktop nav row (1024px and up): the admin's sections for the shopper's
 * mode. `audience` is the shell's useAudience(), the mode the WOMEN/MEN pill,
 * the drawer and every IntentLink use, so the labels, the panels' filters and
 * the links always agree. On /men/… and the Women pages that is the path's
 * mode; on a shared page like /cart/ the server renders Women and the
 * remembered mode takes over right after hydration (useSyncExternalStore's
 * server snapshot keeps that mismatch-free); during a switch it is the mode
 * being switched to.
 *
 * A section with a panel opens it after a short hover, or with its chevron
 * (click, Enter or Space); a section with only a link is a link. Never a
 * button inside a link: a label that links sits beside its own chevron button.
 */
export default function DesktopNav({ data, audience, pathname }: { data: HeaderData; audience: Audience; pathname: string }) {
  const sections = sectionsFor(data, audience, "bar")
  const [open, setOpen] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  /** The panel hover opened: the click that usually follows keeps it open. */
  const hovered = useRef<string | null>(null)

  const stopTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }
  useEffect(() => () => stopTimers(), [])

  // Any navigation or mode change closes the panel (the other mode may not have that section).
  useEffect(() => {
    setOpen(null)
  }, [pathname, audience])

  // Esc closes and returns focus to the item's button; a press outside closes.
  useEffect(() => {
    if (!open) return
    const id = open
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setOpen(null)
      triggers.current.get(id)?.focus()
    }
    function onPointerDown(event: globalThis.PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [open])

  function enter(event: PointerEvent, id: string) {
    if (event.pointerType === "touch") return
    stopTimers()
    if (open) {
      // Already browsing the panels: switch at once.
      if (open !== id) hovered.current = id
      setOpen(id)
      return
    }
    openTimer.current = window.setTimeout(() => {
      hovered.current = id
      setOpen(id)
    }, HOVER_OPEN_MS)
  }

  function leave(event: PointerEvent) {
    if (event.pointerType === "touch") return
    window.clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(null), HOVER_CLOSE_MS)
  }

  function toggle(id: string) {
    stopTimers()
    if (open === id && hovered.current === id) {
      hovered.current = null
      return
    }
    hovered.current = null
    setOpen(open === id ? null : id)
  }

  const close = () => {
    stopTimers()
    setOpen(null)
  }

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="relative hidden border-t border-line lg:block"
      onPointerEnter={preloadPanels}
      onFocus={preloadPanels}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(null)
      }}
    >
      <ul className="mx-auto flex h-12 max-w-[1470px] items-center justify-center gap-8 px-[30px]">
        {sections.map((section) => {
          const panel = hasPanel(section, data, audience)
          if (!panel && !section.href) return null
          const isOpen = open === section.id
          const label = (
            <>
              {section.label}
              {section.badge ? <NavBadge className="ml-1.5">{section.badge}</NavBadge> : null}
            </>
          )
          const chevron = <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} />
          const control = {
            ref: (element: HTMLButtonElement | null) => {
              if (element) triggers.current.set(section.id, element)
              else triggers.current.delete(section.id)
            },
            type: "button" as const,
            "aria-expanded": isOpen,
            "aria-controls": `mega-${section.id}`,
            onClick: () => toggle(section.id),
          }
          return (
            <li
              key={section.id}
              className="flex h-full items-center"
              onPointerEnter={panel ? (event) => enter(event, section.id) : undefined}
              onPointerLeave={panel ? leave : undefined}
            >
              {panel && section.href ? (
                <>
                  <IntentLink href={section.href} onClick={close} className="flex h-11 items-center text-[15px] transition-colors hover:text-purple">
                    {label}
                  </IntentLink>
                  <button {...control} aria-label={`Show ${section.label} menu`} className="grid h-11 w-6 place-items-center rounded-full transition-colors hover:text-purple">
                    {chevron}
                  </button>
                </>
              ) : panel ? (
                <button {...control} className="flex h-11 items-center gap-1 text-[15px] transition-colors hover:text-purple">
                  {label}
                  {chevron}
                </button>
              ) : (
                <IntentLink href={section.href!} className="flex h-11 items-center text-[15px] transition-colors hover:text-purple">
                  {label}
                </IntentLink>
              )}
              {isOpen ? (
                <div className="absolute left-1/2 top-full z-[45] -translate-x-1/2 pt-2">
                  <LoadBoundary className="rounded-[16px] border border-line bg-paper px-6 py-5 text-[14px] text-ink-muted shadow-[0_20px_48px_-16px_rgba(26,22,37,0.32)]">
                    <Suspense fallback={null}>
                      <Panel section={section} data={data} audience={audience} onNavigate={close} />
                    </Suspense>
                  </LoadBoundary>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
