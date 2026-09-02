import type { Metadata } from "next"
import { Figtree, Fraunces } from "next/font/google"

import CartDrawer from "@/components/cart-drawer"
import CartProvider from "@/components/cart-provider"
import SiteFooter from "@/components/site-footer"
import SiteHeader from "@/components/site-header"
import { getSiteContent } from "@/lib/content"

import "./globals.css"

/*
 * TODO: replace both of these with the licensed brand faces when the files
 * arrive - ABC Arizona Flare Medium for display, Aeonik for body/UI. Drop the
 * woff2 files into the app, swap these for next/font/local, and point
 * --font-display / --font-sans in globals.css at the new families. Nothing
 * else in the storefront references a font by name.
 *
 * Fraunces stands in for Arizona Flare: it is the closest free flared serif,
 * and its wonk/soft axes give the flared terminals Arizona Flare is known for.
 * Figtree stands in for Aeonik: a geometric humanist sans with similar
 * proportions and a similar single-storey feel at UI sizes.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Florayn - printed cases for every device",
    template: "%s | Florayn",
  },
  description:
    "Premium printed cases for iPhone, Samsung, AirPods, Apple Watch and cards. One design, every device.",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const content = await getSiteContent()

  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body className="min-h-screen bg-paper text-ink">
        <CartProvider>
          <SiteHeader menu={content.primary} />

          <main className="mx-auto min-h-[60vh] w-full max-w-[1470px] px-[15px] py-12 md:px-[30px] md:py-16">
            {children}
          </main>

          <SiteFooter
            columns={content.footer}
            note={content.footerNote}
            social={content.social}
          />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  )
}
