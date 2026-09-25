import type { Audience } from "@/lib/audience"
import type { HeaderData } from "@/lib/header-data"

/**
 * The contracts between the always-loaded header shell (site-header.tsx,
 * header-dialogs.tsx) and the parts it loads on intent (nav-drawer.tsx,
 * search-results.tsx) or mounts empty (search-sheet.tsx).
 */

/** The two native <dialog> sheets, always in the page, opened with showModal(). */
export const DRAWER_ID = "site-drawer"
export const SEARCH_ID = "site-search"
/** The search sheet's input, always mounted so a tap can focus it at once (iOS keyboard). */
export const SEARCH_INPUT_ID = "site-search-input"

/** components/header/nav-drawer.tsx (lazy): the menu levels under the drawer's top bar. */
export type NavDrawerProps = {
  data: HeaderData
  /** The mode shown: from the path, or the switch in flight. */
  audience: Audience
  pathname: string
  /** Increments every time the drawer opens; the drawer returns to its first level on change. */
  openCount: number
  /** Start the drawer's close animation (a link was chosen). */
  onNavigate: () => void
}

/** components/header/search-sheet.tsx: the search sheet's always-mounted body. */
export type SearchSheetProps = {
  data: HeaderData
  audience: Audience
  /** Close the sheet (animated) and return focus to what opened it. */
  onClose: () => void
}
