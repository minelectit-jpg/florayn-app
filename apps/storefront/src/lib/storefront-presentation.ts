export const PRESENTATION_KEY = "florayn_presentation"
export const DELIVERY_ICONS = ["truck", "wallet", "map-pin", "refresh", "package", "heart", "shield", "phone"] as const
export type DeliveryCard = { icon: typeof DELIVERY_ICONS[number]; title: string; description: string }
/** `estimate` is the line after "In stock" at the top of every product page. */
export type DeliveryPresentation = { enabled: boolean; heading: string; cards: DeliveryCard[]; link_label: string; link_href: string; estimate: string }
export type FooterPresentation = { brand: string; tagline: string; support_title: string; support_text: string; support_label: string; support_href: string; note: string; location: string; social: { label: string; href: string }[] }
/** Admin > Buy buttons: the product page's Add to cart / Buy it now, the quick-buy bar on phones and the sold-out slot. */
export type BuyBoxPresentation = {
  add_to_cart_label: string
  buy_now_label: string
  /** Outline keeps Buy it now the one filled button; filled is the florayn.com look. */
  add_to_cart_style: "outline" | "filled"
  show_price_in_buy_now: boolean
  sticky_bar: boolean
  sticky_bar_action: "buy_now" | "add_to_cart"
  sold_out_suggestions: boolean
  /** Before the in-stock case types; blank shows the suggestions alone. */
  sold_out_label: string
  sold_out_other_model_label: string
}
export type Presentation = { footer: FooterPresentation; delivery: DeliveryPresentation; buy_box: BuyBoxPresentation }
export const DEFAULT_PRESENTATION: Presentation = {
  footer: {
    brand: "FLORAYN", tagline: "Made to match your everyday.",
    support_title: "A little help? We're here.", support_text: "Find your fit, ask about an order, or get help with an exchange.",
    support_label: "Talk to us", support_href: "/contact/",
    note: "© {year} Florayn Store. All rights reserved.", location: "Bangladesh · BDT ৳",
    social: [
      { label: "Facebook", href: "https://www.facebook.com/FloraynFashion" },
      { label: "Instagram", href: "https://www.instagram.com/floraynfashion" },
      { label: "YouTube", href: "https://www.youtube.com/channel/UCTBJRe-E6ePw4sinG7HFAEQ" },
    ],
  },
  delivery: {
    enabled: true, heading: "Delivery & care",
    cards: [
      { icon: "truck", title: "Delivery in 1–3 days", description: "Delivered across Bangladesh." },
      { icon: "wallet", title: "Cash on delivery", description: "Pay when your parcel arrives." },
      { icon: "map-pin", title: "Delivery charges", description: "60৳ inside Dhaka · 100৳ outside." },
      { icon: "refresh", title: "Easy exchanges", description: "Within 3 days of delivery." },
    ],
    link_label: "Delivery & exchange help", link_href: "/contact/",
    estimate: "Delivery in 1–3 business days",
  },
  buy_box: {
    add_to_cart_label: "Add to cart",
    buy_now_label: "Buy it now",
    add_to_cart_style: "outline",
    show_price_in_buy_now: true,
    sticky_bar: true,
    sticky_bar_action: "buy_now",
    sold_out_suggestions: true,
    sold_out_label: "Available in",
    sold_out_other_model_label: "Choose another model",
  },
}

/** Allow ordinary navigation, never executable or protocol-relative URLs. */
export function safePresentationHref(value: string) {
  if (!value || /[\s\u0000-\u001f\\]/.test(value)) return false
  if (value.startsWith("/") && !value.startsWith("//")) return true
  if (/^mailto:[^@?]+@[^@?]+(?:\?[^\s]*)?$/.test(value) || /^tel:\+?[\d()-]+$/.test(value)) return true
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password } catch { return false }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide valid settings.")
  return value as Record<string, unknown>
}
function text(value: unknown, name: string, max: number, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`${name} must be ${required ? "non-empty text" : "text"} up to ${max} characters.`)
  return value.trim()
}
function link(label: string, href: string) {
  if (!!label !== !!href || (href && !safePresentationHref(href))) throw new Error("Provide both a link label and a safe website, email or phone link, or leave both blank.")
}
export function validateFooterPresentation(value: unknown): FooterPresentation {
  const v = object(value)
  const result = {
    brand: text(v.brand, "Brand", 40, true), tagline: text(v.tagline, "Tagline", 180),
    support_title: text(v.support_title, "Support heading", 80), support_text: text(v.support_text, "Support text", 240),
    support_label: text(v.support_label, "Support link label", 60), support_href: text(v.support_href, "Support link", 500),
    note: text(v.note, "Copyright note", 200), location: text(v.location, "Location note", 80), social: [] as FooterPresentation["social"],
  }
  link(result.support_label, result.support_href)
  if (!Array.isArray(v.social) || v.social.length > 8) throw new Error("Use up to 8 social links.")
  result.social = v.social.map((row) => { const r = object(row); const label = text(r.label, "Social label", 40, true); const href = text(r.href, "Social link", 500, true); link(label, href); return { label, href } })
  return result
}
const ONE_LINE = /[\u0000-\u001f\u007f]/
export function validateDeliveryPresentation(value: unknown): DeliveryPresentation {
  const v = object(value)
  if (typeof v.enabled !== "boolean") throw new Error("Choose whether to show delivery information.")
  if (!Array.isArray(v.cards) || v.cards.length > 6) throw new Error("Use up to 6 information cards.")
  const result = { enabled: v.enabled, heading: text(v.heading, "Heading", 80), link_label: text(v.link_label, "Help link label", 60), link_href: text(v.link_href, "Help link", 500), cards: v.cards.map((row) => {
    const r = object(row)
    if (!DELIVERY_ICONS.includes(r.icon as DeliveryCard["icon"])) throw new Error("Choose an available icon.")
    return { icon: r.icon as DeliveryCard["icon"], title: text(r.title, "Card heading", 80, true), description: text(r.description, "Card description", 240) }
  }), estimate: v.estimate === undefined ? DEFAULT_PRESENTATION.delivery.estimate : text(v.estimate, "Stock line estimate", 60) }
  if (ONE_LINE.test(result.estimate)) throw new Error("Keep the stock line estimate on one line.")
  link(result.link_label, result.link_href)
  return result
}
function flag(value: unknown, what: string) {
  if (typeof value !== "boolean") throw new Error(`Choose whether to ${what}.`)
  return value
}
function oneLine(value: unknown, name: string, max: number, required = false) {
  const result = text(value, name, max, required)
  if (ONE_LINE.test(result)) throw new Error("Keep button text on one line.")
  return result
}
export function validateBuyBoxPresentation(value: unknown): BuyBoxPresentation {
  const v = object(value)
  if (v.add_to_cart_style !== "outline" && v.add_to_cart_style !== "filled") throw new Error("Choose Outline or Filled ink for Add to cart.")
  if (v.sticky_bar_action !== "buy_now" && v.sticky_bar_action !== "add_to_cart") throw new Error("Choose which button the quick-buy bar shows.")
  const result: BuyBoxPresentation = {
    add_to_cart_label: oneLine(v.add_to_cart_label, "Add to cart label", 16, true),
    buy_now_label: oneLine(v.buy_now_label, "Buy it now label", 20, true),
    add_to_cart_style: v.add_to_cart_style,
    show_price_in_buy_now: flag(v.show_price_in_buy_now, "show the price in Buy it now"),
    sticky_bar: flag(v.sticky_bar, "show the quick-buy bar"),
    sticky_bar_action: v.sticky_bar_action,
    sold_out_suggestions: flag(v.sold_out_suggestions, "suggest case types that are in stock"),
    sold_out_label: oneLine(v.sold_out_label, "Label before the suggestions", 24),
    sold_out_other_model_label: oneLine(v.sold_out_other_model_label, "Button when no case type is in stock", 24, true),
  }
  return result
}
/** Missing old settings use defaults; deliberate blank text and empty lists remain blank. */
export function readPresentation(value: unknown): Presentation {
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Presentation> : {}
  let footer = DEFAULT_PRESENTATION.footer
  let delivery = DEFAULT_PRESENTATION.delivery
  let buy_box = DEFAULT_PRESENTATION.buy_box
  try { footer = validateFooterPresentation({ ...footer, ...saved.footer }) } catch { /* Safe legacy fallback. */ }
  try { delivery = validateDeliveryPresentation({ ...delivery, ...saved.delivery }) } catch { /* Safe legacy fallback. */ }
  try { buy_box = validateBuyBoxPresentation({ ...buy_box, ...saved.buy_box }) } catch { /* Safe legacy fallback. */ }
  return { footer, delivery, buy_box }
}
