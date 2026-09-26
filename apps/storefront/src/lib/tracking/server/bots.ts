import { assertServer } from "./guard"

assertServer()

/**
 * Crawlers, previewers, audits and our own cache warmer (TRACKING.md 4.2).
 * They get a 204 from /api/t/* with no cookies, so they never become
 * visitors, sessions or ad events.
 */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|Bytespider|HeadlessChrome|Lighthouse|PageSpeed|GTmetrix|florayn-warm|curl|wget|python-requests|node-fetch|axios|Go-http-client/i

/** A request without any User-Agent is not a browser either. */
export function isBot(ua: string | null | undefined): boolean {
  return !ua || !ua.trim() || BOT.test(ua)
}
