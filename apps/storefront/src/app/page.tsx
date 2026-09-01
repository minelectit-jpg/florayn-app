import Link from "next/link"

import ProductCard from "@/components/product-card"
import { listProducts } from "@/lib/medusa"

export default async function HomePage() {
  const { products, count } = await listProducts({ limit: 12 })

  // One card per design is enough on the home page; the case-type collections
  // are where the same artwork is shown in every finish.
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
    <div className="space-y-14">
      <section className="max-w-2xl space-y-4">
        <h1 className="display text-5xl leading-tight">
          One design. Every device.
        </h1>
        <p className="text-[var(--color-ink-soft)]">
          Each artwork is built in six constructions, and each construction is
          cut for every phone, AirPods case, watch band and wallet it fits.
          Choose the design first, the device second.
        </p>
      </section>

      {featured.length ? (
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-3">
            <h2 className="display text-2xl">New designs</h2>
            <span className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
              {count} products
            </span>
          </div>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : (
        <section className="border border-[var(--color-line)] bg-white p-6 text-sm">
          <p className="font-medium">No products loaded.</p>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            Start the backend and seed it, then set
            <code className="mx-1">NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY</code>
            in <code>apps/storefront/.env.local</code>.
          </p>
        </section>
      )}

      <section className="space-y-4 border-t border-[var(--color-line)] pt-10">
        <h2 className="display text-2xl">Shop by device</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {[
            { slug: "iphone-cases", label: "iPhone" },
            { slug: "samsung-cases", label: "Samsung Galaxy" },
            { slug: "airpods-cases", label: "AirPods" },
            { slug: "watch-bands", label: "Apple Watch" },
            { slug: "card-wallets", label: "Card Wallets" },
          ].map((item) => (
            <Link
              key={item.slug}
              href={`/collection/${item.slug}/`}
              className="border border-[var(--color-line)] bg-white px-4 py-2 hover:border-[var(--color-ink)]"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
