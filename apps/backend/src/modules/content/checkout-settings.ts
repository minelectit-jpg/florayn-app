export type CheckoutSettings = {
  heading: string
  description: string
  delivery_note: string
  support_phone: string
  support_label: string
  show_order_note: boolean
}

export const CHECKOUT_SETTINGS_ID = "checkoutset_default"

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  heading: "Checkout",
  description: "Enter your delivery details to place your order.",
  delivery_note: "",
  // The existing store contact in content/defaults.ts.
  support_phone: "+8801310007055",
  support_label: "Need help?",
  show_order_note: true,
}

const TEXT_LIMITS = {
  heading: 80,
  description: 240,
  delivery_note: 240,
  support_phone: 32,
  support_label: 60,
} as const

/** Public projection: never serialize model internals or unrelated settings. */
export function publicCheckoutSettings(
  value?: Partial<CheckoutSettings> | null
): CheckoutSettings {
  return {
    heading: value?.heading ?? DEFAULT_CHECKOUT_SETTINGS.heading,
    description: value?.description ?? DEFAULT_CHECKOUT_SETTINGS.description,
    delivery_note: value?.delivery_note ?? DEFAULT_CHECKOUT_SETTINGS.delivery_note,
    support_phone: value?.support_phone ?? DEFAULT_CHECKOUT_SETTINGS.support_phone,
    support_label: value?.support_label ?? DEFAULT_CHECKOUT_SETTINGS.support_label,
    show_order_note: value?.show_order_note ?? DEFAULT_CHECKOUT_SETTINGS.show_order_note,
  }
}

/** A read never seeds the database or races another visitor's first request. */
export async function readCheckoutSettings(service: {
  listCheckoutSettings: (
    filters: { id: string },
    config: { take: number }
  ) => Promise<Partial<CheckoutSettings>[]>
}): Promise<CheckoutSettings> {
  const [settings] = await service.listCheckoutSettings(
    { id: CHECKOUT_SETTINGS_ID },
    { take: 1 }
  )
  return publicCheckoutSettings(settings)
}

/** Strict patch validation also applies to workflow callers outside the admin. */
export function parseCheckoutSettingsPatch(input: unknown):
  | { ok: true; patch: Partial<CheckoutSettings> }
  | { ok: false; errors: Record<string, string> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Expected checkout settings." } }
  }
  const body = input as Record<string, unknown>
  const patch: Partial<CheckoutSettings> = {}
  const errors: Record<string, string> = {}
  const allowed = [...Object.keys(TEXT_LIMITS), "show_order_note"]
  if (!Object.keys(body).length) errors.form = "No checkout settings provided."
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    errors.form = "Only checkout display settings can be edited here."
  }

  for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    const value = body[key]
    if (typeof value !== "string") {
      errors[key] = "Enter text for this field."
      continue
    }
    const text = value.trim()
    if (text.length > TEXT_LIMITS[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      errors[key] = `Use no more than ${TEXT_LIMITS[key]} characters of plain text.`
    } else if ((key === "heading" || key === "support_label") && !text) {
      errors[key] = "This field cannot be empty."
    } else if (key === "support_phone" && text) {
      let phone = text.replace(/[\s()-]/g, "")
      if (/^01[3-9]\d{8}$/.test(phone)) phone = `+88${phone}`
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
        errors[key] = "Use an international phone number, for example +8801310007055, or leave blank."
      } else {
        patch[key] = phone
      }
    } else {
      patch[key] = text
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "show_order_note")) {
    if (typeof body.show_order_note !== "boolean") {
      errors.show_order_note = "Choose whether to show the delivery note field."
    } else {
      patch.show_order_note = body.show_order_note
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch }
}
