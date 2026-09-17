import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareVerb,
} from "@medusajs/framework/http"

import { revalidateStorefront } from "../lib/revalidate-storefront"

/**
 * After any successful admin write to storefront-visible data, flush the
 * storefront's ISR cache so the change is live immediately. Runs on response
 * `finish` and is fire-and-forget, so it never delays or fails the save itself.
 */
const revalidateAfterWrite = (
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      void revalidateStorefront()
    }
  })
  next()
}

// The admin path prefixes whose writes change what the storefront renders.
const STOREFRONT_WRITE_PREFIXES = [
  "/admin/content/*", // features, gallery videos, WTYL, home, menu, footer, SEO, collections
  "/admin/case-types/*", // construction prices
  "/admin/devices/*", // which models are on sale
  "/admin/designs/*", // add / remove a design
  "/admin/bundles/*", // pack + matching-set settings
  "/admin/stock/*", // in-stock badges
]

export default defineMiddlewares({
  routes: [
    /**
     * The design uploader sends each mockup as base64 JSON to /admin/designs/upload.
     * A single high-resolution render base64-encodes well past the default JSON body
     * limit, so raise it for that one route. Everything else keeps Medusa's default.
     */
    {
      matcher: "/admin/designs/upload",
      method: ["POST"],
      bodyParser: { sizeLimit: "25mb" },
    },
    {
      // File Manager and the media picker upload a file at a time as base64
      // JSON. Videos are far larger than images, and base64 adds ~33% (a 90MB
      // clip arrives as a ~120MB body), so this is generous. Feature-band videos
      // should still be short, muted, compressed loops — this is a ceiling, not
      // a target.
      matcher: "/admin/r2/upload",
      method: ["POST"],
      bodyParser: { sizeLimit: "200mb" },
    },

    // Auto-refresh the storefront after storefront-visible writes.
    ...STOREFRONT_WRITE_PREFIXES.map((matcher) => ({
      matcher,
      method: ["POST", "PUT", "DELETE"] as MiddlewareVerb[],
      middlewares: [revalidateAfterWrite],
    })),
  ],
})
