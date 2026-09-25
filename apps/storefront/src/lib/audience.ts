/**
 * Women / Men shopping modes.
 *
 * Women is the default and lives at the root (`/`, `/shop/…`); Men is the same
 * site under `/men` (`/men/`, `/men/shop/…`). The mode is in the URL rather
 * than a cookie so every page stays static and edge-cacheable, and a link (an
 * ad, a share) always opens the mode it was made in.
 *
 * Products carry `metadata.audience`: "women", "men" or "both". A missing or
 * unknown value is "both", so an untagged product shows in either mode.
 */

export type Audience = "women" | "men"
export type AudienceTag = Audience | "both"

export const AUDIENCES: readonly Audience[] = ["women", "men"]
export const MEN_PREFIX = "/men"
/** Remembers the last mode for pages that exist once (cart, contact, account). */
export const AUDIENCE_COOKIE = "fl_audience"

/** Paths that have a Men counterpart. Everything else (cart, contact…) is shared. */
const SCOPED = /^\/(?:$|[?#]|shop(?:[/?#]|$)|collections?(?:[/?#]|$)|product\/|search(?:[/?#]|$))/

export function isAudience(value: unknown): value is Audience {
  return value === "women" || value === "men"
}

/** The mode a pathname is in, or null for a shared page like /cart/. */
export function audienceFromPath(pathname: string | null | undefined): Audience | null {
  if (!pathname) return null
  if (pathname === MEN_PREFIX || pathname.startsWith(`${MEN_PREFIX}/`)) return "men"
  return SCOPED.test(pathname) ? "women" : null
}

/** The path without its /men prefix ("/men/shop/x/" -> "/shop/x/", "/men" -> "/"). */
export function stripAudience(path: string): string {
  if (path === MEN_PREFIX) return "/"
  if (path.startsWith(`${MEN_PREFIX}/`) || path.startsWith(`${MEN_PREFIX}?`) || path.startsWith(`${MEN_PREFIX}#`)) {
    const rest = path.slice(MEN_PREFIX.length)
    return rest.startsWith("/") ? rest : `/${rest}`
  }
  return path
}

/**
 * An internal link in the given mode. Admin-entered links stay plain
 * ("/shop/…") and pick up /men here, so one menu or tile works in both modes.
 * Shared pages, external links, anchors and mail/tel links are left alone.
 */
export function withAudience(href: string, audience: Audience): string {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return href
  const plain = stripAudience(href)
  if (audience === "women" || !SCOPED.test(plain)) return plain
  return plain === "/" ? `${MEN_PREFIX}/` : `${MEN_PREFIX}${plain}`
}

/**
 * Where the toggle goes: the same page in the other mode, or that mode's home
 * when the current page is shared (a cart has no "men" version).
 */
export function switchAudiencePath(pathnameWithQuery: string, target: Audience): string {
  const plain = stripAudience(pathnameWithQuery || "/")
  if (!SCOPED.test(plain)) return target === "men" ? `${MEN_PREFIX}/` : "/"
  return withAudience(plain, target)
}

/** A product's (or variant's) tag from its metadata; unknown means both. */
export function readAudienceTag(metadata: unknown): AudienceTag {
  const value = (metadata as Record<string, unknown> | null | undefined)?.audience
  return value === "women" || value === "men" ? value : "both"
}

export function fitsAudience(tag: AudienceTag | null | undefined, audience: Audience): boolean {
  return !tag || tag === "both" || tag === audience
}

/** Keep only what belongs in this mode (by each item's metadata.audience). */
export function forAudience<T extends { metadata?: unknown }>(items: T[], audience: Audience): T[] {
  return items.filter((item) => fitsAudience(readAudienceTag(item.metadata), audience))
}
