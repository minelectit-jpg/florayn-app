import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ProductCard from "@/components/product-card"
import { listProducts, sdk } from "@/lib/medusa"

type Params = { params: Promise<{ slug: string }> }

/**
 * /collection/<slug>/ serves two kinds of grouping:
 *
 *   - a Medusa collection, used for themes (Abstract, Floral, ...)
 *   - a Medusa category, used for the structural taxonomy (case types and
 *     device families), which a product can belong to more than one of
 *
 * Collections are checked first so a curated collection can shadow a category
 * of the same handle.
 */
async function resolveCollection(slug: string) {
  try {
    const { collections } = await sdk.store.collection.list({
      handle: slug,
      limit: 1,
    })
    if (collections?.length) {
      return {
        kind: "collection" as const,
        id: collections[0].id,
        title: collections[0].title,
        description: null as string | null,
      }
    }
  } catch {
    // Fall through to categories.
  }

  try {
    const { product_categories } = await sdk.store.category.list({
      handle: slug,
      limit: 1,
    })
    if (product_categories?.length) {
      const category = product_categories[0]
      return {
        kind: "category" as const,
        id: category.id,
        title: category.name,
        description: category.description ?? null,
      }
    }
  } catch {
    // Nothing matched.
  }

  return null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const group = await resolveCollection(slug)

  if (!group) {
    return { title: "Not found" }
  }

  return {
    title: group.title,
    description: group.description ?? undefined,
    alternates: { canonical: `/collection/${slug}/` },
  }
}

export default async function CollectionPage({ params }: Params) {
  const { slug } = await params
  const group = await resolveCollection(slug)

  if (!group) {
    notFound()
  }

  const { products, count } = await listProducts(
    group.kind === "collection"
      ? { collection_id: group.id, limit: 48 }
      : { category_id: group.id, limit: 48 }
  )

  return (
    <div className="space-y-8">
      <header className="space-y-2 border-b border-[var(--color-line)] pb-6">
        <h1 className="display text-4xl">{group.title}</h1>
        {group.description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {group.description}
          </p>
        ) : null}
        <p className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
          {count} {count === 1 ? "product" : "products"}
        </p>
      </header>

      {products.length ? (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-ink-soft)]">
          Nothing published here yet.
        </p>
      )}
    </div>
  )
}
