/**
 * The storefront has no `server-only` package (TRACKING.md 0.2, 4.8), so every
 * module under lib/tracking/server/ calls this at load time. If a client
 * component ever pulls one in, the browser bundle throws on import instead of
 * quietly shipping the code that handles the tracking secrets.
 * tests/tracking-server.test.cjs also proves no client module imports this
 * folder.
 */
export function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/tracking/server is server-only and was imported in a browser bundle")
  }
}
