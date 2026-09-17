/**
 * Ping the storefront's on-demand revalidation endpoint so an admin change shows
 * up on the live site immediately instead of waiting out the ISR window.
 *
 * Best-effort and non-blocking: if the storefront is unreachable or the env is
 * unset, it just returns false and the edit still appears within the normal
 * cache window - it never throws, so it can't break the save that triggered it.
 *
 * Config (both set on the backend app): STOREFRONT_URL (e.g. https://new.florayn.com)
 * and REVALIDATE_SECRET (must match the storefront's REVALIDATE_SECRET).
 */
export async function revalidateStorefront(path?: string): Promise<boolean> {
  const base = process.env.STOREFRONT_URL?.replace(/\/+$/, "")
  const secret = process.env.REVALIDATE_SECRET
  if (!base || !secret) return false

  const qs = new URLSearchParams({ secret })
  if (path) qs.set("path", path)

  try {
    // Trailing slash: the storefront uses trailingSlash, so /api/revalidate
    // 308-redirects to /api/revalidate/ - hit the final URL directly.
    const res = await fetch(`${base}/api/revalidate/?${qs.toString()}`, {
      method: "POST",
    })
    return res.ok
  } catch {
    return false
  }
}
