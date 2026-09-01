import type { Metadata } from "next"
import Link from "next/link"

import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Florayn",
    template: "%s | Florayn",
  },
  description:
    "Printed cases for iPhone, Samsung, AirPods, Apple Watch and cards.",
}

const NAV = [
  { href: "/collection/essentials/", label: "Essentials" },
  { href: "/collection/armor-black/", label: "Armor Black" },
  { href: "/collection/armor-clear/", label: "Armor Clear" },
  { href: "/collection/elite-clear/", label: "Elite Clear" },
  { href: "/collection/signature/", label: "Signature" },
  { href: "/collection/alcantara/", label: "Alcantara" },
]

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
        <header className="border-b border-[var(--color-line)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <Link href="/" className="display text-2xl font-semibold">
              Florayn
            </Link>
            <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--color-ink-soft)]">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/cart/"
              className="ml-auto text-sm underline underline-offset-4"
            >
              Cart
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>

        <footer className="mt-16 border-t border-[var(--color-line)]">
          <div className="mx-auto max-w-6xl px-5 py-8 text-sm text-[var(--color-ink-soft)]">
            Florayn - printed cases, made in Dhaka. Prices in BDT.
          </div>
        </footer>
      </body>
    </html>
  )
}
