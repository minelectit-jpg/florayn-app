import type { Metadata } from "next"
import { Suspense } from "react"

import SearchPageClient, { SearchSkeleton } from "@/components/search/search-page-client"
import { withAudience, type Audience } from "@/lib/audience"
import { getCaseTypes, getSiteContent } from "@/lib/content"
import { linkContext } from "@/lib/search/engine"
import { DEFAULT_PRESENTATION } from "@/lib/storefront-presentation"

export function searchMetadata(audience: Audience): Metadata {
  return {
    title: "Search",
    robots: { index: false, follow: true },
    alternates: { canonical: withAudience("/search/", audience) },
  }
}

/**
 * /search/ and /men/search/: one static page per mode. The words stay in the
 * address (?q=) and the results are worked out in the browser from the search
 * index, so every query shares this one cached HTML. The page itself only
 * sends the few settings the results need: where model and style links go
 * (from the mode's menu), the Try suggestions and the help link. It never
 * reads the searchParams prop (that would make it dynamic); the client part
 * reads ?q= with useSearchParams, and only once hydrated: the pages are
 * force-static, so the prerender sees no words, and both it and the first
 * render in the browser are the SearchSkeleton (the Suspense fallback too).
 */
export default async function SearchPage({ audience }: { audience: Audience }) {
  const [content, caseTypes] = await Promise.all([getSiteContent(), getCaseTypes()])
  const sections = audience === "men" && content.primaryMen?.length ? content.primaryMen : content.primary
  const links = linkContext(sections, Object.fromEntries(caseTypes.map((c) => [c.slug, c.forms])))
  const search = content.search ?? DEFAULT_PRESENTATION.search
  const navigation = content.navigation ?? DEFAULT_PRESENTATION.navigation

  return (
    <div className="pb-10 pt-4 md:pt-6">
      <h1 className="sr-only">Search</h1>
      <Suspense fallback={<SearchSkeleton placeholder={search.placeholder} />}>
        <SearchPageClient
          audience={audience}
          links={links}
          placeholder={search.placeholder}
          suggest={audience === "men" ? search.suggest_men : search.suggest_women}
          help={{ label: search.help_label, href: search.help_href }}
          rememberDevice={navigation.remember_device}
        />
      </Suspense>
    </div>
  )
}
