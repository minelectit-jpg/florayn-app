import fs from "node:fs"
import path from "node:path"

/**
 * The running build's STABLE id — Next writes `.next/BUILD_ID` (a fresh random id
 * per build) and it does NOT change when the container merely restarts. Read once
 * and memoized.
 *
 * BuildWatcher (via the layout prop) and /api/build-id both use this so an
 * edge-cached page and the live server only ever disagree across a real DEPLOY,
 * never across a restart. The old source was `next.config` `env` set to
 * `Date.now()`, which was re-evaluated on every server start — so a plain restart
 * gave the origin a new id, mismatching every edge-cached page and forcing a
 * reload. Server-only (uses fs); the value reaches the client as the
 * BuildWatcher `buildId` prop, never imported into a client bundle.
 */
let cached: string | undefined

export function getBuildId(): string {
  if (cached) return cached
  const candidates = [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(process.cwd(), ".next", "standalone", ".next", "BUILD_ID"),
    path.join(process.cwd(), "..", ".next", "BUILD_ID"),
  ]
  for (const f of candidates) {
    try {
      const id = fs.readFileSync(f, "utf8").trim()
      if (id) {
        cached = id
        return cached
      }
    } catch {
      // try the next candidate
    }
  }
  // Last resort: the (unstable) env, else a constant. Either keeps the app
  // working; it just means BuildWatcher can't detect a deploy on this instance.
  cached = process.env.NEXT_PUBLIC_BUILD_ID || "nobuildid"
  return cached
}
