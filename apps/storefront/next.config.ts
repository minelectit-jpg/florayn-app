import path from "node:path"

import type { NextConfig } from "next"

/*
 * A unique id per production build. Evaluated once when `next build` runs, so it
 * changes on every deploy. It is inlined (via env below) into both the client
 * bundle and the /api/build-id route, so a tab left open across a deploy can see
 * that the server is now on a newer build and refresh itself before the user
 * hits a stale chunk or a stale server-action id. Prefer a commit sha if the
 * build host provides one, else a timestamp.
 */
const BUILD_ID =
  process.env.SOURCE_COMMIT ||
  process.env.COOLIFY_GIT_COMMIT_SHA ||
  String(Date.now())

const nextConfig: NextConfig = {
  // Product and collection URLs must end in a slash:
  //   /product/<slug>/   /collection/<slug>/
  trailingSlash: true,

  // Exposed to the browser so BuildWatcher can compare the tab's build against
  // the live server's (see components/build-watcher.tsx).
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },

  /*
   * Persist the incremental cache (ISR HTML/RSC + fetch/data cache) in Redis so it
   * survives the container replacement on every deploy. cache-handler.js namespaces
   * route HTML by .next/BUILD_ID (a fresh random id per build - we deliberately do
   * NOT pin generateBuildId, so even a same-commit rebuild gets a new namespace and
   * can never serve an old build's HTML -> no ChunkLoadError) while keeping the
   * fetch/data cache build-independent so product data stays warm across deploys.
   * Redis operations use timeouts and a circuit breaker. If Redis is unavailable,
   * reads become cache misses; a custom handler does not inherit a filesystem
   * fallback. Monitor Redis availability alongside origin response times.
   */
  cacheHandler: path.join(import.meta.dirname, "cache-handler.js"),

  /*
   * This app is deployed on its own, with Root Directory apps/storefront and
   * its own package-lock.json. The repository root also has a lockfile, so
   * Next walks up, finds it, and warns that it guessed the workspace root.
   * Pin the root to this directory so tracing uses the storefront's own
   * dependency tree and the warning goes away. import.meta.dirname is this
   * file's directory regardless of where the build was invoked from.
   */
  outputFileTracingRoot: import.meta.dirname,

  /*
   * A few pages still prerender at build (home, shop, collections). The
   * default 60s ceiling is tight when they fetch from a cold backend, so give
   * them headroom. Product pages no longer prerender in bulk - see
   * generateStaticParams in product/[slug]/page.tsx - so this is a safety
   * margin, not load-bearing.
   */
  staticPageGenerationTimeout: 120,

  /*
   * Linting is a separate step, not a release gate. A missing eslint install
   * on the build host should not fail an otherwise-good production build.
   */
  eslint: { ignoreDuringBuilds: true },

  images: {
    /*
     * Next's on-demand image optimizer IS used (it turns the 1200px ~37KB R2
     * source into ~6-15KB responsive variants). The full-size unoptimized source
     * was making a shop page download ~2.4MB of images = 5-7s on a Bangladesh
     * connection - the dominant real-world slowness. The optimizer's "blank cards"
     * cold-start that we saw earlier was caused by CF cache PURGES wiping the edge
     * copies; we no longer purge, so the optimized `/_next/image` outputs stay
     * cached at the Dhaka PoP across deploys and are served small + fast. New/
     * un-warmed images optimize once at origin then edge-cache; warm the active
     * shops after enabling this so the common views are already at the edge.
     * minimumCacheTTL keeps the origin optimizer copy long-lived too.
     */
    minimumCacheTTL: 2678400, // 31 days
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "img.florayn.com" },
    ],
  },
}

export default nextConfig
