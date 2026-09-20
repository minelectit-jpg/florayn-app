import { isDistrict, isValidPhone, normalizePhone } from "../modules/catalog/data/bangladesh"

export type CheckoutFields = {
  cart_id: string
  district: string
  full_name: string
  phone: string
  email: string
  address: string
  area: string
  note: string
  quote_version: string
}

/** Public bodies are untrusted: never call string methods before checking type. */
export function validateCheckoutBody(body: unknown, complete: boolean) {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {}
  const errors: Record<string, string> = {}
  const limits = { cart_id: 100, district: 80, full_name: 100, phone: 24,
    email: 254, address: 500, area: 100, note: 500, quote_version: 64 }
  const fields = {} as CheckoutFields
  for (const [key, maximum] of Object.entries(limits)) {
    const value = source[key]
    fields[key as keyof CheckoutFields] = typeof value === "string" ? value.trim() : ""
    if (value != null && (typeof value !== "string" || value.length > maximum)) {
      errors[key] = `Enter a valid ${key.replace(/_/g, " ")} (up to ${maximum} characters).`
    }
  }
  if (!/^cart_[a-zA-Z0-9]+$/.test(fields.cart_id)) errors.cart_id = "Your cart could not be found. Return to your bag and try again."
  if (!isDistrict(fields.district)) errors.district = "Select a Bangladeshi district."
  if (complete) {
    if (fields.full_name.length < 2) errors.full_name = "Enter the full name for delivery."
    if (!/^[\d০-৯+()\s-]+$/.test(fields.phone) || !isValidPhone(fields.phone)) errors.phone = "Enter a valid Bangladeshi mobile number, like 01712345678."
    if (fields.address.length < 5) errors.address = "Enter your house, road or village for delivery."
    if (!fields.area) errors.area = "Enter the area or thana."
    if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) errors.email = "Enter a valid email address or leave it blank."
    if (!/^[a-f0-9]{64}$/.test(fields.quote_version)) errors.form = "Please review your delivery total before placing the order."
    if (source.payment_method != null && source.payment_method !== "cash_on_delivery") errors.form = "Cash on delivery is the available payment method."
    fields.phone = normalizePhone(fields.phone)
  }
  return { fields, errors }
}
