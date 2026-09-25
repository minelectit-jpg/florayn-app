"use client"

import { ArrowLeft, LockKeyhole, Menu, Search, UserRound } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import Link from "@/components/audience-link"
import AudienceToggle from "@/components/audience-toggle"
import { useCart } from "@/components/cart-provider"
import FloraynLogo from "@/components/florayn-logo"
import ShoppingBagIcon from "@/components/shopping-bag-icon"
import { useAudience } from "@/components/use-audience"
import { stripAudience, withAudience } from "@/lib/audience"
import { unpackHeaderData, type HeaderWire } from "@/lib/header-data"
import { deviceFromPath, phoneSlugs, rememberDevice } from "@/lib/remembered-device"

import DesktopNav from "./desktop-nav"
import { MenuDrawer, SearchDialog, onSearchLinkClick, openSheet, preloadNavDrawer, searchIntent } from "./header-dialogs"
import { DRAWER_ID } from "./types"

/** Home, shop and collection pages put the WOMEN/MEN switch beside the phone header's search field. */
const MODE_SWITCH = /^\/(?:$|shop(?:\/|$)|collections?(?:\/|$))/
/** The search pages have their own field at the top: no second one in the header there. */
const SEARCH_PAGE = /^\/search(?:\/|$)/
/** Scrolled this far (px) in one direction before the logo row tucks away or comes back. */
const TUCK_STEP = 8

/** Every row-1 icon: a 44px target, purple on a fine pointer's hover, a round focus ring. */
const ICON = "grid size-11 place-items-center rounded-full text-ink transition-colors pointer-fine:hover:text-purple focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"

const bagLabel = (count: number) => `Bag, ${count} item${count === 1 ? "" : "s"}`

/**
 * The site header. Phones and tablets: a solid 56px (64px) logo row with Menu
 * on the left, the wordmark centred and Account and Bag on the right, and
 * under it, in the same sticky header, the search field (with a compact
 * WOMEN/MEN switch on home, shop and collection pages). Scrolling down tucks
 * the logo row away and keeps the search field pinned; scrolling up brings
 * it back. Desktop: Menu and the WOMEN/MEN pill, the wordmark, a search
 * field, Account and Bag, and the nav row with its panels.
 *
 * Everything comes from one compact prop built by the layout (lib/header-data.ts,
 * packed for the wire and unpacked once here) and nothing depends on cookies,
 * so the markup is the same for everyone and every page stays static. The menu
 * drawer and search are native dialogs (header-dialogs.tsx); their heavier
 * parts load on intent.
 */
export default function SiteHeader({ wire }: { wire: HeaderWire }) {
  const data = useMemo(() => unpackHeaderData(wire), [wire])
  const pathname = usePathname() || "/"
  const audience = useAudience()
  const { summary, openDrawer: openBag } = useCart()
  const itemCount = summary?.itemCount ?? 0
  const plainPath = stripAudience(pathname)
  const orderConfirmation = /^\/order\/[^/]+\/?$/.test(pathname)
  /** Checkout and the order page get a minimal header of their own (no menu, search or tuck). */
  const minimal = pathname === "/checkout" || pathname === "/checkout/" || orderConfirmation
  const searchRow = !minimal && !SEARCH_PAGE.test(plainPath)
  const modeSwitch = MODE_SWITCH.test(plainPath)
  const searchHref = withAudience("/search/", audience)

  const headerRef = useRef<HTMLElement>(null)
  const drawerRef = useRef<HTMLDialogElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openCount, setOpenCount] = useState(0)

  // The bag count is read out when it changes, never on the first load.
  const [announcement, setAnnouncement] = useState("")
  const lastCount = useRef<number | null>(null)
  useEffect(() => {
    if (!summary) return
    if (lastCount.current !== null && lastCount.current !== itemCount) setAnnouncement(bagLabel(itemCount))
    lastCount.current = itemCount
  }, [summary, itemCount])

  // The shopper's phone, from the shop and product pages they open (Admin > Navigation can turn this off).
  // Phones only: an AirPods, watch band or wallet page never replaces it.
  const slugs = useMemo(() => phoneSlugs(data.devices), [data.devices])
  useEffect(() => {
    if (!data.rememberDevice) return
    const slug = deviceFromPath(pathname, slugs)
    if (slug) rememberDevice(slug)
  }, [pathname, slugs, data.rememberDevice])

  // Phones and tablets: scrolling down tucks the logo row away (header.css
  // slides the header up by its height) and leaves the search field pinned;
  // scrolling up, or back to the top, brings it back. A DOM attribute, not
  // state, so scrolling never re-renders the header. The minimal checkout
  // header replaces this <header> element, so searchRow (false there) makes
  // the listener re-attach to the new one on the way back.
  useEffect(() => {
    const header = headerRef.current
    if (!header || !searchRow) return
    const small = window.matchMedia("(max-width:1023px)")
    let last = window.scrollY
    let frame = 0
    const update = () => {
      frame = 0
      // iOS reports positions past either end while it bounces: clamp, so the bounce never reads as scrolling up.
      const y = Math.min(Math.max(window.scrollY, 0), document.documentElement.scrollHeight - window.innerHeight)
      const logoRow = (header.firstElementChild as HTMLElement | null)?.offsetHeight ?? 56
      if (!small.matches || y <= logoRow) {
        delete header.dataset.tuck
        last = y
        return
      }
      if (Math.abs(y - last) < TUCK_STEP) return
      if (y > last) header.dataset.tuck = ""
      else delete header.dataset.tuck
      last = y
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    small.addEventListener("change", update)
    return () => {
      window.removeEventListener("scroll", onScroll)
      small.removeEventListener("change", update)
      window.cancelAnimationFrame(frame)
      delete header.dataset.tuck
    }
  }, [searchRow])

  function openMenu(trigger: HTMLElement) {
    preloadNavDrawer().catch(() => {})
    if (!openSheet(drawerRef.current, trigger)) return
    setDrawerOpen(true)
    setOpenCount((count) => count + 1)
  }

  if (minimal) {
    return (
      <header className="border-b border-line bg-paper">
        <div className="mx-auto grid max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-[15px] py-5 md:px-[30px] md:py-6">
          <Link href={orderConfirmation ? "https://florayn.com/" : "/cart/"} className="flex items-center gap-2 text-xs text-ink-muted"><ArrowLeft size={16} aria-hidden="true" /><span className="hidden sm:inline">{orderConfirmation ? "Back to shop" : "Back to bag"}</span><span className="sm:hidden">{orderConfirmation ? "Shop" : "Bag"}</span></Link>
          <Link href="/" aria-label="Florayn home" className="block text-ink">
            <FloraynLogo title={null} width={124} height={20} className="h-5 w-[124px] md:h-[22px] md:w-[136px]" />
          </Link>
          <span className="flex items-center justify-end gap-1.5 text-[11px] text-ink-muted"><LockKeyhole size={14} aria-hidden="true" /><span className="hidden sm:inline">{orderConfirmation ? "Your order" : "Checkout"}</span></span>
        </div>
      </header>
    )
  }

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>

      {/*
       * A solid bar with no backdrop-filter: a filter (or the tuck's transform)
       * makes the header the containing block of anything position:fixed
       * inside it, so nothing inside is fixed. The sheets are its siblings.
       */}
      <header ref={headerRef} data-store-header data-row2={searchRow ? "" : undefined} className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="mx-auto grid h-14 max-w-[1470px] grid-cols-[1fr_auto_1fr] items-center px-1 md:h-16 md:px-[18px] lg:h-[72px] lg:px-[30px]">
          <div className="flex items-center justify-self-start lg:gap-2">
            <button
              type="button"
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls={DRAWER_ID}
              onClick={(event) => openMenu(event.currentTarget)}
              onPointerEnter={() => preloadNavDrawer().catch(() => {})}
              onTouchStart={() => preloadNavDrawer().catch(() => {})}
              onFocus={() => preloadNavDrawer().catch(() => {})}
              className={ICON}
            >
              <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <AudienceToggle variant="pill" className="hidden lg:grid" />
          </div>

          <Link href="/" aria-label="Florayn home" className="block rounded-sm text-ink">
            <FloraynLogo title={null} width={111} height={18} className="h-[18px] w-[111px] md:h-5 md:w-[124px] lg:h-6 lg:w-[148px]" />
          </Link>

          <div className="flex items-center justify-self-end lg:gap-2">
            <a
              href={searchHref}
              onClick={onSearchLinkClick}
              {...searchIntent}
              className="hidden h-11 w-[280px] items-center gap-2.5 rounded-full bg-field pl-4 pr-2 text-[14px] text-ink-muted lg:flex xl:w-[340px]"
            >
              <Search size={18} className="shrink-0 text-ink" aria-hidden="true" />
              <span className="truncate">{data.search.placeholder}</span>
              <kbd aria-hidden="true" className="ml-auto hidden size-6 shrink-0 place-items-center rounded-md border border-line bg-paper font-sans text-[12px] [@media(hover:hover)]:grid">/</kbd>
            </a>
            <Link href="/account/" aria-label="My account" className={ICON}>
              <UserRound size={20} strokeWidth={1.6} aria-hidden="true" />
            </Link>
            <button type="button" onClick={openBag} aria-label={bagLabel(itemCount)} className={`relative ${ICON}`}>
              <ShoppingBagIcon width={18} />
              {itemCount > 0 ? (
                <span aria-hidden="true" className="absolute right-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-purple px-1 text-[10px] font-semibold leading-none tabular-nums text-white">
                  {itemCount}
                </span>
              ) : null}
            </button>
            <span className="sr-only" aria-live="polite">{announcement}</span>
          </div>
        </div>

        {searchRow ? (
          <div data-header-row2 className="lg:hidden">
            <div className="mx-auto flex max-w-[1470px] items-center gap-2 px-[15px] pb-2 md:px-[30px]">
              <a
                href={searchHref}
                onClick={onSearchLinkClick}
                {...searchIntent}
                className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-field px-4 text-[14px] text-ink-muted md:max-w-[560px]"
              >
                <Search size={18} className="shrink-0 text-ink" aria-hidden="true" />
                <span className="truncate">{data.search.placeholder}</span>
              </a>
              {modeSwitch ? <AudienceToggle variant="compact" className="shrink-0 md:ml-auto" /> : null}
            </div>
          </div>
        ) : null}

        <DesktopNav data={data} audience={audience} pathname={pathname} />
      </header>

      <MenuDrawer dialogRef={drawerRef} data={data} audience={audience} pathname={pathname} openCount={openCount} onClosed={() => setDrawerOpen(false)} />
      <SearchDialog data={data} audience={audience} pathname={pathname} />
    </>
  )
}
