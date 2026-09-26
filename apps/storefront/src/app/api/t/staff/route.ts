import { getTrackingConfig, hostRole } from "@/lib/tracking/server/config"
import { staffCookies } from "@/lib/tracking/server/cookies"
import { staffLinkToken, timingSafeEqualStr } from "@/lib/tracking/server/keys"
import { readRequest, respondPage } from "@/lib/tracking/server/request-context"

// GET /api/t/staff/?t=<token>&on=1|0 (TRACKING.md 4.2): the "Exclude this
// browser" link from Admin > Live. With the right token on a known host it
// sets (or clears) `_fl_staff`; a marked browser loads no pixels, sends
// nothing to ad platforms and shows as internal on the dashboard. Anything
// else is a plain 404, so the route reveals nothing.
export const dynamic = "force-dynamic"

export async function GET(req: Request): Promise<Response> {
  const request = readRequest(req)
  const params = new URL(req.url).searchParams
  const config = await getTrackingConfig()
  const expected = staffLinkToken()
  if (!hostRole(config, request.host) || !expected || !timingSafeEqualStr(params.get("t"), expected)) {
    return respondPage(404, "Page not found", "This link is not valid.")
  }
  const on = params.get("on") !== "0"
  return on
    ? respondPage(200, "This browser is marked as staff",
      "Its visits and orders are left out of ad measurement and show as internal on the Live dashboard.",
      staffCookies(config, request.host, true))
    : respondPage(200, "This browser is no longer marked as staff",
      "Its visits and orders count as a normal shopper's again.",
      staffCookies(config, request.host, false))
}
