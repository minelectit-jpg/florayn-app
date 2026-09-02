import HomeSectionRenderer from "@/components/home-sections"
import { getSiteContent } from "@/lib/content"
import { listProducts, type StoreProduct } from "@/lib/medusa"

/**
 * The home page is assembled from the sections stored in the content module,
 * in their stored order, so it is reordered and edited from the admin rather
 * than here.
 */
export default async function HomePage() {
  const content = await getSiteContent()

  const carousel = content.sections.find((s) => s.type === "product_carousel")
  const limit = Number(carousel?.config?.limit) || 5

  let products: StoreProduct[] = []
  if (carousel) {
    const { products: pool } = await listProducts({ limit: 48 })
    // One card per design, so a row of five is five artworks rather than the
    // same artwork in five constructions.
    const seen = new Set<string>()
    products = pool
      .filter((product) => {
        const design =
          (product.metadata?.design_slug as string) ?? product.handle
        if (seen.has(design)) return false
        seen.add(design)
        return true
      })
      .slice(0, limit)
  }

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
    <div>
      {content.sections.map((section) => (
        <HomeSectionRenderer
          key={section.key}
          section={section}
          products={products}
        />
      ))}
    </div>
  )
}
