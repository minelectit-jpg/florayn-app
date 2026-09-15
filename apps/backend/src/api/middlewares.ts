import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * The design uploader sends each mockup as base64 JSON to /admin/designs/upload.
 * A single high-resolution render base64-encodes well past the default JSON body
 * limit, so raise it for that one route. Everything else keeps Medusa's default.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/designs/upload",
      method: ["POST"],
      bodyParser: { sizeLimit: "25mb" },
    },
  ],
})
