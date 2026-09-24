import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareVerb,
} from "@medusajs/framework/http"

import { queueStorefrontRevalidation } from "../lib/revalidate-storefront"
import { storefrontWriteTags } from "../lib/storefront-write-domains"

/**
 * After any successful admin write to storefront-visible data, flush the
 * storefront's ISR cache so the change is live immediately. Runs on response
 * `finish` and is fire-and-forget, so it never delays or fails the save itself.
 */
const revalidateAfterWrite = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const tags = storefrontWriteTags(req.originalUrl)
      if (tags.length) void queueStorefrontRevalidation({ tags })
    }
  })
  next()
}

// The admin path prefixes whose writes change what the storefront renders.
const STOREFRONT_WRITE_PREFIXES = [
  "content", "case-types", "devices", "designs", "bundles", "stock",
  "products", "product-variants", "product-collections", "product-categories",
  "price-lists", "price-preferences", "prices", "inventory-items",
  "media", "wire-images", "rebuild-cards",
]

export default defineMiddlewares({
  routes: [
    // A review comes from a signed-in customer or a review request link (token
    // checked in the workflow), so the session is read but not required.
    { matcher: "/store/product-reviews", method: ["POST"], middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })] },
    // Review photos arrive as base64 JSON, already shrunk by the storefront.
    {
      matcher: "/store/product-reviews/photos",
      method: ["POST"],
      bodyParser: { sizeLimit: "12mb" },
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
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

    /**
     * Populate req.auth_context on the custom checkout route from a customer
     * session (Bearer token), so a signed-in shopper's order is linked to their
     * account. allowUnauthenticated keeps guest checkout working unchanged.
     */
    {
      matcher: "/store/checkout",
      method: ["POST"],
      middlewares: [
        authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
      ],
    },

    // Auto-refresh the storefront after storefront-visible writes.
    ...STOREFRONT_WRITE_PREFIXES.flatMap((prefix) => [
      `/admin/${prefix}`, `/admin/${prefix}/*`,
    ]).map((matcher) => ({
      matcher,
      method: ["POST", "PUT", "PATCH", "DELETE"] as MiddlewareVerb[],
      middlewares: [revalidateAfterWrite],
    })),
  ],
})
