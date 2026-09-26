"use client"

import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, MessageCircle, UserRound } from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"

import AudienceToggle from "@/components/audience-toggle"
import IntentLink from "@/components/header/intent-link"
import {
  caseStyleHref,
  collectionsConfig,
  collectionsFor,
  exampleQueries,
  familiesOf,
  modelCount,
  modelsOf,
  resolveSection,
  sectionForm,
  seriesGroups,
  shopHref,
  styleFromPrice,
  stylesOf,
  type ResolvedSection,
} from "@/components/header/nav-model"
import { DRAWER_ID, type NavDrawerProps } from "@/components/header/types"
import { stripAudience, withAudience, type Audience } from "@/lib/audience"
import { sectionsFor, type HeaderData, type HeaderDevice, type NavSection } from "@/lib/header-data"
import { deviceFromPath, phoneOf, readDevice, rememberDevice } from "@/lib/remembered-device"
import { matchesModel } from "@/lib/search/normalize"

/**
 * The menu drawer on every screen size, CASETiFY style: one level at a time,
 * drilling from the sections (Phone Case, Earbuds, Styles…) to the brands,
 * then to the models, newest first, and from the Collections row to every
 * collection. It renders under the drawer's top bar (search and Close, in the
 * always-loaded shell) and is loaded on intent.
 *
 * Only the level on screen is mounted, plus the one leaving while it slides
 * away; each level keeps its scroll and filter for when the shopper comes back.
 * Focus moves to a new level's heading and back to the row that opened it.
 */

type Level =
  | { type: "menu" }
  | { type: "brands"; section: string }
  | { type: "models"; family: string; section: string; shopAll: boolean }
  | { type: "styles"; section: string }
  | { type: "links"; section: string }
  | { type: "collections"; section: string }
/** back: the parent's name for the Back button; opener: the data-nav-key of the row that opened it. */
type Entry = { key: string; level: Level; back: string; opener: string | null }
type Nav = { session: number; stack: Entry[]; leaving: { entry: Entry; dir: "push" | "back" } | null }

const MENU = "Menu"
const HEADING = "@heading"
/** The sub-levels' sticky Back bar (h-14): the filter sticks under it. */
const STICKY_TOP = 56
const ROW_FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple"
const DRILL_ROW = `flex min-h-[72px] w-full items-center gap-3.5 px-4 text-left hover:bg-field active:bg-field ${ROW_FOCUS}`
/** Only what next.config.ts lets the optimizer fetch; anything else loads as is. */
const OPTIMISED = /^https:\/\/(?:[^/]+\.r2\.dev|img\.florayn\.com)\//
const PRICE = new Intl.NumberFormat("en-US")

const fresh = (session: number): Nav => ({
  session,
  stack: [{ key: `${session}/menu`, level: { type: "menu" }, back: "", opener: null }],
  leaving: null,
})

/** A plain left click: the drawer closes and the link navigates. A new-tab click leaves the drawer open. */
const plainClick = (event: MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)

const cssEscape = (value: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&")

type Ctx = {
  data: HeaderData
  audience: Audience
  remembered: HeaderDevice | null
  currentSlug: string | null
  section: (id: string | null) => NavSection | null
  push: (level: Level, back: string, opener: string) => void
  pop: () => void
  query: (key: string) => string
  setQuery: (key: string, value: string) => void
  /** A link was chosen: close the drawer. */
  close: (event: MouseEvent) => void
  /** A model was chosen: remember it when it is a phone, then close. */
  chooseModel: (slug: string, event: MouseEvent) => void
  /** Enter in a filter with one match: remember a phone, close and go. */
  goToModel: (slug: string, href: string) => void
}

export default function NavDrawer({ data, audience, pathname, openCount, onNavigate }: NavDrawerProps) {
  const router = useRouter()
  const sections = useMemo(() => sectionsFor(data, audience, "drawer"), [data, audience])
  const currentSlug = useMemo(() => deviceFromPath(pathname, data.devices.map((d) => d[0])), [pathname, data.devices])

  const [nav, setNav] = useState<Nav>(() => fresh(0))
  const [queries, setQueries] = useState<Record<string, string>>({})
  const [rememberedSlug, setRememberedSlug] = useState<string | null>(null)
  const seq = useRef(0)
  const scrolls = useRef(new Map<string, number>())
  const frames = useRef(new Map<string, HTMLDivElement>())
  const focusNext = useRef<string | null>(null)

  /*
   * Every opening starts at the first level. A mode switch (WOMEN / MEN)
   * keeps the drawer open and also returns it there, with the new mode's
   * sections. Reset during render, so the old level never flashes.
   */
  const [seen, setSeen] = useState({ openCount, audience })
  if (seen.openCount !== openCount) {
    setSeen({ openCount, audience })
    setNav(fresh(nav.session + 1))
    setQueries({})
  } else if (seen.audience !== audience) {
    setSeen({ openCount, audience })
    if (nav.stack.length > 1 || nav.leaving) setNav({ ...nav, stack: [nav.stack[0]], leaving: null })
  }

  // Closing (X, backdrop, Esc, Back, a link) resets it too, out of sight.
  useEffect(() => {
    const dialog = document.getElementById(DRAWER_ID)
    if (!dialog) return
    const reset = () => {
      setNav((n) => fresh(n.session + 1))
      setQueries({})
      scrolls.current.clear()
    }
    dialog.addEventListener("close", reset)
    return () => dialog.removeEventListener("close", reset)
  }, [])

  // The shopper's phone, read after the drawer opens (never during render).
  // Only a phone counts: an AirPods or wallet slug stored by an older build is ignored.
  useEffect(() => {
    setRememberedSlug(data.rememberDevice ? phoneOf(readDevice(), data.devices)?.[0] ?? null : null)
  }, [openCount, data])
  const remembered = phoneOf(rememberedSlug, data.devices)
  /** A phone model chosen in the menu becomes "Your phone"; AirPods, watch and wallet models never do. */
  const rememberChoice = (slug: string) => {
    if (data.rememberDevice && phoneOf(slug, data.devices)) rememberDevice(slug)
  }

  const current = nav.stack[nav.stack.length - 1]
  const leaving = nav.leaving

  // Focus the new level's heading, or on the way back the row that opened the level.
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    const frame = frames.current.get(current.key)
    const element = target === HEADING
      ? frame?.querySelector<HTMLElement>("h2")
      : frame?.querySelector<HTMLElement>(`[data-nav-key="${cssEscape(target)}"]`)
    element?.focus({ preventScroll: true })
  }, [current.key])

  // The leaving level unmounts when its animation ends; this covers a missed animationend.
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setNav((n) => (n.leaving === leaving ? { ...n, leaving: null } : n)), 450)
    return () => clearTimeout(timer)
  }, [leaving])

  const ctx: Ctx = {
    data,
    audience,
    remembered,
    currentSlug,
    section: (id) => (id ? sections.find((s) => s.id === id) ?? null : null),
    push(level, back, opener) {
      focusNext.current = HEADING
      const key = `${nav.session}/${++seq.current}`
      setNav((n) => ({ ...n, stack: [...n.stack, { key, level, back, opener }], leaving: { entry: n.stack[n.stack.length - 1], dir: "push" } }))
    },
    pop() {
      if (nav.stack.length < 2) return
      focusNext.current = current.opener
      scrolls.current.delete(current.key)
      setNav((n) => (n.stack.length < 2 ? n : { ...n, stack: n.stack.slice(0, -1), leaving: { entry: n.stack[n.stack.length - 1], dir: "back" } }))
    },
    query: (key) => queries[key] ?? "",
    setQuery: (key, value) => setQueries((q) => ({ ...q, [key]: value })),
    close(event) {
      if (plainClick(event)) onNavigate()
    },
    chooseModel(slug, event) {
      rememberChoice(slug)
      if (plainClick(event)) onNavigate()
    },
    goToModel(slug, href) {
      rememberChoice(slug)
      onNavigate()
      router.push(href)
    },
  }

  // Parent first, child second: the child slides over, and nothing moves in the DOM.
  const shown: { entry: Entry; anim: string | null; out: boolean }[] = !leaving
    ? [{ entry: current, anim: null, out: false }]
    : leaving.dir === "push"
      ? [{ entry: leaving.entry, anim: "push-out", out: true }, { entry: current, anim: "push-in", out: false }]
      : [{ entry: current, anim: "back-in", out: false }, { entry: leaving.entry, anim: "back-out", out: true }]

  return (
    <div className="fl-levels">
      {shown.map(({ entry, anim, out }) => (
        <LevelFrame
          key={entry.key}
          entryKey={entry.key}
          anim={anim}
          out={out}
          scrolls={scrolls.current}
          register={(element) => (element ? frames.current.set(entry.key, element) : frames.current.delete(entry.key))}
          onLeft={() => setNav((n) => (n.leaving?.entry.key === entry.key ? { ...n, leaving: null } : n))}
        >
          <LevelBody entry={entry} ctx={ctx} sections={sections} />
        </LevelFrame>
      ))}
    </div>
  )
}

function LevelFrame({ entryKey, anim, out, scrolls, register, onLeft, children }: {
  entryKey: string
  anim: string | null
  out: boolean
  scrolls: Map<string, number>
  register: (element: HTMLDivElement | null) => void
  onLeft: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element) element.scrollTop = scrolls.get(entryKey) ?? 0
    register(element)
    return () => register(null)
  }, []) // Mount only: a level comes back where it was left.
  return (
    <div
      ref={ref}
      className="fl-level"
      data-anim={anim ?? undefined}
      inert={out || undefined}
      onScroll={(event) => scrolls.set(entryKey, event.currentTarget.scrollTop)}
      onAnimationEnd={(event) => {
        if (out && event.target === event.currentTarget) onLeft()
      }}
    >
      {children}
    </div>
  )
}

function LevelBody({ entry, ctx, sections }: { entry: Entry; ctx: Ctx; sections: NavSection[] }) {
  const { level } = entry
  if (level.type === "menu") return <MenuLevel ctx={ctx} sections={sections} />
  if (level.type === "models") return <ModelsLevel entry={entry} level={level} ctx={ctx} />
  const section = ctx.section(level.section)
  if (!section) return <SubHeader entry={entry} ctx={ctx} />
  if (level.type === "brands") return <BrandsLevel entry={entry} section={section} ctx={ctx} />
  if (level.type === "styles") return <StylesLevel entry={entry} section={section} ctx={ctx} />
  if (level.type === "collections") return <CollectionsLevel entry={entry} section={section} ctx={ctx} />
  return <LinksLevel entry={entry} section={section} ctx={ctx} />
}

/* ------------------------------------------------------------------ Menu */

function MenuLevel({ ctx, sections }: { ctx: Ctx; sections: NavSection[] }) {
  const { data, audience } = ctx
  const resolved = sections.map((section) => ({ section, to: resolveSection(section, data) }))

  function open(section: NavSection, to: ResolvedSection) {
    const opener = `section:${section.id}`
    if (to.type === "brands") ctx.push({ type: "brands", section: section.id }, MENU, opener)
    else if (to.type === "models") ctx.push({ type: "models", family: to.family, section: section.id, shopAll: true }, MENU, opener)
    else if (to.type === "styles") ctx.push({ type: "styles", section: section.id }, MENU, opener)
    else if (to.type === "links") ctx.push({ type: "links", section: section.id }, MENU, opener)
  }

  return (
    <>
      <h2 tabIndex={-1} className="sr-only">Menu</h2>
      <AudienceToggle variant="tabs" />

      <div className="pt-2">
        {resolved.map(({ section, to }) => {
          if (to.type === "none") return null
          if (to.type === "collections") return <CollectionsRow key={section.id} section={section} ctx={ctx} />
          if (to.type === "link") {
            return (
              <IntentLink key={section.id} href={withAudience(to.href, audience)} onClick={ctx.close} className={DRILL_ROW}>
                <RoundImage src={section.image} label={section.label} className="size-[52px]" sizes="52px" />
                <span className="text-[15px] font-medium">{section.label}</span>
                {section.badge ? <Badge>{section.badge}</Badge> : null}
              </IntentLink>
            )
          }
          return (
            <button key={section.id} type="button" data-nav-key={`section:${section.id}`} onClick={() => open(section, to)} className={DRILL_ROW}>
              <RoundImage src={section.image} label={section.label} className="size-[52px]" sizes="52px" />
              <span className="text-[15px] font-medium">{section.label}</span>
              {section.badge ? <Badge>{section.badge}</Badge> : null}
              <ChevronRight size={18} className="ml-auto shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      {data.drawerLinks.length ? (
        <div className="mt-2 border-t border-line py-2">
          {data.drawerLinks.map((link) => {
            const Icon = linkIcon(link.href)
            return (
              <IntentLink
                key={`${link.label}|${link.href}`}
                href={withAudience(link.href, audience)}
                onClick={ctx.close}
                className={`flex h-12 items-center gap-3 px-4 text-[15px] hover:bg-field active:bg-field ${ROW_FOCUS}`}
              >
                <Icon size={18} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />
                {link.label}
              </IntentLink>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

function linkIcon(href: string) {
  const path = stripAudience(href).replace(/[?#].*$/, "").replace(/\/?$/, "/")
  return path === "/account/" ? UserRound : path === "/contact/" ? MessageCircle : ArrowUpRight
}

/** A card's picture: campaign art cropped to fill, a product render on white contained. */
function CollectionImage({ image, contain, sizes }: { image: string | null; contain: 0 | 1; sizes: string }) {
  if (!image) return null
  return <Image src={image} alt="" fill sizes={sizes} loading="lazy" unoptimized={!OPTIMISED.test(image)} className={contain ? "object-contain p-2" : "object-cover"} />
}

/** "8 collections", "1 collection". */
const collectionCount = (count: number) => `${count} collection${count === 1 ? "" : "s"}`

/** The first level's row of collection cards; View all opens every one of them inside the menu. */
function CollectionsRow({ section, ctx }: { section: NavSection; ctx: Ctx }) {
  const config = collectionsConfig(section)
  const cards = collectionsFor(ctx.data, ctx.audience, config.limit)
  if (!cards.length) return null
  const opener = `collections:${section.id}`
  return (
    <section className="border-b border-line pb-4 pt-5">
      <div className="flex items-center justify-between gap-3 px-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-[.06em]">{config.title}</h3>
        <button
          type="button"
          data-nav-key={opener}
          onClick={() => ctx.push({ type: "collections", section: section.id }, MENU, opener)}
          className={`-mr-2 flex h-9 items-center gap-1 rounded-full px-2 text-[13px] font-medium text-ink-muted hover:text-ink ${ROW_FOCUS}`}
        >
          View all
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <ul data-hscroll className="mt-3 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 pointer-coarse:[scrollbar-width:none] pointer-fine:pb-2 pointer-fine:[scrollbar-width:thin]">
        {cards.map(([slug, title, image, contain]) => (
          <li key={slug} className="w-[104px] shrink-0 snap-start">
            <IntentLink href={withAudience(`/collection/${slug}/`, ctx.audience)} onClick={ctx.close} className={`block rounded-[12px] ${ROW_FOCUS}`}>
              <span className="relative block size-[104px] overflow-hidden rounded-[12px] bg-field">
                <CollectionImage image={image} contain={contain} sizes="104px" />
              </span>
              <span className="mt-2 line-clamp-2 block text-center text-[13px] leading-[1.25]">{title}</span>
            </IntentLink>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------ Sub-levels */

function SubHeader({ entry, ctx }: { entry: Entry; ctx: Ctx }) {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-paper px-2">
      <button type="button" onClick={ctx.pop} className={`flex h-11 items-center gap-2 rounded-full pl-2 pr-3 ${ROW_FOCUS}`}>
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[13px] font-semibold uppercase tracking-[.06em]">
          <span className="sr-only">Back to </span>
          {entry.back}
        </span>
      </button>
    </div>
  )
}

function LevelHeading({ children, count }: { children: ReactNode; count?: string }) {
  return (
    <h2 tabIndex={-1} className="px-4 pb-1 pt-4 text-[20px] font-semibold focus:outline-none">
      {children}
      {count ? <span className="ml-2 text-[13px] font-normal text-ink-muted">{count}</span> : null}
    </h2>
  )
}

function Filter({ value, placeholder, onChange, onEnter }: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** Enter: go when there is one match; otherwise just put the keyboard away. */
  onEnter: () => boolean
}) {
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!onEnter()) event.currentTarget.blur()
  }
  // Typing while the filter is stuck far down the list: the results start right under it.
  function change(input: HTMLInputElement) {
    onChange(input.value)
    const frame = input.closest<HTMLElement>(".fl-level")
    const heading = frame?.querySelector("h2")
    if (!frame || !heading) return
    const stuck = heading.offsetTop + heading.offsetHeight - STICKY_TOP
    if (frame.scrollTop > stuck) frame.scrollTop = stuck
  }
  return (
    <div className="sticky top-14 z-10 bg-paper px-4 py-2">
      <input
        type="search"
        value={value}
        onChange={(event) => change(event.currentTarget)}
        onKeyDown={keyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="go"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        className="h-11 w-full rounded-full bg-field px-4 text-[16px] text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-purple"
      />
    </div>
  )
}

function ShopAll({ section, ctx }: { section: NavSection; ctx: Ctx }) {
  if (!section.href) return null
  return (
    <IntentLink
      href={withAudience(section.href, ctx.audience)}
      onClick={ctx.close}
      className={`flex h-[52px] items-center justify-between gap-2 px-4 text-[15px] font-medium hover:bg-field active:bg-field ${ROW_FOCUS}`}
    >
      Shop all {section.label}
      <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
    </IntentLink>
  )
}

function NoMatch({ query, devices, ctx }: { query: string; devices: HeaderDevice[]; ctx: Ctx }) {
  const examples = exampleQueries(devices)
  const help = ctx.data.search.help
  return (
    <div className="px-4 py-6 text-[14px] leading-relaxed text-ink-muted">
      <p>
        No model matches &ldquo;{query.trim()}&rdquo;.
        {examples.length ? <> Try {examples.map((e, i) => <span key={e}>{i ? " or " : ""}&ldquo;{e}&rdquo;</span>)}.</> : null}
      </p>
      {help.href && help.label ? (
        <IntentLink
          href={withAudience(help.href, ctx.audience)}
          onClick={ctx.close}
          className={`mt-3 inline-flex min-h-11 items-center gap-1.5 font-medium text-purple-deep ${ROW_FOCUS}`}
        >
          {help.label}
          <ArrowRight size={14} aria-hidden="true" />
        </IntentLink>
      ) : null}
    </div>
  )
}

/** Announces how many models the filter left, for screen readers. */
function MatchStatus({ query, count }: { query: string; count: number }) {
  return <p className="sr-only" aria-live="polite">{query.trim() ? modelCount(count) : ""}</p>
}

function ModelRow({ device, href, ctx }: { device: HeaderDevice; href: string; ctx: Ctx }) {
  const [slug, name, , badge] = device
  const current = slug === ctx.currentSlug
  return (
    <li>
      <IntentLink
        href={href}
        aria-current={current ? "page" : undefined}
        onClick={(event: MouseEvent) => ctx.chooseModel(slug, event)}
        className={`flex min-h-12 items-center gap-2 px-4 text-[15px] hover:bg-field active:bg-field ${current ? "font-semibold" : ""} ${ROW_FOCUS}`}
      >
        <span>{name}</span>
        {badge ? <Badge>{badge}</Badge> : null}
      </IntentLink>
    </li>
  )
}

function Subhead({ children }: { children: ReactNode }) {
  return <h3 className="flex h-8 items-center px-4 pt-3 text-[12px] font-semibold uppercase tracking-[.06em] text-ink-muted">{children}</h3>
}

function BrandsLevel({ entry, section, ctx }: { entry: Entry; section: NavSection; ctx: Ctx }) {
  const { data, audience } = ctx
  const families = familiesOf(section, data)
  const query = ctx.query(entry.key)
  const searching = !!query.trim()
  const all = families.flatMap((f) => modelsOf(data, f.family))
  const found = searching
    ? families.map((f) => ({ ...f, devices: modelsOf(data, f.family).filter((d) => matchesModel(d[1], query)) })).filter((f) => f.devices.length)
    : []
  const matches = found.flatMap((f) => f.devices)

  function enter() {
    if (matches.length !== 1) return false
    ctx.goToModel(matches[0][0], shopHref(matches[0], section, data, audience))
    return true
  }

  return (
    <>
      <SubHeader entry={entry} ctx={ctx} />
      <LevelHeading>{section.label}</LevelHeading>
      <Filter value={query} placeholder="Find your model" onChange={(v) => ctx.setQuery(entry.key, v)} onEnter={enter} />
      <MatchStatus query={query} count={matches.length} />
      {searching ? (
        matches.length ? (
          found.map((f) => (
            <div key={f.family}>
              <Subhead>{f.label}</Subhead>
              <ul>
                {f.devices.map((device) => <ModelRow key={device[0]} device={device} href={shopHref(device, section, data, audience)} ctx={ctx} />)}
              </ul>
            </div>
          ))
        ) : (
          <NoMatch query={query} devices={all} ctx={ctx} />
        )
      ) : (
        <>
          <ShopAll section={section} ctx={ctx} />
          {families.map((f) => (
            <button
              key={f.family}
              type="button"
              data-nav-key={`family:${f.family}`}
              onClick={() => ctx.push({ type: "models", family: f.family, section: section.id, shopAll: false }, section.label, `family:${f.family}`)}
              className={`flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-field active:bg-field ${ROW_FOCUS}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[16px] font-medium">{f.label}</span>
                  {f.badge ? <Badge>{f.badge}</Badge> : null}
                </span>
                <span className="block text-[13px] text-ink-muted">{modelCount(f.count)}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          ))}
        </>
      )}
    </>
  )
}

function ModelsLevel({ entry, level, ctx }: { entry: Entry; level: Extract<Level, { type: "models" }>; ctx: Ctx }) {
  const { data, audience } = ctx
  const section = ctx.section(level.section)
  const label = (data.families as Record<string, string>)[level.family] || level.family
  const all = modelsOf(data, level.family)
  const query = ctx.query(entry.key)
  const fits = (device: HeaderDevice) => matchesModel(device[1], query)

  // Newest first under their series, the shopper's own phone included (never pulled to the top).
  const groups = seriesGroups(all)
    .map((group) => ({ ...group, devices: group.devices.filter(fits) }))
    .filter((group) => group.devices.length)
  const matches = groups.flatMap((group) => group.devices)
  const href = (device: HeaderDevice) => shopHref(device, section, data, audience)

  function enter() {
    if (matches.length !== 1) return false
    ctx.goToModel(matches[0][0], href(matches[0]))
    return true
  }

  return (
    <>
      <SubHeader entry={entry} ctx={ctx} />
      <LevelHeading count={modelCount(all.length)}>{label}</LevelHeading>
      <Filter value={query} placeholder={`Search ${label} models`} onChange={(v) => ctx.setQuery(entry.key, v)} onEnter={enter} />
      <MatchStatus query={query} count={matches.length} />
      {level.shopAll && section && !query.trim() ? <ShopAll section={section} ctx={ctx} /> : null}
      {!matches.length ? (
        <NoMatch query={query} devices={all} ctx={ctx} />
      ) : (
        <>
          {groups.map((group, i) => (
            <div key={group.heading ?? i}>
              {group.heading ? <Subhead>{group.heading}</Subhead> : null}
              <ul>
                {group.devices.map((device) => <ModelRow key={device[0]} device={device} href={href(device)} ctx={ctx} />)}
              </ul>
            </div>
          ))}
        </>
      )}
      <div className="h-4" aria-hidden="true" />
    </>
  )
}

function StylesLevel({ entry, section, ctx }: { entry: Entry; section: NavSection; ctx: Ctx }) {
  const rows = stylesOf(section, ctx.data)
  const form = sectionForm(section)
  return (
    <>
      <SubHeader entry={entry} ctx={ctx} />
      <LevelHeading>{section.label}</LevelHeading>
      <div className="pt-2">
        <ShopAll section={section} ctx={ctx} />
        <ul>
          {rows.map((caseType) => {
            const [slug, name, , image] = caseType
            const fromPrice = styleFromPrice(caseType, form)
            return (
              <li key={slug}>
                <IntentLink
                  href={caseStyleHref(caseType, section, ctx.data, ctx.audience, ctx.remembered?.[0] ?? null)}
                  onClick={ctx.close}
                  className={`flex min-h-16 items-center gap-3 px-4 hover:bg-field active:bg-field ${ROW_FOCUS}`}
                >
                  <RoundImage src={image} label={name} className="size-[44px]" sizes="44px" cover />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{name}</span>
                    {fromPrice != null ? <span className="block text-[13px] text-ink-muted">from ৳{PRICE.format(fromPrice)}</span> : null}
                  </span>
                </IntentLink>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

/** Every collection of the shopper's mode, as a grid inside the menu; the collections page is one tap further. */
function CollectionsLevel({ entry, section, ctx }: { entry: Entry; section: NavSection; ctx: Ctx }) {
  const config = collectionsConfig(section)
  const cards = collectionsFor(ctx.data, ctx.audience, ctx.data.collections.length)
  return (
    <>
      <SubHeader entry={entry} ctx={ctx} />
      <LevelHeading count={collectionCount(cards.length)}>{config.title}</LevelHeading>
      <div className="pt-2">
        <IntentLink
          href={withAudience(config.view_all_href, ctx.audience)}
          onClick={ctx.close}
          className={`flex h-[52px] items-center justify-between gap-2 px-4 text-[15px] font-medium hover:bg-field active:bg-field ${ROW_FOCUS}`}
        >
          Shop all {config.title.toLowerCase()}
          <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
        </IntentLink>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 pb-6 pt-2">
          {cards.map(([slug, title, image, contain]) => (
            <li key={slug}>
              <IntentLink href={withAudience(`/collection/${slug}/`, ctx.audience)} onClick={ctx.close} className={`block rounded-[12px] ${ROW_FOCUS}`}>
                <span className="relative block aspect-square overflow-hidden rounded-[12px] bg-field">
                  <CollectionImage image={image} contain={contain} sizes="(max-width:454px) 128px, 178px" />
                </span>
                <span className="mt-2 line-clamp-2 block text-center text-[14px] leading-[1.25]">{title}</span>
              </IntentLink>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function LinksLevel({ entry, section, ctx }: { entry: Entry; section: NavSection; ctx: Ctx }) {
  return (
    <>
      <SubHeader entry={entry} ctx={ctx} />
      <LevelHeading>{section.label}</LevelHeading>
      <div className="pb-4 pt-2">
        <ShopAll section={section} ctx={ctx} />
        {section.groups.filter((group) => group.links.length).map((group, i) => (
          <div key={`${group.heading ?? ""}|${i}`}>
            {group.heading ? <h3 className="px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-[.06em] text-ink-muted">{group.heading}</h3> : null}
            <ul>
              {group.links.map((link) => (
                <li key={`${link.label}|${link.href}`}>
                  <IntentLink
                    href={withAudience(link.href, ctx.audience)}
                    onClick={ctx.close}
                    className={`flex min-h-12 items-center gap-2 px-4 text-[15px] hover:bg-field active:bg-field ${ROW_FOCUS}`}
                  >
                    {link.label}
                    {link.badge ? <Badge>{link.badge}</Badge> : null}
                  </IntentLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- Pieces */

function Badge({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-full bg-purple px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[.04em] text-white">{children}</span>
}

/** A round picture that falls back to the label's first letter (no picture, or one that fails). */
function RoundImage({ src, label, className, sizes, cover = false }: { src: string | null; label: string; className: string; sizes: string; cover?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-field text-[16px] font-semibold text-ink-muted ${className}`}>
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          loading="lazy"
          unoptimized={!OPTIMISED.test(src)}
          onError={() => setFailed(true)}
          className={cover ? "object-cover" : "object-contain p-1"}
        />
      ) : (
        <span aria-hidden="true">{label.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}
