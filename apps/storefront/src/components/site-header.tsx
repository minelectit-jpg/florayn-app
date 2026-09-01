"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useCart } from "@/components/cart-provider"

const NAV = [
  { href: "/collection/essentials/", label: "Essentials" },
  { href: "/collection/signature/", label: "Signature" },
  { href: "/collection/elite-clear/", label: "Elite Clear" },
  { href: "/collection/armor-black/", label: "Armor Black" },
  { href: "/collection/armor-clear/", label: "Armor Clear" },
  { href: "/collection/alcantara/", label: "Alcantara" },
]

export default function SiteHeader() {
  const pathname = usePathname()
  const { summary, openDrawer } = useCart()
  const itemCount = summary?.itemCount ?? 0

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1470px] items-center gap-6 px-[15px] py-4 md:px-[30px]">
        <Link
          href="/"
          className="display shrink-0 text-[1.6rem] leading-none tracking-[0.02em]"
        >
          Florayn
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-7 lg:flex">
          {NAV.map((item) => {
            const isActive =
              pathname === item.href || `${pathname}/` === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "eyebrow transition-colors",
                  isActive
                    ? "text-purple"
                    : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 lg:ml-0">
          {itemCount > 0 ? (
            <button
              type="button"
              onClick={openDrawer}
              className="eyebrow hidden text-ink-muted transition-colors hover:text-ink sm:block"
            >
              Recent
            </button>
          ) : null}

          <Link
            href="/cart/"
            className="group flex items-center gap-2 text-ink transition-colors hover:text-purple"
          >
            <span className="eyebrow text-inherit">Cart</span>
            {/* Hidden until hydrated so it never flashes in as a zero. */}
            {summary ? (
              <span
                aria-label={`${itemCount} ${itemCount === 1 ? "item" : "items"} in cart`}
                className={[
                  "inline-flex h-[1.35rem] min-w-[1.35rem] items-center justify-center",
                  "rounded-full px-1.5 text-[0.6875rem] font-medium tabular-nums transition-colors",
                  itemCount > 0
                    ? "bg-purple text-white"
                    : "bg-line text-ink-faint",
                ].join(" ")}
              >
                {itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      {/* The case-type rail collapses to a scroller rather than a burger, so
          the constructions stay one tap away on a phone. */}
      <nav className="flex gap-6 overflow-x-auto border-t border-line px-[15px] py-2.5 lg:hidden">
        {NAV.map((item) => {
          const isActive = pathname === item.href || `${pathname}/` === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={[
                "eyebrow whitespace-nowrap transition-colors",
                isActive ? "text-purple" : "text-ink-muted",
              ].join(" ")}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
