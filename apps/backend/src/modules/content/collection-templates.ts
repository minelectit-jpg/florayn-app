/**
 * The look of a collection landing page: a hero layout plus a colour theme,
 * both stored per page (`collection_page.template` / `.theme`) and edited in
 * the admin. The presets below are only starting points - "New page" and
 * "Apply template" copy one into the page, after which every value is the
 * page's own.
 *
 * The storefront turns the theme into CSS variables on the page wrapper. The
 * product card reads the card-* variables with its usual values as fallbacks,
 * so the card component itself never changes - only how it is dressed.
 */

export const HERO_LAYOUTS = ["overlay", "split", "image", "centered"] as const
export type HeroLayout = (typeof HERO_LAYOUTS)[number]

export const HEADING_SIZES = ["md", "lg", "xl"] as const
export type HeadingSize = (typeof HEADING_SIZES)[number]

export type CollectionTheme = {
  /** Page ground behind everything below the header. */
  bg: string
  text: string
  muted: string
  line: string
  /** Buttons and highlights. */
  accent: string
  accent_text: string
  /** The hero's own panel (split / image layouts) and its text. */
  hero_bg: string
  hero_text: string
  card_bg: string
  card_border: string
  card_text: string
  card_muted: string
  /** Card corner radius in px. */
  card_radius: number
  heading_size: HeadingSize
  /** Small images scattered over the hero (Bug Life's bugs). */
  decor: string[]
}

export type CollectionBlock =
  | {
      type: "banner"
      eyebrow: string | null
      heading: string | null
      copy: string | null
      image: string | null
      mobile_image: string | null
      cta_label: string | null
      cta_href: string | null
    }
  | { type: "text"; heading: string | null; copy: string | null }

export const DEFAULT_THEME: CollectionTheme = {
  bg: "#ffffff",
  text: "#1a1625",
  muted: "#6b6577",
  line: "#e8e4de",
  accent: "#7c3aed",
  accent_text: "#ffffff",
  hero_bg: "#1a1625",
  hero_text: "#ffffff",
  card_bg: "#ffffff",
  card_border: "#e9e6ef",
  card_text: "#1a1625",
  card_muted: "#6b6478",
  card_radius: 10,
  heading_size: "md",
  decor: [],
}

export type TemplatePreset = {
  id: string
  name: string
  description: string
  template: HeroLayout
  theme: CollectionTheme
}

const preset = (
  id: string,
  name: string,
  description: string,
  template: HeroLayout,
  theme: Partial<CollectionTheme>
): TemplatePreset => ({ id, name, description, template, theme: { ...DEFAULT_THEME, ...theme } })

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  preset("classic", "Classic", "White page, photo hero with the copy over it.", "overlay", {}),
  preset("cream", "Cream", "florayn.com's collection look: warm cream ground, lavender buttons.", "overlay", {
    bg: "#f7f6f2", text: "#111111", muted: "#5f5a52", line: "#e6e1d6",
    accent: "#b57edc", hero_bg: "#111111", card_border: "transparent",
  }),
  preset("midnight", "Midnight", "Deep navy with gold - a split hero for painterly art.", "split", {
    bg: "#0b1033", text: "#f4ebd0", muted: "#b9b4a0", line: "#26305e",
    accent: "#f2c744", accent_text: "#04092e", hero_bg: "#04092e", hero_text: "#ffffff",
    card_border: "transparent", card_radius: 14, heading_size: "xl",
  }),
  preset("forest", "Forest", "Moss green on parchment - a split hero with room for decor.", "split", {
    bg: "#efebdd", text: "#1e3b2f", muted: "#52665a", line: "#d8d1bb",
    accent: "#2f5a46", accent_text: "#f3efe2", hero_bg: "#1e3b2f", hero_text: "#e8e4d9",
    card_border: "#e0d9c3", card_radius: 14, heading_size: "xl",
  }),
  preset("lilac", "Lilac", "Soft lilac ground for pastel and marble designs.", "overlay", {
    bg: "#f8f2fb", text: "#2a1b3d", muted: "#6f6280", line: "#eadff2",
    accent: "#9b5de5", hero_bg: "#2a1b3d", card_border: "#efe3f7", card_radius: 16,
    heading_size: "lg",
  }),
  preset("blossom", "Blossom", "Petal pink with a bold rose accent.", "overlay", {
    bg: "#fff5f4", text: "#3a1a22", muted: "#7f5f66", line: "#f5dcd9",
    accent: "#d8436b", hero_bg: "#3a1a22", card_border: "#f6e1de", card_radius: 14,
    heading_size: "lg",
  }),
  preset("sand", "Sand", "Warm sand and caramel, a big centred headline.", "centered", {
    bg: "#f5eee4", text: "#2b2118", muted: "#7a6a58", line: "#e5d9c8",
    accent: "#a0703f", hero_bg: "#2b2118", hero_text: "#f5eee4",
    card_border: "#eadfcf", card_radius: 12, heading_size: "xl",
  }),
  preset("noir", "Noir", "Near-black page with champagne gold - bold and graphic.", "overlay", {
    bg: "#0f0f10", text: "#f4f1ea", muted: "#a9a39a", line: "#2a2a2c",
    accent: "#d4b27a", accent_text: "#111111", hero_bg: "#0f0f10", hero_text: "#f4f1ea",
    card_border: "transparent", card_radius: 12, heading_size: "lg",
  }),
]

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function colour(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const v = value.trim()
  return v === "transparent" || HEX.test(v) ? v.toLowerCase() : fallback
}

function text(value: unknown, max = 600): string | null {
  if (typeof value !== "string") return null
  const v = value.trim().slice(0, max)
  return v || null
}

/** Only http(s) URLs and site-relative paths - never javascript: or data:. */
export function safeUrl(value: unknown): string | null {
  const v = text(value, 2000)
  if (!v) return null
  if (v.startsWith("/") && !v.startsWith("//")) return v
  return /^https?:\/\//i.test(v) ? v : null
}

export function normaliseTemplate(value: unknown): HeroLayout {
  return HERO_LAYOUTS.includes(value as HeroLayout) ? (value as HeroLayout) : "overlay"
}

/** A complete, valid theme from whatever the admin (or an old row) sent. */
export function normaliseTheme(input: unknown): CollectionTheme {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const d = DEFAULT_THEME
  const radius = Number(raw.card_radius)
  return {
    bg: colour(raw.bg, d.bg),
    text: colour(raw.text, d.text),
    muted: colour(raw.muted, d.muted),
    line: colour(raw.line, d.line),
    accent: colour(raw.accent, d.accent),
    accent_text: colour(raw.accent_text, d.accent_text),
    hero_bg: colour(raw.hero_bg, d.hero_bg),
    hero_text: colour(raw.hero_text, d.hero_text),
    card_bg: colour(raw.card_bg, d.card_bg),
    card_border: colour(raw.card_border, d.card_border),
    card_text: colour(raw.card_text, d.card_text),
    card_muted: colour(raw.card_muted, d.card_muted),
    card_radius: Number.isFinite(radius) ? Math.min(32, Math.max(0, Math.round(radius))) : d.card_radius,
    heading_size: HEADING_SIZES.includes(raw.heading_size as HeadingSize)
      ? (raw.heading_size as HeadingSize)
      : d.heading_size,
    decor: Array.isArray(raw.decor)
      ? raw.decor.map(safeUrl).filter((u): u is string => Boolean(u)).slice(0, 12)
      : [],
  }
}

/** Ordered blocks below the product grid; unknown shapes are dropped. */
export function normaliseBlocks(input: unknown): CollectionBlock[] {
  if (!Array.isArray(input)) return []
  const blocks: CollectionBlock[] = []
  for (const item of input.slice(0, 12)) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    if (raw.type === "banner") {
      blocks.push({
        type: "banner",
        eyebrow: text(raw.eyebrow, 120),
        heading: text(raw.heading, 200),
        copy: text(raw.copy),
        image: safeUrl(raw.image),
        mobile_image: safeUrl(raw.mobile_image),
        cta_label: text(raw.cta_label, 80),
        cta_href: safeUrl(raw.cta_href),
      })
    } else if (raw.type === "text") {
      blocks.push({ type: "text", heading: text(raw.heading, 200), copy: text(raw.copy, 2000) })
    }
  }
  return blocks
}

export function presetById(id: unknown): TemplatePreset | undefined {
  return TEMPLATE_PRESETS.find((p) => p.id === id)
}
