import type { Audience } from "./audience"
import { DEFAULT_RECOMMENDATIONS, type RecommendationSettings } from "./product-recommendations"
import { DEFAULT_PRESENTATION, readPresentation, type DeliveryPresentation, type FooterPresentation } from "./storefront-presentation"
/**
 * Home page sections, the header menu and the footer, all edited in the admin
 * rather than hardcoded here.
 */

const BACKEND =
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

export type MenuLink = {
  id: string
  label: string
  href: string
  badge: string | null
}

export type MenuGroup = { heading: string | null; links: MenuLink[] }

export type MenuSection = {
  id: string
  label: string
  href: string | null
  groups: MenuGroup[]
}

export type HomeSection = {
  key: string
  type: string
  title: string | null
  subtitle: string | null
  eyebrow: string | null
  cta_label: string | null
  cta_href: string | null
  config: Record<string, any>
}

/** A visible collection landing page, as a card on the home page and index. */
export type CollectionCard = {
  slug: string
  collection_id: string | null
  title: string
  /** Campaign picture, shown cropped to the card. */
  image: string | null
  /** A product render on white, shown contained when there is no picture. */
  artwork: string | null
  theme: Pick<CollectionTheme, "bg" | "text" | "accent" | "accent_text" | "hero_bg" | "hero_text">
  /** The modes this collection has products for. Absent (an older backend) means both. */
  audiences?: Audience[]
}

/** The collection cards that have something to show in this mode. */
export function collectionsFor(cards: CollectionCard[], audience: Audience): CollectionCard[] {
  return cards.filter((card) => !card.audiences || card.audiences.includes(audience))
}

export type SiteContent = {
  /** The home page of the mode that was asked for. */
  sections: HomeSection[]
  /** The header navigation of the mode that was asked for. */
  primary: MenuSection[]
  /** The Men navigation, always sent so the one header can switch without a refetch. */
  primaryMen?: MenuSection[]
  footer: MenuSection[]
  footerNote: string
  footerAppearance?: FooterPresentation
  social: { label: string; href: string }[]
  collections: CollectionCard[]
}

/** Enough of a shell to render if the backend is unreachable. */
const EMPTY: SiteContent = {
  sections: [],
  primary: [],
  footer: [],
  footerNote: "",
  social: [],
  collections: [],
}

/** Home sections, menus and footer for one mode (Women unless asked). */
export async function getSiteContent(audience: Audience = "women"): Promise<SiteContent> {
  try {
    const res = await fetch(`${BACKEND}/store/content${audience === "men" ? "?audience=men" : ""}`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60, tags: ["content", "content:site"] },
    })
    if (!res.ok) return EMPTY
    const data = (await res.json()) as Partial<SiteContent>
    // An older backend has no collection cards; keep the shape complete.
    return { ...EMPTY, ...data, collections: data.collections ?? [] }
  } catch {
    return EMPTY
  }
}

export type CaseTypeInfo = {
  slug: string
  name: string
  description: string
  price: number | null
  /** Admin-set photo for the "Shop by style" menu card; null falls back to a default. */
  image: string | null
}

/** The case constructions (Signature, Elite Clear, Armor, Alcantara, …) with
 * their copy and starting price, for the "Shop by style" menu. */
export async function getCaseTypes(): Promise<CaseTypeInfo[]> {
  try {
    const res = await fetch(`${BACKEND}/store/case-types`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 300, tags: ["catalog", "catalog:case-types"] },
    })
    if (!res.ok) return []
    const json = (await res.json()) as {
      case_types?: any[]
      data?: any[]
    }
    const arr = json.case_types ?? json.data ?? []
    return arr
      .filter((c) => c.is_active)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? "",
        price: typeof c.price === "number" ? c.price : null,
        image: c.image_url ?? null,
      }))
  } catch {
    return []
  }
}

export type FeatureBlock = {
  id: string
  /** The case type this block is for; null shows for any (default). */
  case_type: string | null
  title: string | null
  description: string | null
  image_url: string | null
  video_url: string | null
}

export type ProductSections = {
  delivery: DeliveryPresentation
  recommendationDefaults: RecommendationSettings
  /** The "Features" band blocks, in order. */
  featureBlocks: FeatureBlock[]
  /** Hand-picked design handles for "We think you'll love". */
  featuredPicks: string[]
}

/**
 * The admin-managed bands shown below the gallery on every product page: the
 * "Features" blocks and the "We think you'll love" picks. Empty on any error,
 * so the product page still renders.
 */
export async function getProductSections(): Promise<ProductSections> {
  try {
    const res = await fetch(`${BACKEND}/store/content/product-sections`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60, tags: ["content", "content:product-sections"] },
    })
    if (!res.ok) return { delivery: DEFAULT_PRESENTATION.delivery, featureBlocks: [], featuredPicks: [], recommendationDefaults: DEFAULT_RECOMMENDATIONS }
    const json = (await res.json()) as Partial<ProductSections>
    return {
      delivery: readPresentation({ delivery: json.delivery }).delivery,
      recommendationDefaults: { ...DEFAULT_RECOMMENDATIONS, ...json.recommendationDefaults },
      featureBlocks: json.featureBlocks ?? [],
      featuredPicks: json.featuredPicks ?? [],
    }
  } catch {
    return { delivery: DEFAULT_PRESENTATION.delivery, featureBlocks: [], featuredPicks: [], recommendationDefaults: DEFAULT_RECOMMENDATIONS }
  }
}

export type GalleryVideoMap = Record<
  string,
  { video_url: string; poster_url: string | null; position: number }
>

/**
 * The gallery videos for one design, keyed by case-type name. The product page
 * shows the entry for the live case type. Empty on any error.
 */
export async function getGalleryVideos(
  designSlug: string
): Promise<GalleryVideoMap> {
  if (!designSlug) return {}
  try {
    const res = await fetch(
      `${BACKEND}/store/content/gallery-videos?design=${encodeURIComponent(
        designSlug
      )}`,
      {
        headers: { "x-publishable-api-key": KEY },
        next: { revalidate: 60, tags: ["content", "content:gallery-videos", `product:${designSlug}`] },
      }
    )
    if (!res.ok) return {}
    const json = (await res.json()) as { videos?: GalleryVideoMap }
    return json.videos ?? {}
  } catch {
    return {}
  }
}

export type HeroLayout = "overlay" | "split" | "image" | "centered"

/** A collection page's colours; mirrors the backend's collection-templates. */
export type CollectionTheme = {
  bg: string
  text: string
  muted: string
  line: string
  accent: string
  accent_text: string
  hero_bg: string
  hero_text: string
  card_bg: string
  card_border: string
  card_text: string
  card_muted: string
  card_radius: number
  heading_size: "md" | "lg" | "xl"
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

/** The store's own look, used when a page has no theme (or an old backend). */
export const DEFAULT_COLLECTION_THEME: CollectionTheme = {
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

export type CollectionPage = {
  collection_slug: string
  title: string | null
  template: HeroLayout
  theme: CollectionTheme
  hero_image_url: string | null
  hero_mobile_image_url: string | null
  hero_eyebrow: string | null
  hero_heading: string | null
  hero_copy: string | null
  cta_label: string | null
  cta_href: string | null
  intro_heading: string | null
  intro_copy: string | null
  /** Ordered design slugs. Empty means every design, in catalogue order. */
  design_slugs: string[]
  /** Banners and text below the product grid, in order. */
  blocks: CollectionBlock[]
}

/** The landing content for one collection, or null when there is none. */
export async function getCollectionPage(
  slug: string
): Promise<CollectionPage | null> {
  try {
    const res = await fetch(`${BACKEND}/store/collection-pages/${slug}`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60, tags: ["content", `content:collection:${slug}`] },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { page: Partial<CollectionPage> | null }
    if (!data.page) return null
    const page = data.page
    // Fill anything an older backend does not send yet.
    return {
      collection_slug: page.collection_slug ?? slug,
      title: page.title ?? null,
      template: page.template ?? "overlay",
      theme: { ...DEFAULT_COLLECTION_THEME, ...page.theme },
      hero_image_url: page.hero_image_url ?? null,
      hero_mobile_image_url: page.hero_mobile_image_url ?? null,
      hero_eyebrow: page.hero_eyebrow ?? null,
      hero_heading: page.hero_heading ?? null,
      hero_copy: page.hero_copy ?? null,
      cta_label: page.cta_label ?? null,
      cta_href: page.cta_href ?? null,
      intro_heading: page.intro_heading ?? null,
      intro_copy: page.intro_copy ?? null,
      design_slugs: page.design_slugs ?? [],
      blocks: page.blocks ?? [],
    }
  } catch {
    return null
  }
}
