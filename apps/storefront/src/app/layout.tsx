import type { Metadata } from "next"
import { Instrument_Sans } from "next/font/google"

import BuildWatcher from "@/components/build-watcher"
import PerformanceAuditLoader from "@/components/performance-audit-loader"
import CartDrawer from "@/components/cart-drawer"
import CartProvider from "@/components/cart-provider"
import SiteFooter from "@/components/site-footer"
import SiteHeader from "@/components/site-header"
import { getBuildId } from "@/lib/build-id"
import { getCaseTypes, getSiteContent } from "@/lib/content"

import "./globals.css"

/*
 * Instrument Sans is the whole site's typeface - body, UI and headings alike.
 * It is loaded once here and exposed as --font-instrument; both --font-display
 * and --font-sans point at it in globals.css, so nothing else references a font
 * by name. (To give headings a separate face later, load it here and repoint
 * --font-display.)
 */
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
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
  const [content, caseTypes] = await Promise.all([
    getSiteContent(),
    getCaseTypes(),
  ])

  return (
    <html lang="en" className={instrumentSans.variable}>
      <body className="min-h-screen bg-paper text-ink">
        <BuildWatcher buildId={getBuildId()} />
        <PerformanceAuditLoader />
        <CartProvider>
          <SiteHeader menu={content.primary} caseTypes={caseTypes} />

          <main className="mx-auto min-h-[60vh] w-full max-w-[1470px] px-[15px] py-6 md:px-[30px] md:py-16">
            {children}
          </main>

          <SiteFooter
            appearance={content.footerAppearance}
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
