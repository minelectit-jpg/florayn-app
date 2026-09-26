/**
 * The paths ad tracking may see and the only URL parts it keeps (TRACKING.md
 * 4.1). In every page's layout chunk: tiny, no imports.
 */

export const PRIVATE_SEGMENTS: readonly string[] = ["order", "review", "account"]
export const PATH_PARAMS = ["case", "device", "variant"] as const
export const CLICK_KEYS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid"] as const
export const LANDING_PARAMS = [...CLICK_KEYS, "utm_source", "utm_medium", "utm_campaign"] as const

export function pathnameOf(p: string): string {
  return p.split(/[?#]/)[0]
}

/** /order, /review and /account pages, also under one /men. */
export function isPrivatePath(pathname: string): boolean {
  let path = pathnameOf(pathname)
  if (path === "/men" || path.startsWith("/men/")) path = path.slice(4)
  return PRIVATE_SEGMENTS.includes(path.split("/").filter(Boolean)[0])
}

function pick(search: string, keys: readonly string[], max: number): URLSearchParams {
  const from = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const key of keys) {
    const value = from.get(key)
    if (value !== null && value.length <= max) kept.set(key, value)
  }
  return kept
}

/** The pathname plus only case/device/variant, <= 300 chars. */
export function safePath(pathname: string, search = ""): string {
  const query = pick(search, PATH_PARAMS, 80).toString()
  const path = query ? `${pathname}?${query}` : pathname
  return path.length <= 300 ? path : pathname.slice(0, 300)
}

export function landingParams(search: string): Record<string, string> {
  return Object.fromEntries(pick(search, LANDING_PARAMS, 1000))
}
