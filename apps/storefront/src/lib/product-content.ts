export type ProductContent = {
  description_heading: string; information_heading: string; faq_heading: string
  reviews_heading: string; reviews_intro: string; reviews_enabled: boolean
  facts: { label: string; value: string }[] | null
  faqs: { question: string; answer: string }[] | null
}
export const DEFAULT_PRODUCT_CONTENT: ProductContent = {
  description_heading: "Description", information_heading: "Product details",
  faq_heading: "Good to know", reviews_heading: "Reviews",
  reviews_intro: "Real experiences, shared by our customers.", reviews_enabled: true,
  facts: null, faqs: null,
}
export function readProductContent(metadata?: Record<string, unknown> | null): ProductContent {
  const raw = metadata?.florayn_product_content as Partial<ProductContent> | undefined
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PRODUCT_CONTENT }
  const result = { ...DEFAULT_PRODUCT_CONTENT }
  for (const key of ["description_heading", "information_heading", "faq_heading", "reviews_heading", "reviews_intro"] as const) {
    if (typeof raw[key] === "string" && raw[key].trim()) result[key] = raw[key]
  }
  if (typeof raw.reviews_enabled === "boolean") result.reviews_enabled = raw.reviews_enabled
  if (Array.isArray(raw.facts)) result.facts = raw.facts.filter((r) => typeof r?.label === "string" && typeof r.value === "string").slice(0, 16)
  if (Array.isArray(raw.faqs)) result.faqs = raw.faqs.filter((r) => typeof r?.question === "string" && typeof r.answer === "string").slice(0, 12)
  return result
}
export function defaultProductFaqs(isCase: boolean) {
  return [
    isCase
      ? { question: "How do I choose the right fit?", answer: "Select your exact device model and case type before adding to your bag. The images and price update to match your selection." }
      : { question: "How do I choose an option?", answer: "Choose your preferred option on this page before adding to your bag. Check your selection in the bag before checkout." },
    { question: "Can I pay when my order arrives?", answer: "Yes. Cash on Delivery is available. Your order summary shows the amount to pay the courier." },
    { question: "Where can I check delivery charges?", answer: "Enter your delivery address at checkout to see the delivery charge and final total before placing your order." },
    { question: "How can I get help with this product?", answer: "Visit Contact us with the product name and your question. If you have already ordered, include your order number so we can help." },
  ]
}

