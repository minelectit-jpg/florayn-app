import { CLICK_KEYS, inertIdResponse, LANDING_PARAMS, type IdResponse, type LandingSnapshot } from "@/lib/tracking/contract"
import { getTrackingConfig, hostRole, pixelsFor } from "@/lib/tracking/server/config"
import { identify } from "@/lib/tracking/server/cookies"
import { bumpStat } from "@/lib/tracking/server/forward"
import { ingestSecret, sha256Hex } from "@/lib/tracking/server/keys"
import { readBody, readLanding, readRequest, respond, respondJson } from "@/lib/tracking/server/request-context"
import { classifySource } from "@/lib/tracking/server/source"

// POST /api/t/id/ (TRACKING.md 4.2): called once per document at first idle
// with the landing snapshot. It sets the visitor, session and vendor cookies
// and tells the browser whether tracking is on and which pixels may load.
// Without the Cloudflare edge header, on an unknown host, without the ingest
// secret or for an opted-out browser it answers `on: false` and sets nothing.
export const dynamic = "force-dynamic"

const MAX_BODY = 2048

function landingUrl(host: string, landing: LandingSnapshot): string {
  const params = new URLSearchParams()
  for (const key of LANDING_PARAMS) if (landing.q[key]) params.set(key, landing.q[key])
  const query = params.toString()
  return `https://${host}${landing.path}${query ? `?${query}` : ""}`
}

export async function POST(req: Request): Promise<Response> {
  const request = readRequest(req)
  if (!request.originOk) return respond(403)
  const body = await readBody(req, MAX_BODY)
  if (!body.ok) return respond(body.status)
  if (request.bot) {
    bumpStat("sf.bot")
    return respond(204)
  }
  let parsed: unknown
  try {
    parsed = body.text ? JSON.parse(body.text) : {}
  } catch {
    return respond(400)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond(400)

  const config = await getTrackingConfig()
  const inert = inertIdResponse(config.privacy.consent_version)
  const role = hostRole(config, request.host)
  if (!request.edgeOk) {
    bumpStat("sf.untrusted")
    return respondJson(200, inert)
  }
  if (!role) {
    bumpStat("sf.unknown_host")
    return respondJson(200, inert)
  }
  if (!ingestSecret()) return respondJson(200, inert)
  if (request.optout) return respondJson(200, { ...inert, optout: true })

  const { host } = request
  const landing = readLanding((parsed as { landing?: unknown }).landing)
  const identity = identify({
    config, host, cookies: request.cookies, landing, ua: request.ua, trustedIp: request.trustedIp, staff: request.staff,
  })
  const answer: IdResponse = {
    v: 1,
    on: true,
    env: role,
    ext: sha256Hex(identity.vid),
    sid: identity.session.sid,
    src: identity.session.src.s,
    staff: request.staff,
    optout: false,
    share: config.privacy.share,
    consent_version: config.privacy.consent_version,
    landing: landing ? {
      url: landingUrl(host, landing),
      click: CLICK_KEYS.find((key) => landing.q[key]) ?? null,
      src: classifySource({ q: landing.q, ref: landing.ref, ua: request.ua, host }).src,
    } : null,
    ...pixelsFor(config, host, request.cookies, identity.justSet),
  }
  return respondJson(200, answer, identity.setCookies)
}
