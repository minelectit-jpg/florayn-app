import SearchPage, { searchMetadata } from "@/components/pages/search-page"

/**
 * /men/search/: the Men designs first, and every link stays under /men. Static
 * like /search/ (see app/search/page.tsx): nothing that depends on ?q= renders
 * before hydration.
 */
export const dynamic = "force-static"

export const metadata = searchMetadata("men")

export default function MenSearchPage() {
  return <SearchPage audience="men" />
}
