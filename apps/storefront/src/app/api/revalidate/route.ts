import { revalidatePath, revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"

// This route runs on demand (never cached) so it can flush the ISR cache the
// moment the admin saves a change.
export const dynamic = "force-dynamic"

/**
 * On-demand revalidation. The Medusa backend calls this after any content change
 * (and the admin's "Refresh storefront" button hits it too), so an edit shows up
 * instantly instead of waiting out the ISR window - while pages stay cached and
 * fast the rest of the time.
 *
 * Auth: a shared secret in REVALIDATE_SECRET, passed as ?secret= or the
 * x-revalidate-secret header. Without a configured secret the route refuses, so
 * a misconfigured deploy fails closed rather than exposing an open purge.
 */
export async function POST(req: NextRequest) {
  const secret =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-revalidate-secret")

  const expected = process.env.REVALIDATE_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    )
  }

  // An optional single path (e.g. "/product/legends-iphone-17-pro-max") keeps
  // the blast radius small; with none, refresh every page under the root layout.
  const path = req.nextUrl.searchParams.get("path")
  if (path) {
    revalidatePath(path)
  } else {
    revalidatePath("/", "layout")
  }

  // Also bust the cached Medusa product DATA (lib/medusa.ts wraps listProducts in
  // unstable_cache with these tags). Without this, a route revalidation would
  // re-render but still read stale product JSON from the persistent data cache for
  // up to CACHE_TTL_SECONDS. An optional ?handle= busts just one product's data.
  const handle = req.nextUrl.searchParams.get("handle")
  if (handle) {
    revalidateTag(`product:${handle}`)
  } else {
    revalidateTag("products")
  }

  return NextResponse.json({
    ok: true,
    revalidated: path ?? "all",
    tags: handle ? `product:${handle}` : "products",
    now: Date.now(),
  })
}
