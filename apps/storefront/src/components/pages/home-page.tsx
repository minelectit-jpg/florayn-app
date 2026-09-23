import HomeSectionRenderer from "@/components/home-sections"
import { forAudience, type Audience } from "@/lib/audience"
import { collectionsFor, getSiteContent, type HomeSection, type SiteContent } from "@/lib/content"
import { CARD_FIELDS, listProducts, type StoreProduct } from "@/lib/medusa"

/** More carousels than this on one page is a mistake, not a layout. */
const MAX_CAROUSELS = 4

/**
 * One carousel's cards: the newest published designs (or a chosen
 * collection's) for this mode, one card per design, priced only once the final
 * few are picked.
 */
async function carouselProducts(
  section: HomeSection,
  content: SiteContent,
  audience: Audience
): Promise<StoreProduct[]> {
  const limit = Number(section.config?.limit) || 5
  const handle = typeof section.config?.collection === "string" ? section.config.collection : ""
  const collectionId = handle
    ? (content.collections ?? []).find((c) => c.slug === handle)?.collection_id ?? null
    : null

  // Pick the designs before asking Medusa to price their variants. Most of
  // these candidates never appear in the carousel. Men designs are fewer, so
  // that mode looks further back to still fill the row.
  const { products: pool } = await listProducts({
    limit: audience === "men" ? 96 : 48,
    fields: "id,handle,metadata",
    order: "-created_at",
    ...(collectionId ? { collection_id: collectionId } : {}),
  }, { pricing: false })
  // One card per design, so a row of five is five artworks rather than the
  // same artwork in five constructions.
  const seen = new Set<string>()
  const selected = forAudience(pool, audience)
    .filter((product) => {
      // The phone case is a design's representative card; skip AirPods etc.
      if ((product.metadata?.form ?? "phone") !== "phone") return false
      const design =
        (product.metadata?.design_slug as string) ?? product.handle
      if (seen.has(design)) return false
      seen.add(design)
      return true
    })
    .slice(0, limit)

  if (!selected.length) return []
  const { products: cards } = await listProducts({
    id: selected.map((product) => product.id),
    limit: selected.length,
    fields: CARD_FIELDS,
  })
  const byId = new Map(cards.map((product) => [product.id, product]))
  return selected
    .map((product) => byId.get(product.id))
    .filter((product): product is StoreProduct => Boolean(product))
}

/**
 * The home page of one mode, assembled from the sections stored in the content
 * module in their stored order, so it is reordered and edited from the admin
 * (Home page screen, Women / Men tabs) rather than here.
 */
export default async function HomePage({ audience }: { audience: Audience }) {
  const content = await getSiteContent(audience)

  const carousels = content.sections
    .filter((s) => s.type === "product_carousel")
    .slice(0, MAX_CAROUSELS)
  const loaded = await Promise.all(carousels.map((s) => carouselProducts(s, content, audience)))
  const productsByKey = new Map(carousels.map((s, i) => [s.key, loaded[i]]))
  const collections = collectionsFor(content.collections ?? [], audience)

  if (!content.sections.length) {
    return (
      <div className="py-20 text-center">
        <h1 className="display text-3xl">Florayn</h1>
        <p className="mt-3 text-sm text-ink-muted">
          The home page has no sections yet. Add them under Home page in the
          admin.
        </p>
      </div>
    )
  }

  return (
    <div className="fl-home">
      {content.sections.map((section) => (
        <HomeSectionRenderer
          key={section.key}
          section={section}
          products={productsByKey.get(section.key) ?? []}
          collections={collections}
        />
      ))}
    </div>
  )
}
