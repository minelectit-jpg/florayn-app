import { safeUrl } from "./collection-templates"
import { HOME_SECTION_TYPES } from "./defaults"

/**
 * Cleans a home section's `config` before it is stored: known fields only,
 * bounded lists, and links/images limited to http(s) URLs or site paths. The
 * storefront renders whatever is saved here, so this is the one gate.
 */

type Json = Record<string, unknown>

const str = (value: unknown, max = 300): string | null => {
  if (typeof value !== "string") return null
  const v = value.trim().slice(0, max)
  return v || null
}

const list = (value: unknown, max: number): Json[] =>
  Array.isArray(value)
    ? value.filter((v): v is Json => Boolean(v) && typeof v === "object").slice(0, max)
    : []

export function isHomeSectionType(type: unknown): type is (typeof HOME_SECTION_TYPES)[number] {
  return HOME_SECTION_TYPES.includes(type as (typeof HOME_SECTION_TYPES)[number])
}

export function normaliseHomeConfig(type: string, input: unknown): Json {
  const raw = (input && typeof input === "object" ? input : {}) as Json
  switch (type) {
    case "category_pills":
      return {
        items: list(raw.items, 16).map((item) => ({
          label: str(item.label, 60) ?? "",
          href: safeUrl(item.href),
          image: safeUrl(item.image),
          ...(str(item.note, 40) ? { note: str(item.note, 40) } : {}),
        })),
      }
    case "hero":
      return {
        slides: list(raw.slides, 8).map((s) => ({
          eyebrow: str(s.eyebrow, 80),
          heading: str(s.heading, 160),
          href: safeUrl(s.href) ?? "/",
          cta_label: str(s.cta_label, 40),
          image: safeUrl(s.image),
          mobile_image: safeUrl(s.mobile_image),
        })),
      }
    case "marquee":
      return {
        items: (Array.isArray(raw.items) ? raw.items : [])
          .map((v) => str(v, 80))
          .filter((v): v is string => Boolean(v))
          .slice(0, 8),
      }
    case "tile_grid": {
      const columns = Number(raw.columns)
      return {
        columns: [2, 3, 4].includes(columns) ? columns : 2,
        tiles: list(raw.tiles, 12).map((t) => ({
          label: str(t.label, 60) ?? "",
          subtitle: str(t.subtitle, 80),
          href: safeUrl(t.href) ?? "/",
          image: safeUrl(t.image),
        })),
      }
    }
    case "product_carousel": {
      const limit = Number(raw.limit)
      return {
        limit: Number.isFinite(limit) ? Math.min(12, Math.max(2, Math.round(limit))) : 5,
        collection: str(raw.collection, 120),
      }
    }
    case "collection_grid": {
      const limit = Number(raw.limit)
      return {
        slugs: (Array.isArray(raw.slugs) ? raw.slugs : [])
          .map((v) => str(v, 120))
          .filter((v): v is string => Boolean(v))
          .slice(0, 24),
        limit: Number.isFinite(limit) ? Math.min(24, Math.max(1, Math.round(limit))) : 12,
      }
    }
    case "banner":
      return { image: safeUrl(raw.image), mobile_image: safeUrl(raw.mobile_image) }
    case "testimonials":
      return {
        quotes: list(raw.quotes, 12).map((q) => {
          const rating = Number(q.rating)
          return {
            name: str(q.name, 80) ?? "",
            badge: str(q.badge, 40),
            body: str(q.body, 1200) ?? "",
            rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : 5,
          }
        }),
      }
    default:
      return {}
  }
}

/** A fresh, empty-but-valid section of a type, for "Add section". */
export function blankHomeSection(type: string) {
  const titles: Record<string, string> = {
    category_pills: "Shop by category",
    hero: "Hero",
    marquee: "Announcement strip",
    tile_grid: "Category tiles",
    product_carousel: "New Releases",
    collection_grid: "Shop by Collection",
    banner: "Banner",
    testimonials: "Customer Say!",
  }
  const configs: Record<string, Json> = {
    category_pills: { items: [] },
    hero: { slides: [] },
    marquee: { items: ["1–3 Days Delivery"] },
    tile_grid: { columns: 2, tiles: [] },
    product_carousel: { limit: 5, collection: null },
    collection_grid: { slugs: [], limit: 12 },
    banner: { image: null, mobile_image: null },
    testimonials: { quotes: [] },
  }
  return { title: titles[type] ?? null, config: configs[type] ?? {} }
}
