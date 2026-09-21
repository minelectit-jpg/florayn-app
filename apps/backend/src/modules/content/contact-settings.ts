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

export const CONTACT_SETTINGS_ID = "contactset_default"

// Keep the business details and policies already published on /contact/.
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
    { id: "delivery", question: "How long does delivery take?", answer: "Three to five days across Bangladesh. Delivery is 60৳ inside Dhaka and 100৳ outside, and free once your order reaches 3,400৳." },
    { id: "exchanges", question: "Can I exchange a case?", answer: "Yes - within three days of delivery, as long as the case is unused and in its packaging. Message us first so we can arrange the pickup." },
    { id: "payment", question: "How do I pay?", answer: "Cash on delivery. You pay the courier when the parcel reaches you." },
    { id: "devices", question: "My device is not listed.", answer: "Tell us which model you have. Not every design is cut for every body, but we can say what is available and when a new one is coming." },
  ],
}

export const CONTACT_TEXT_LIMITS = {
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

function normalizedPhone(value: string): string | undefined {
  if (!value) return ""
  let phone = value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).replace(/[\s().-]/g, "")
  if (/^01[3-9]\d{8}$/.test(phone)) phone = `+88${phone}`
  else if (/^8801[3-9]\d{8}$/.test(phone)) phone = `+${phone}`
  else if (phone.startsWith("00")) phone = `+${phone.slice(2)}`
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : undefined
}

function normalizedEmail(value: string): string | undefined {
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

/** Strict display-only patch; FAQ updates replace their ordered list. */
export function parseContactSettingsPatch(input: unknown):
  | { ok: true; patch: Partial<ContactSettings> }
  | { ok: false; errors: Record<string, string> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Expected contact settings." } }
  }
  const body = input as Record<string, unknown>
  const patch: Partial<ContactSettings> = {}
  const errors: Record<string, string> = {}
  const allowed = [...Object.keys(CONTACT_TEXT_LIMITS), "faqs"]
  if (!Object.keys(body).length) errors.form = "No contact settings provided."
  if (Object.keys(body).some((key) => !allowed.includes(key))) errors.form = "Only contact page settings can be edited here."
  for (const key of Object.keys(CONTACT_TEXT_LIMITS) as (keyof typeof CONTACT_TEXT_LIMITS)[]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    const text = plainText(body[key], CONTACT_TEXT_LIMITS[key], REQUIRED_TEXT.has(key))
    if (text === undefined) {
      errors[key] = `Use ${REQUIRED_TEXT.has(key) ? "1" : "0"}–${CONTACT_TEXT_LIMITS[key]} characters of plain text without HTML.`
      continue
    }
    const normalized = key === "phone" ? normalizedPhone(text) : key === "email" ? normalizedEmail(text) : text
    if (normalized === undefined) errors[key] = key === "phone"
      ? "Use an international phone number such as +8801310007055, or leave blank."
      : "Enter a valid email address without a link or query string, or leave blank."
    else patch[key] = normalized
  }
  if (Object.prototype.hasOwnProperty.call(body, "faqs")) {
    if (!Array.isArray(body.faqs) || body.faqs.length > 30) errors.faqs = "Use an ordered list of up to 30 questions."
    else {
      const ids = new Set<string>()
      const faqs: ContactFaq[] = []
      body.faqs.forEach((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).some((key) => !["id", "question", "answer"].includes(key))) {
          errors[`faqs.${index}`] = "Each question must contain only its ID, question and answer."
          return
        }
        const row = value as Record<string, unknown>
        const id = typeof row.id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id) ? row.id : undefined
        const question = plainText(row.question, 200, true)
        const answer = plainText(row.answer, 2000, true)
        if (!id || ids.has(id)) errors[`faqs.${index}.id`] = "Use a unique stable ID of 1–64 lowercase letters, numbers, underscores or hyphens."
        if (question === undefined) errors[`faqs.${index}.question`] = "Enter a question of 1–200 plain-text characters."
        if (answer === undefined) errors[`faqs.${index}.answer`] = "Enter an answer of 1–2000 plain-text characters."
        if (id) ids.add(id)
        if (id && question !== undefined && answer !== undefined) faqs.push({ id, question, answer })
      })
      patch.faqs = faqs
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch }
}

/** Whitelist fields, normalize safe links, and preserve explicit blanks/empty lists. */
export function publicContactSettings(value?: Partial<ContactSettings> | null): ContactSettings {
  const output: ContactSettings = { ...DEFAULT_CONTACT_SETTINGS, faqs: DEFAULT_CONTACT_SETTINGS.faqs.map((faq) => ({ ...faq })) }
  for (const key of [...Object.keys(CONTACT_TEXT_LIMITS), "faqs"] as (keyof ContactSettings)[]) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, key)) continue
    const parsed = parseContactSettingsPatch({ [key]: value[key] })
    if (parsed.ok) Object.assign(output, parsed.patch)
  }
  return output
}

/** Public/admin reads never insert a singleton or mutate FAQ order. */
export async function readContactSettings(service: {
  listContactSettings: (filters: { id: string }, config: { take: number }) => Promise<Partial<ContactSettings>[]>
}): Promise<ContactSettings> {
  const [settings] = await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 1 })
  return publicContactSettings(settings)
}
