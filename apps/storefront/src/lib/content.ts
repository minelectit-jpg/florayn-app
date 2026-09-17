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

export type SiteContent = {
  sections: HomeSection[]
  primary: MenuSection[]
  footer: MenuSection[]
  footerNote: string
  social: { label: string; href: string }[]
}

/** Enough of a shell to render if the backend is unreachable. */
const EMPTY: SiteContent = {
  sections: [],
  primary: [],
  footer: [],
  footerNote: "",
  social: [],
}

export async function getSiteContent(): Promise<SiteContent> {
  try {
    const res = await fetch(`${BACKEND}/store/content`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60 },
    })
    if (!res.ok) return EMPTY
    return (await res.json()) as SiteContent
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
      next: { revalidate: 300 },
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
      next: { revalidate: 60 },
    })
    if (!res.ok) return { featureBlocks: [], featuredPicks: [] }
    const json = (await res.json()) as Partial<ProductSections>
    return {
      featureBlocks: json.featureBlocks ?? [],
      featuredPicks: json.featuredPicks ?? [],
    }
  } catch {
    return { featureBlocks: [], featuredPicks: [] }
  }
}

export type GalleryVideoMap = Record<
  string,
  { video_url: string; poster_url: string | null }
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
        next: { revalidate: 60 },
      }
    )
    if (!res.ok) return {}
    const json = (await res.json()) as { videos?: GalleryVideoMap }
    return json.videos ?? {}
  } catch {
    return {}
  }
}

export type CollectionPage = {
  collection_slug: string
  hero_image_url: string | null
  hero_eyebrow: string | null
  hero_heading: string | null
  cta_label: string | null
  cta_href: string | null
  intro_heading: string | null
  intro_copy: string | null
  /** Ordered design slugs. Empty means every design, in catalogue order. */
  design_slugs: string[]
}

/** The landing content for one collection, or null when there is none. */
export async function getCollectionPage(
  slug: string
): Promise<CollectionPage | null> {
  try {
    const res = await fetch(`${BACKEND}/store/collection-pages/${slug}`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { page: CollectionPage }
    return data.page ?? null
  } catch {
    return null
  }
}
