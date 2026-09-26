import { after } from "next/server"

import type { Audience } from "@/lib/audience"
import { EVENT_LIMITS, validateEvent, type BrowserEvent } from "@/lib/tracking/contract"
import { getTrackingConfig, hostRole } from "@/lib/tracking/server/config"
import { isNewVisitor, isVisitorId, sessionCookies, slideSession, VISITOR_COOKIE } from "@/lib/tracking/server/cookies"
import { bumpStat, forwardEvents } from "@/lib/tracking/server/forward"
import { ingestSecret } from "@/lib/tracking/server/keys"
import { rateLimiter } from "@/lib/tracking/server/rate-limit"
import {
  audienceFor, ingestContext, readBody, readEventBatch, readRequest, respond,
} from "@/lib/tracking/server/request-context"

// POST /api/t/e/ (TRACKING.md 4.2): the browser's event batches, from the
// runtime every 2 s and from the stub's sendBeacon on pagehide. It answers
// 204 at once and forwards to the backend inside after(), so the page never
// waits. Untrusted, unknown-host, opted-out, cookieless, bot and rate-limited
// requests get the same silent 204 and nothing is forwarded.
export const dynamic = "force-dynamic"

const MAX_BODY = 64 * 1024
/** The clock fix (I1): an event may be at most 60 s ahead of or 10 min behind the batch's sent_at. */
const MAX_AHEAD_MS = 60_000
const MAX_AGE_MS = 600_000

export async function POST(req: Request): Promise<Response> {
  const request = readRequest(req)
  if (!request.originOk) return respond(403)
  const body = await readBody(req, MAX_BODY)
  if (!body.ok) return respond(body.status)
  if (request.bot) {
    bumpStat("sf.bot")
    return respond(204)
  }
  // Checked before the settings are read, so a flood straight at the origin costs nothing.
  if (!request.edgeOk) {
    bumpStat("sf.untrusted")
    return respond(204)
  }
  const config = await getTrackingConfig()
  if (!hostRole(config, request.host)) {
    bumpStat("sf.unknown_host")
    return respond(204)
  }
  const vid = request.cookies[VISITOR_COOKIE]
  if (!ingestSecret() || request.optout || !isVisitorId(vid)) return respond(204)
  const batch = readEventBatch(body.text)
  if (!batch) return respond(400)

  const offered = batch.events.slice(0, EVENT_LIMITS.maxEventsPerBatch)
  let invalid = batch.events.length - offered.length
  const granted = rateLimiter.take(vid, request.trustedIp, offered.length)
  if (granted < offered.length) bumpStat("sf.rate_dropped", offered.length - granted)
  if (!granted) return respond(204)

  // The phone's clock may be off: keep only the event's age, measured on the phone.
  const now = Date.now()
  const events: BrowserEvent[] = []
  for (const raw of offered.slice(0, granted)) {
    const event = validateEvent(raw)
    const age = event ? batch.sentAt - event.t : 0
    if (!event || age < -MAX_AHEAD_MS || age > MAX_AGE_MS) {
      invalid += 1
      continue
    }
    events.push({ ...event, t: now - Math.max(0, age) })
  }
  if (invalid) bumpStat("sf.invalid", invalid)

  const session = slideSession(request.cookies, now)
  if (events.length) {
    const byAudience = new Map<Audience | null, BrowserEvent[]>()
    for (const event of events) {
      const audience = audienceFor(request, event.p)
      byAudience.set(audience, [...(byAudience.get(audience) ?? []), event])
    }
    const { host } = request
    const isNew = isNewVisitor(vid, session.sid)
    after(async () => {
      await Promise.all([...byAudience].map(([audience, list]) =>
        forwardEvents(host, ingestContext(request, { vid, session, audience, isNew }), list)))
    })
  }
  return respond(204, null, { cookies: sessionCookies(config, request.host, session) })
}
