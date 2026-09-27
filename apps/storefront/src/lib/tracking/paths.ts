/**
 * The paths ad tracking may see (TRACKING.md 4.1). In every page's layout
 * chunk (the stub and queue.ts check it before they record anything): tiny,
 * no imports. The URL parts tracking keeps (safePath, landingParams and their
 * allowlists) live in contract.ts, which only the lazy chunks and the server
 * load.
 */

export const PRIVATE_SEGMENTS: readonly string[] = ["order", "review", "account"]

export function pathnameOf(p: string): string {
  return p.split(/[?#]/)[0]
}

/** /order, /review and /account pages, also under one /men. */
export function isPrivatePath(pathname: string): boolean {
  let path = pathnameOf(pathname)
  if (path === "/men" || path.startsWith("/men/")) path = path.slice(4)
  return PRIVATE_SEGMENTS.includes(path.split("/").filter(Boolean)[0])
}
