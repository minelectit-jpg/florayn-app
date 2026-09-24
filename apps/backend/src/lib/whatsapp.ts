import { opsService } from "./order-ops"

/**
 * WhatsApp Business through Meta's Cloud API (graph.facebook.com). A business
 * may only start a conversation with an approved message template, so every
 * automatic message here is a template send: the template's fixed words plus
 * the values ({{1}}, {{2}}…) filled in per customer.
 *
 * The connection (phone number id, business account id, access token) is
 * saved in Admin > Reviews > WhatsApp. The token is never logged or returned.
 */
const GRAPH = "https://graph.facebook.com"
export const DEFAULT_API_VERSION = "v23.0"

export type WhatsAppSettings = {
  id: string
  enabled: boolean
  phone_number_id: string | null
  business_account_id: string | null
  access_token: string | null
  api_version: string
}

/** The single settings row, created empty the first time it is read. */
export async function getWhatsAppSettings(container: any): Promise<WhatsAppSettings> {
  const svc = opsService(container)
  const [row] = await svc.listWhatsAppSettings({}, { take: 1 })
  return row ?? (await svc.createWhatsAppSettings({}))
}

/** Switched on and able to send. */
export function whatsappReady(s: Pick<WhatsAppSettings, "enabled" | "phone_number_id" | "access_token"> | null | undefined): boolean {
  return Boolean(s?.enabled && s.phone_number_id && s.access_token)
}

/** The settings as the admin sees them: the token masked. */
export function presentWhatsApp(s: WhatsAppSettings) {
  const token = s.access_token ?? ""
  return {
    enabled: Boolean(s.enabled),
    phone_number_id: s.phone_number_id ?? "",
    business_account_id: s.business_account_id ?? "",
    api_version: s.api_version || DEFAULT_API_VERSION,
    access_token_set: Boolean(token),
    access_token_masked: token.length > 6 ? `••••••••${token.slice(-4)}` : token ? "••••" : "",
    ready: whatsappReady(s),
  }
}

export type GraphResult<T = any> = { ok: true; data: T } | { ok: false; error: string; code?: number }

/** One Graph API call. Errors come back as a readable message, never thrown. */
export async function graphCall<T = any>(
  s: Pick<WhatsAppSettings, "access_token" | "api_version">,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch
): Promise<GraphResult<T>> {
  if (!s.access_token) return { ok: false, error: "No access token is saved." }
  const version = /^v\d{1,3}\.\d{1,3}$/.test(s.api_version ?? "") ? s.api_version : DEFAULT_API_VERSION
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetchImpl(`${GRAPH}/${version}/${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      const e = json?.error ?? {}
      return { ok: false, error: e.error_user_msg || e.message || `WhatsApp answered ${res.status}.`, code: e.code }
    }
    return { ok: true, data: json as T }
  } catch (error: any) {
    return { ok: false, error: error?.name === "AbortError" ? "WhatsApp did not answer in time." : String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A template value. WhatsApp refuses values with new lines, tabs or more than
 * four spaces in a row, and empty ones.
 */
export function templateText(value: unknown, fallback = "-"): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 900)
  return text || fallback
}

export type TemplateMessage = {
  /** 8801XXXXXXXXX */
  to: string
  name: string
  language: string
  /** Values for the body's {{1}}, {{2}}… in order. */
  body?: string[]
  /** The {{1}} part of the template's first (URL) button. */
  buttonUrl?: string
}

/** The Cloud API request body for a template message. */
export function templatePayload(m: TemplateMessage) {
  const components: any[] = []
  if (m.body?.length) components.push({ type: "body", parameters: m.body.map((text) => ({ type: "text", text: templateText(text) })) })
  if (m.buttonUrl) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.buttonUrl }] })
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: m.to,
    type: "template",
    template: { name: m.name, language: { code: m.language }, ...(components.length ? { components } : {}) },
  }
}

/** Send one template message. Resolves with WhatsApp's message id, or the reason it failed. */
export async function sendTemplate(
  s: WhatsAppSettings,
  m: TemplateMessage,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!whatsappReady(s)) return { ok: false, error: "WhatsApp is not connected." }
  const result = await graphCall<any>(s, `${encodeURIComponent(s.phone_number_id!)}/messages`, { method: "POST", body: templatePayload(m) }, fetchImpl)
  return result.ok ? { ok: true, id: String(result.data?.messages?.[0]?.id ?? "") } : { ok: false, error: result.error }
}

/**
 * A wa.me link that opens WhatsApp (app or web) on the customer's chat with
 * the message typed in, for sending by hand from the shop's own WhatsApp. No
 * Meta setup needed.
 */
export function waMeLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}
