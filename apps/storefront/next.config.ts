import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Product and collection URLs must end in a slash:
  //   /product/<slug>/   /collection/<slug>/
  trailingSlash: true,
  // Seed artwork is inline SVG, so no remote image host is needed yet. Add the
  // CDN host here once real artwork is uploaded through a file provider.
  images: {
    remotePatterns: [],
  },
}

export default nextConfig
