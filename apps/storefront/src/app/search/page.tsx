import SearchPage, { searchMetadata } from "@/components/pages/search-page"

/**
 * One static page for every query: the words ride in ?q= and are searched in
 * the browser. force-static keeps it static whatever it reads; the client part
 * renders nothing that depends on ?q= until it has hydrated, so the HTML
 * (built without words) always matches the first render.
 */
export const dynamic = "force-static"

export const metadata = searchMetadata("women")

export default function WomenSearchPage() {
  return <SearchPage audience="women" />
}
