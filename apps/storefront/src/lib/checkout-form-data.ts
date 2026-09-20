import type { CartItem } from "./cart"

export type CheckoutFields = {
  full_name: string
  phone: string
  email: string
  address: string
  district: string
  area: string
  note: string
}

export const EMPTY_CHECKOUT_FIELDS: CheckoutFields = {
  full_name: "", phone: "", email: "", address: "", district: "", area: "", note: "",
}

export function normalizeCheckoutPhone(value: string): string {
  let digits = value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[^\d]/g, "")
  if (digits.startsWith("880")) digits = digits.slice(3)
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`
  return digits
}

export function validateCheckout(fields: CheckoutFields, districts: string[]): Record<string, string> {
  const errors: Record<string, string> = {}
  if (fields.full_name.trim().length < 2 || fields.full_name.trim().length > 100) errors.full_name = "Enter your full name (2–100 characters)."
  if (!/^01[3-9]\d{8}$/.test(normalizeCheckoutPhone(fields.phone))) errors.phone = "Enter a valid Bangladesh mobile number, such as 01712345678."
  if (!districts.includes(fields.district)) errors.district = "Select your delivery district."
  if (!fields.area.trim() || fields.area.trim().length > 100) errors.area = "Enter your area or thana (up to 100 characters)."
  if (fields.address.trim().length < 5 || fields.address.trim().length > 500) errors.address = "Enter your house, road or village and full address (5–500 characters)."
  if (fields.email.trim() && (fields.email.trim().length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email.trim()))) errors.email = "Enter a valid email address, or leave this blank."
  if (fields.note.trim().length > 500) errors.note = "Keep your delivery note within 500 characters."
  return errors
}

export type CheckoutLine = {
  id: string
  title: string
  variant_title: string
  quantity: number
  unit_price: number
  subtotal: number
  total?: number
  thumbnail: string | null
}

/** Never send a product's metadata/card matrices across the client boundary. */
export function checkoutLines(items: CartItem[]): CheckoutLine[] {
  return items.map((item) => {
    const images = item.variant?.metadata?.images
    const image = Array.isArray(images) && typeof images[0] === "string" ? images[0] : null
    return {
      id: item.id,
      title: item.variant?.product?.title ?? item.title,
      variant_title: item.variant?.title ?? item.subtitle ?? "",
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.unit_price * item.quantity,
      thumbnail: image ?? item.thumbnail ?? item.variant?.product?.thumbnail ?? null,
    }
  })
}
