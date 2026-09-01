import ProductCard from "@/components/product-card"
import { ButtonLink } from "@/components/ui/button"
import { listProducts } from "@/lib/medusa"

const DEVICE_LINKS = [
  { slug: "iphone-cases", label: "iPhone" },
  { slug: "samsung-cases", label: "Samsung Galaxy" },
  { slug: "airpods-cases", label: "AirPods" },
  { slug: "watch-bands", label: "Apple Watch" },
  { slug: "card-wallets", label: "Card Wallets" },
]

export default async function HomePage() {
  const { products, count } = await listProducts({ limit: 48 })

  // One card per design; the case-type collections are where the same artwork
  // is shown in every finish.
  const seen = new Set<string>()
  const featured = products.filter((product) => {
    const design = (product.metadata?.design_slug as string) ?? product.handle
    if (seen.has(design)) {
      return false
    }
    seen.add(design)
    return true
  })

  return (
    <div className="space-y-20">
      <section className="mx-auto max-w-3xl space-y-6 py-8 text-center md:py-16">
        <p className="eyebrow">Printed cases &middot; Made in Dhaka</p>
        <h1 className="display text-[2.75rem] leading-[1.05] md:text-[4rem]">
          One design.
          <br />
          Every device.
        </h1>
        <p className="mx-auto max-w-xl text-ink-muted">
          Each artwork is built in six constructions, and each construction is
          cut for every phone, AirPods case, watch band and wallet it fits.
          Choose the design first, the device second.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <ButtonLink href="/collection/signature/" size="lg">
            Shop Signature
          </ButtonLink>
          <ButtonLink
            href="/collection/alcantara/"
            variant="secondary"
            size="lg"
          >
            Explore Alcantara
          </ButtonLink>
        </div>
      </section>

      {featured.length ? (
        <section className="space-y-8">
          <header className="flex items-end justify-between gap-4 border-b border-line pb-4">
            <h2 className="display text-2xl md:text-3xl">New designs</h2>
            <span className="eyebrow">{count} products</span>
          </header>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : (
        <section className="border border-line bg-surface p-8 text-sm">
          <p className="display text-lg">No products loaded.</p>
          <p className="mt-2 text-ink-muted">
            Start the backend and seed it, then set
            <code className="mx-1 text-ink">
              NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
            </code>
            in <code className="text-ink">apps/storefront/.env.local</code>.
          </p>
        </section>
      )}

      <section className="space-y-6 border-t border-line pt-14">
        <h2 className="display text-2xl md:text-3xl">Shop by device</h2>
        <div className="flex flex-wrap gap-3">
          {DEVICE_LINKS.map((item) => (
            <ButtonLink
              key={item.slug}
              href={`/collection/${item.slug}/`}
              variant="secondary"
            >
              {item.label}
            </ButtonLink>
          ))}
        </div>
      </section>
    </div>
  )
}
