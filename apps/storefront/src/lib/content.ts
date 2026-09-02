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
