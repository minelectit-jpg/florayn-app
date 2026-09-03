import type { MetadataRoute } from "next"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://florayn.com"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing to gain from crawling a cart or a one-off order page.
      disallow: ["/cart/", "/checkout/", "/order/"],
    },
    sitemap: `${SITE}/sitemap-index.xml`,
  }
}
