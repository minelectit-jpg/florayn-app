/**
 * Product "forms" (the shape a design is printed on) and their display labels.
 * A phone case's Features content is keyed by its case type; every other form —
 * AirPods case, sticky pad, card holder, ring holder… — is keyed by the form
 * label instead, so an AirPods case shows its own content rather than sharing
 * the phone's "Signature" set.
 *
 * The labels here must match the product-type tabs in the admin Features screen.
 */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  airpods: "AirPods",
  "sticky-pad": "Sticky Pad",
  sticky_pad: "Sticky Pad",
  stickpad: "Sticky Pad",
  card: "Card Holder",
  "card-holder": "Card Holder",
  ring: "Ring Holder",
  "ring-holder": "Ring Holder",
  charm: "Phone Charm",
  watch: "Watch Band",
  wallet: "Wallet",
}

/** The label for a form; a title-cased fallback keeps an unknown form usable. */
export function productTypeLabel(form?: string | null): string {
  if (!form) return ""
  return (
    PRODUCT_TYPE_LABELS[form] ??
    form
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

/**
 * The Features group for a product: its case type when it is a phone, otherwise
 * its form label. This is the value a feature block's case_type is matched
 * against.
 */
export function featuresGroup(
  form: string | null | undefined,
  caseType: string | undefined
): string | undefined {
  return form && form !== "phone" ? productTypeLabel(form) : caseType
}
