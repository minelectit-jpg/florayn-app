"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { useCart } from "@/components/cart-provider"
import MegaPanel from "@/components/mega-menu"
import ShoppingBagIcon from "@/components/shopping-bag-icon"
import type { CaseTypeInfo, MenuSection } from "@/lib/content"

/**
 * The header, matching the live site's arrangement: the WOMEN/MEN pill on the
 * left, the wordmark centred, actions on the right, and the navigation on its
 * own row underneath. Below lg the nav row becomes a drawer.
 */
export default function SiteHeader({
  menu,
  caseTypes = [],
}: {
  menu: MenuSection[]
  caseTypes?: CaseTypeInfo[]
}) {
  const pathname = usePathname()
  const { summary, openDrawer } = useCart()
  const itemCount = summary?.itemCount ?? 0

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Any navigation closes whatever is open.
  useEffect(() => {
    setOpenMenu(null)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenMenu(null)
        setMobileOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      {/*
       * The drawer below is a sibling of the header on purpose. The header
       * sets backdrop-blur, which makes it a containing block, and a
       * position:fixed child would then size itself against the header rather
       * than the viewport.
       */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1470px] items-center gap-4 px-[15px] py-4 md:px-[30px]">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          className="grid size-9 place-items-center rounded-full border border-line lg:hidden"
        >
          <span aria-hidden="true">&#9776;</span>
        </button>

        {/* The live site's audience pill. Presentational until sections exist. */}
        <div className="hidden shrink-0 items-center rounded-full bg-ink p-1 text-[11px] font-semibold lg:flex">
          <span className="rounded-full bg-ink px-3 py-1.5 text-white">
            WOMEN
          </span>
          <span className="px-3 py-1.5 text-white/55">MEN</span>
        </div>

        <Link
          href="/"
          className="display mx-auto text-[1.6rem] leading-none tracking-[0.12em]"
        >
          FLORAYN
        </Link>

        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={openDrawer}
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="relative grid size-9 place-items-center rounded-full text-ink transition-colors hover:text-purple"
          >
            <ShoppingBagIcon width={16} />
            {itemCount > 0 ? (
              <span
                aria-live="polite"
                className="absolute right-0.5 top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-purple px-1 text-[10px] font-semibold tabular-nums text-white"
              >
                {itemCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Desktop nav row */}
      <nav
        className="relative hidden border-t border-line lg:block"
        onMouseLeave={() => setOpenMenu(null)}
      >
        <ul className="mx-auto flex w-full max-w-[1470px] items-center justify-center gap-8 px-[30px]">
          {menu.map((section) => {
            const hasPanel = section.groups.some((g) => g.links.length)
            const isOpen = openMenu === section.id
            const content = (
              <>
                {section.label}
                {hasPanel ? (
                  <span aria-hidden="true" className="ml-1 text-[9px]">
                    &#9662;
                  </span>
                ) : null}
              </>
            )
            return (
              <li
                key={section.id}
                onMouseEnter={() => setOpenMenu(hasPanel ? section.id : null)}
              >
                {section.href ? (
                  <Link
                    href={section.href}
                    aria-expanded={hasPanel ? isOpen : undefined}
                    className="flex items-center py-4 text-[15px] transition-colors hover:text-purple"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenMenu(isOpen ? null : section.id)}
                    className="flex items-center py-4 text-[15px] transition-colors hover:text-purple"
                  >
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {menu.map((section) => {
          if (openMenu !== section.id) return null
          return (
            <div
              key={section.id}
              className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2"
            >
              <div className="w-max max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_20px_48px_-16px_rgba(26,22,37,0.32)]">
                <MegaPanel section={section} caseTypes={caseTypes} />
              </div>
            </div>
          )
        })}
      </nav>

    </header>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col bg-paper">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <span className="display text-lg tracking-[0.12em]">FLORAYN</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="grid size-9 place-items-center rounded-full border border-line"
              >
                &times;
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-2">
              <ul>
                {menu.map((section) => {
                  const hasPanel = section.groups.some((g) => g.links.length)
                  const isOpen = expanded === section.id
                  return (
                    <li key={section.id} className="border-b border-line/70">
                      <div className="flex items-center">
                        {section.href ? (
                          <Link
                            href={section.href}
                            className="flex-1 px-3 py-3.5 text-base"
                          >
                            {section.label}
                          </Link>
                        ) : (
                          <span className="flex-1 px-3 py-3.5 text-base">
                            {section.label}
                          </span>
                        )}
                        {hasPanel ? (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.label}`}
                            onClick={() => setExpanded(isOpen ? null : section.id)}
                            className="grid size-11 place-items-center text-ink-muted"
                          >
                            {isOpen ? "−" : "+"}
                          </button>
                        ) : null}
                      </div>

                      {isOpen ? (
                        <div className="space-y-4 px-3 pb-4">
                          {section.groups.map((group, i) => (
                            <div key={group.heading ?? i}>
                              {group.heading ? (
                                <p className="mb-1.5 text-sm font-semibold">
                                  {group.heading}
                                </p>
                              ) : null}
                              <ul className="space-y-1">
                                {group.links.map((link) => (
                                  <li key={link.id}>
                                    <Link
                                      href={link.href}
                                      className="inline-flex items-center gap-1.5 py-1 text-sm text-ink-muted"
                                    >
                                      {link.label}
                                      {link.badge ? (
                                        <span className="rounded-full bg-purple px-1.5 py-[1px] text-[9px] font-semibold uppercase text-white">
                                          {link.badge}
                                        </span>
                                      ) : null}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  )
}
