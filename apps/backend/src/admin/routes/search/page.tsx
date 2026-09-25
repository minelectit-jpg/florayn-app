import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass } from "@medusajs/icons"
import { useEffect, useState } from "react"

import { contentApi } from "../../components/menu-editor"
import { SearchPresentationEditor } from "../../components/storefront-presentation-editor"

/**
 * Admin > Search: the header search field, its Try suggestions, synonyms and
 * the no-results help link. Saving refreshes the header and the search index
 * (the 'content' tag).
 */
const SearchPage = () => {
  const [storefront, setStorefront] = useState("")
  useEffect(() => {
    // Only for the "Try it on the store" link; the page works without it.
    contentApi("/admin/content/collection-pages")
      .then((d) => setStorefront(typeof d.storefrontUrl === "string" ? d.storefrontUrl : ""))
      .catch(() => undefined)
  }, [])
  return <SearchPresentationEditor storefront={storefront} />
}

export const config = defineRouteConfig({
  label: "Search",
  icon: MagnifyingGlass,
})

export default SearchPage
