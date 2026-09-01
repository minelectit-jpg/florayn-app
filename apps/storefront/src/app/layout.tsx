import type { Metadata } from "next"

import CartDrawer from "@/components/cart-drawer"
import CartProvider from "@/components/cart-provider"
import SiteHeader from "@/components/site-header"

import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Florayn",
    template: "%s | Florayn",
  },
  description:
    "Printed cases for iPhone, Samsung, AirPods, Apple Watch and cards.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
        <CartProvider>
          <SiteHeader />

          <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>

          <footer className="mt-16 border-t border-[var(--color-line)]">
            <div className="mx-auto max-w-6xl px-5 py-8 text-sm text-[var(--color-ink-soft)]">
              Florayn - printed cases, made in Dhaka. Prices in BDT.
            </div>
          </footer>

          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  )
}
