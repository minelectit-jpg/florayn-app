import { cache } from "react"

export type ContactFaq = { id: string; question: string; answer: string }

export type ContactSettings = {
  eyebrow: string
  title: string
  description: string
  phone_label: string
  phone: string
  phone_note: string
  email_label: string
  email: string
  email_note: string
  address_label: string
  address: string
  address_note: string
  faq_eyebrow: string
  faq_title: string
  faq_description: string
  help_title: string
  help_description: string
  faqs: ContactFaq[]
}

// Preserve the existing contact details if the settings endpoint is unavailable.
// A regression test keeps these defaults aligned with the backend contract.
export const DEFAULT_CONTACT_SETTINGS: ContactSettings = {
  eyebrow: "Contact",
  title: "Talk to us",
  description: "Questions about an order, a device we do not list yet, or an exchange - the fastest answer is a phone call.",
  phone_label: "Phone",
  phone: "+8801310007055",
  phone_note: "Saturday to Thursday, 10am - 8pm",
  email_label: "Email",
  email: "info@florayn.com",
  email_note: "We reply within one working day",
  address_label: "Address",
  address: "Plot #H-2 (1st Floor), Block-H, Sector-2, Avenue-10\nZahurul Islam City (Aftabnagar Eastern Housing Project)\nDhaka-1212, Bangladesh",
  address_note: "",
  faq_eyebrow: "FAQs",
  faq_title: "Common questions",
  faq_description: "A few helpful answers before you get in touch.",
  help_title: "Still have a question?",
  help_description: "Call or email us about your order, device compatibility or an exchange.",
  faqs: [
    { id: "delivery", question: "How long does delivery take?", answer: "One to three days across Bangladesh. Delivery is 60৳ inside Dhaka and 100৳ outside, and free once your order reaches 3,400৳." },
    { id: "exchanges", question: "Can I exchange a case?", answer: "Yes - within three days of delivery, as long as the case is unused and in its packaging. Message us first so we can arrange the pickup." },
    { id: "payment", question: "How do I pay?", answer: "Cash on delivery. You pay the courier when the parcel reaches you." },
    { id: "devices", question: "My device is not listed.", answer: "Tell us which model you have. Not every design is cut for every body, but we can say what is available and when a new one is coming." },
  ],
}

const TEXT_LIMITS = {
  eyebrow: 60, title: 120, description: 600,
  phone_label: 60, phone: 40, phone_note: 240,
  email_label: 60, email: 254, email_note: 240,
  address_label: 60, address: 1000, address_note: 240,
  faq_eyebrow: 60, faq_title: 120, faq_description: 600,
  help_title: 120, help_description: 600,
} as const
const REQUIRED_TEXT = new Set(["title", "faq_title", "phone_label", "email_label", "address_label"])
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/

function plainText(value: unknown, max: number, required: boolean): string | undefined {
  if (typeof value !== "string" || value.length > max) return undefined
  const text = value.replace(/\r\n?/g, "\n").trim()
  return UNSAFE_TEXT.test(text) || (required && !text) ? undefined : text
}

function safePhone(value: string): string | undefined {
  if (!value) return ""
  let phone = value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).replace(/[\s().-]/g, "")
  if (/^01[3-9]\d{8}$/.test(phone)) phone = `+88${phone}`
  else if (/^8801[3-9]\d{8}$/.test(phone)) phone = `+${phone}`
  else if (phone.startsWith("00")) phone = `+${phone.slice(2)}`
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : undefined
}

function safeEmail(value: string): string | undefined {
  if (!value) return ""
  const email = value.toLowerCase()
  const [local, domain, extra] = email.split("@")
  if (extra !== undefined || !local || local.length > 64 || !/^[a-z0-9._+-]+$/.test(local) ||
    local.startsWith(".") || local.endsWith(".") || local.includes("..") || !domain) return undefined
  const labels = domain.split(".")
  if (labels.length < 2 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^[a-z]{2,63}$/.test(labels.at(-1)!)) return undefined
  return email
}

/** Missing/malformed fields fall back; deliberately cleared fields stay clear. */
export function normalizeContactSettings(value: unknown): ContactSettings {
  const result = { ...DEFAULT_CONTACT_SETTINGS, faqs: DEFAULT_CONTACT_SETTINGS.faqs.map((faq) => ({ ...faq })) }
  if (!value || typeof value !== "object" || Array.isArray(value)) return result
  const source = value as Record<string, unknown>
  for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
    const text = plainText(source[key], TEXT_LIMITS[key], REQUIRED_TEXT.has(key))
    if (text === undefined) continue
    const normalized = key === "phone" ? safePhone(text) : key === "email" ? safeEmail(text) : text
    if (normalized !== undefined) result[key] = normalized
  }
  if (Array.isArray(source.faqs) && source.faqs.length <= 30) {
    const ids = new Set<string>()
    const faqs: ContactFaq[] = []
    for (const row of source.faqs) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue
      const id = typeof row.id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id) ? row.id : undefined
      const question = plainText(row.question, 200, true)
      const answer = plainText(row.answer, 2000, true)
      if (!id || ids.has(id) || question === undefined || answer === undefined) continue
      ids.add(id)
      faqs.push({ id, question, answer })
    }
    if (faqs.length || source.faqs.length === 0) result.faqs = faqs
  }
  return result
}

const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

/** One small, tagged server read shared by metadata and the Contact page. */
export const getContactSettings = cache(async (): Promise<ContactSettings> => {
  try {
    const response = await fetch(`${BACKEND}/store/contact-settings`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60, tags: ["content", "content:contact"] },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return normalizeContactSettings(null)
    const data: unknown = await response.json()
    const settings = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).settings : undefined
    return normalizeContactSettings(settings)
  } catch {
    return normalizeContactSettings(null)
  }
})
