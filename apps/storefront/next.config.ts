import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Product and collection URLs must end in a slash:
  //   /product/<slug>/   /collection/<slug>/
  trailingSlash: true,
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
