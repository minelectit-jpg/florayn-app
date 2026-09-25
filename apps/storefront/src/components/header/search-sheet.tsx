"use client"

import { ArrowLeft, Search, Smartphone, X } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import IntentLink from "@/components/header/intent-link"
import { withAudience, type Audience } from "@/lib/audience"
import type { DevicesSectionConfig } from "@/lib/content"
import type { HeaderData, HeaderDevice } from "@/lib/header-data"
import { phoneOf, readDevice } from "@/lib/remembered-device"
import { preloadSearchIndex } from "@/lib/search/load-index"

import { LoadBoundary, retryImport } from "./load-on-intent"
import type { SearchResultsProps } from "./search-results"
import { SEARCH_INPUT_ID, type SearchSheetProps } from "./types"

/*
 * The search sheet's body, always mounted inside dialog#site-search
 * (header-dialogs.tsx) so the first tap on any search field can focus a real
 * input and bring the phone keyboard up. It stays light: the top bar, the
 * empty state (your phone, recent searches, Try) and the keyboard handling.
 * The results list and the engine (search-results.tsx) load on intent, and
 * the index only then (lib/search/load-index.ts).
 */

const RECENT_KEY = "fl_recent_searches"
const RECENT_MAX = 6

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string" && !!q.trim()).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage blocked (private mode): nothing to keep.
  }
}

/** The results code, retried once after a blip (header-dialogs.tsx has usually preloaded it). */
const SearchResults = lazy(() => retryImport(() => import("./search-results")))

/** Its content only after a moment, so a quick load never flashes "Loading…". */
export function Later({ children, ms = 150 }: { children: ReactNode; ms?: number }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), ms)
    return () => window.clearTimeout(timer)
  }, [ms])
  return shown ? <>{children}</> : null
}

/** A labelled group of results (Models, Designs, Try…). */
export function Group({ id, title, action, className, children }: {
  id: string
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-labelledby={id} className={className ? `fl-sr-group ${className}` : "fl-sr-group"}>
      <div className="fl-sr-group__head">
        <h2 id={id} className="fl-sr-group__title">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

/** The admin's Try suggestions (Admin > Search), never called Popular: they are chosen, not measured. */
export function TryChips({ id, words, onPick, className }: { id: string; words: string[]; onPick: (q: string) => void; className?: string }) {
  if (!words.length) return null
  return (
    <Group id={id} title="Try" className={className}>
      <ul className="fl-sr-chips">
        {words.map((word) => (
          <li key={word}>
            <button type="button" data-sr-item className="fl-sr-chip" onClick={() => onPick(word)}>
              {word}
            </button>
          </li>
        ))}
      </ul>
    </Group>
  )
}

/**
 * A key the results list moves focus on (arrows, Home, End, no modifier).
 * Never while an input method is composing (Bangla phonetic, CJK): its
 * candidate list owns the arrows, and Safari reports them as the real key with
 * isComposing (or keyCode 229 once composition has just ended).
 */
export function isListKey(event: {
  key: string
  keyCode?: number
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  nativeEvent?: { isComposing?: boolean }
}): boolean {
  if (event.nativeEvent?.isComposing || event.keyCode === 229) return false
  return ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey
}

/** The remembered phone's shop, linked the way the menu and search link a model (engine.ts modelHref). */
function phoneShopHref(data: HeaderData, audience: Audience, [slug, , family]: HeaderDevice): string {
  const sections = audience === "men" && data.men ? data.men : data.women
  const config = sections.find((s) => s.kind === "devices" && (s.config as DevicesSectionConfig | null)?.families?.some((f) => f === family))
    ?.config as DevicesSectionConfig | undefined
  const style = config?.case_type
  const form = family === "iphone" || family === "samsung" ? "phone" : family
  const sold = style ? data.caseTypes.find((c) => c[0] === style)?.[4] : undefined
  return style && sold && (!sold.length || sold.some((f) => f === form)) ? `/shop/${slug}/${style}/` : `/shop/${slug}/`
}

export default function SearchSheet({ data, audience, onClose }: SearchSheetProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const [device, setDevice] = useState<string | null>(null)
  const [announce, setAnnounce] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const exact = useRef<((q: string) => string | null) | null>(null)
  const announceTimer = useRef<number | undefined>(undefined)
  const clearOnClose = useRef(false)
  const typed = query.trim()
  const suggest = audience === "men" ? data.search.suggest.men : data.search.suggest.women

  // Recent searches and the remembered phone, read after hydration and again
  // each time the sheet opens (the shell focuses the input when it does).
  const refresh = useCallback(() => {
    setRecent(readRecent())
    setDevice(data.rememberDevice ? readDevice() : null)
  }, [data.rememberDevice])
  useEffect(() => refresh(), [refresh])

  // A chosen result or an Enter empties the field once the sheet has closed.
  useEffect(() => {
    const dialog = rootRef.current?.closest("dialog")
    if (!dialog) return
    const onClosed = () => {
      if (!clearOnClose.current) return
      clearOnClose.current = false
      setQuery("")
    }
    dialog.addEventListener("close", onClosed)
    return () => dialog.removeEventListener("close", onClosed)
  }, [])

  useEffect(() => {
    if (typed) return
    window.clearTimeout(announceTimer.current)
    setAnnounce("")
  }, [typed])
  useEffect(() => () => window.clearTimeout(announceTimer.current), [])

  const onCount = useCallback((count: number) => {
    window.clearTimeout(announceTimer.current)
    announceTimer.current = window.setTimeout(() => setAnnounce(count === 1 ? "1 result" : `${count} results`), 500)
  }, [])
  const onEngine = useCallback((find: ((q: string) => string | null) | null) => {
    exact.current = find
  }, [])

  function remember(q: string) {
    const value = q.trim()
    if (!value) return
    const next = [value, ...readRecent().filter((r) => r.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_MAX)
    writeRecent(next)
    setRecent(next)
  }

  function forget(q: string) {
    const next = readRecent().filter((r) => r !== q)
    writeRecent(next)
    setRecent(next)
    inputRef.current?.focus()
  }

  function clearRecent() {
    writeRecent([])
    setRecent([])
    inputRef.current?.focus()
  }

  const pick = useCallback((q: string) => {
    setQuery(q)
    inputRef.current?.focus()
  }, [])

  /** A result was chosen: keep the words, close, and empty the field once closed. */
  function choose() {
    remember(query)
    clearOnClose.current = true
    onClose()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!typed) return
    remember(typed)
    // One model and nothing else ("iphone 16"): straight to its shop.
    const href = exact.current?.(typed) ?? `/search/?q=${encodeURIComponent(typed)}`
    clearOnClose.current = true
    router.push(withAudience(href, audience))
    inputRef.current?.blur()
    onClose()
  }

  // Arrow keys: from the field to the first result, then between results.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isListKey(event)) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sr-item]") ?? []).filter((item) => item.offsetParent !== null)
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (event.target === inputRef.current) {
      if (event.key === "ArrowDown") next = 0
    } else if (at >= 0) {
      if (event.key === "ArrowDown") next = Math.min(at + 1, items.length - 1)
      else if (event.key === "ArrowUp") next = at - 1
      else if (event.key === "Home") next = 0
      else next = items.length - 1
    }
    if (next == null) return
    event.preventDefault()
    if (next < 0) inputRef.current?.focus()
    else items[next].focus()
  }

  // Only a phone counts as "your phone": a stale AirPods/watch/wallet slug reads as none.
  const phone = phoneOf(device, data.devices)
  const results: SearchResultsProps = { query, audience, data, device: phone ? phone[0] : null, onPick: pick, onChoose: choose, onCount, onEngine }

  return (
    <div ref={rootRef} className="fl-search" onKeyDown={onKeyDown}>
      <div className="mx-auto flex h-14 w-full max-w-[1080px] shrink-0 items-center gap-1 border-b border-line px-2 md:h-[72px] md:gap-3 md:border-b-0 md:px-[30px]">
        <button type="button" aria-label="Close search" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-full text-ink md:hidden">
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <form role="search" action={withAudience("/search/", audience)} method="get" onSubmit={submit} className="relative flex-1">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-ink" />
          <input
            ref={inputRef}
            id={SEARCH_INPUT_ID}
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search"
            aria-controls="search-results"
            placeholder={data.search.placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              refresh()
              preloadSearchIndex()
            }}
            className="h-11 w-full rounded-full bg-field pl-10 pr-10 text-[16px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple md:h-12"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => pick("")}
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:text-ink md:right-1.5"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </form>
        <button type="button" onClick={onClose} className="hidden h-11 shrink-0 items-center rounded-full px-3 text-[14px] font-medium text-ink hover:text-purple md:inline-flex">
          Close
        </button>
      </div>

      <div id="search-results" ref={listRef} className="fl-search__body">
        <div className="mx-auto w-full max-w-[1080px] md:px-[30px]">
          {typed ? (
            <LoadBoundary className="fl-sr-note">
              <Suspense fallback={<Later><p className="fl-sr-note">Loading…</p></Later>}>
                <SearchResults {...results} />
              </Suspense>
            </LoadBoundary>
          ) : (
            <div className="pb-2">
              {phone ? (
                <div className="fl-sr-group">
                  <IntentLink data-sr-item href={phoneShopHref(data, audience, phone)} onClick={choose} className="fl-sr-chip">
                    <Smartphone size={16} aria-hidden="true" className="text-purple" />
                    Cases for {phone[1]}
                  </IntentLink>
                </div>
              ) : null}
              {recent.length ? (
                <Group
                  id="sr-recent"
                  title="Recent searches"
                  action={<button type="button" onClick={clearRecent} className="fl-sr-link">Clear</button>}
                >
                  <ul className="fl-sr-chips">
                    {recent.map((q) => (
                      <li key={q} className="fl-sr-pair">
                        <button type="button" data-sr-item className="fl-sr-chip" onClick={() => pick(q)}>
                          {q}
                        </button>
                        <button type="button" aria-label={`Remove ${q}`} className="fl-sr-remove" onClick={() => forget(q)}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Group>
              ) : null}
              <TryChips id="sr-try" words={suggest} onPick={pick} />
            </div>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{typed ? announce : ""}</p>
    </div>
  )
}
