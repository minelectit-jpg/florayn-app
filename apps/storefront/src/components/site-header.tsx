"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useCart } from "@/components/cart-provider"

const NAV = [
  { href: "/collection/essentials/", label: "Essentials" },
  { href: "/collection/armor-black/", label: "Armor Black" },
  { href: "/collection/armor-clear/", label: "Armor Clear" },
  { href: "/collection/elite-clear/", label: "Elite Clear" },
  { href: "/collection/signature/", label: "Signature" },
  { href: "/collection/alcantara/", label: "Alcantara" },
]

export default function SiteHeader() {
  const pathname = usePathname()
  const { summary, openDrawer } = useCart()
  const itemCount = summary?.itemCount ?? 0

  return (
    <header className="border-b border-[var(--color-line)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <Link href="/" className="display text-2xl font-semibold">
          Florayn
        </Link>

        <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {NAV.map((item) => {
            // Trailing slashes are canonical, so compare with one either way.
            const isActive =
              pathname === item.href || `${pathname}/` === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "text-[var(--color-ink)] underline underline-offset-4"
                    : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                }
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Reopening the drawer is useful right after adding something. */}
          {itemCount > 0 ? (
            <button
              type="button"
              onClick={openDrawer}
              className="text-sm text-[var(--color-ink-soft)] underline underline-offset-4 hover:text-[var(--color-ink)]"
            >
              Recent
            </button>
          ) : null}

          <Link
            href="/cart/"
            className="flex items-center gap-2 text-sm underline underline-offset-4"
          >
            Cart
            {/* summary is null until hydrated, so nothing flashes in as 0. */}
            {summary ? (
              <span
                aria-label={`${itemCount} ${itemCount === 1 ? "item" : "items"} in cart`}
                className={[
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
                  "text-xs no-underline transition-colors",
                  itemCount > 0
                    ? "bg-[var(--color-ink)] text-white"
                    : "bg-[var(--color-line)] text-[var(--color-ink-soft)]",
                ].join(" ")}
              >
                {itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  )
}
