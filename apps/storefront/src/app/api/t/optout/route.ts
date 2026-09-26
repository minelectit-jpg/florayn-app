import { getTrackingConfig } from "@/lib/tracking/server/config"
import { optoutCookies } from "@/lib/tracking/server/cookies"
import { readRequest, respondPage } from "@/lib/tracking/server/request-context"

// GET /api/t/optout/?on=1|0 (TRACKING.md 4.2, 12): the Privacy page's "Turn
// off ad measurement on this browser" and "Turn it back on" links. Turning it
// off sets `_fl_optout` and expires every tracking cookie (host-only and
// Domain copies); from then on no pixel loads, /api/t/e/ drops this browser's
// events and its orders send nothing to ad platforms.
export const dynamic = "force-dynamic"

export async function GET(req: Request): Promise<Response> {
  const request = readRequest(req)
  const on = new URL(req.url).searchParams.get("on") !== "0"
  const config = await getTrackingConfig()
  return on
    ? respondPage(200, "Ad measurement is off on this browser",
      "We removed our measurement cookies and will not send your visits or orders from this browser to advertising partners. It applies to this browser only.",
      optoutCookies(config, request.host, true))
    : respondPage(200, "Ad measurement is back on for this browser",
      "Your visits and orders from this browser are measured again as our Privacy policy describes.",
      optoutCookies(config, request.host, false))
}
