import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Product and collection URLs must end in a slash:
  //   /product/<slug>/   /collection/<slug>/
  trailingSlash: true,

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
     * Product artwork is served from R2. Both hosts are allowed up front so
     * swapping r2.dev for img.florayn.com needs no change here - the image
     * host is named in exactly one place, IMAGE_BASE_URL in the backend .env,
     * which scripts/wire-images.ts writes into the product rows.
     */
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "img.florayn.com" },
    ],
  },
}

export default nextConfig
