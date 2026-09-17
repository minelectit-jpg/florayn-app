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
    {
      // File Manager and the media picker upload a file at a time as base64
      // JSON. Videos are far larger than images, and base64 adds ~33%, so this
      // is raised to the practical ceiling in front of the app (Cloudflare's
      // ~100MB request cap). Feature-band videos should still be short, muted
      // loops — keep them compressed.
      matcher: "/admin/r2/upload",
      method: ["POST"],
      bodyParser: { sizeLimit: "100mb" },
    },
  ],
})
