import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import DevicePicker from "@/components/device-picker"
import ProductImage from "@/components/product-image"
import { getDesign, getDeviceFamilyMap } from "@/lib/catalog"
import { getProductByHandle } from "@/lib/medusa"

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductByHandle(slug)

  if (!product) {
    return { title: "Not found" }
  }

  return {
    title: product.title,
    description: product.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/product/${product.handle}/` },
  }
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params
  const product = await getProductByHandle(slug)

  if (!product) {
    notFound()
  }

  const designSlug = product.metadata?.design_slug as string | undefined
  const caseTypeSlug = product.metadata?.case_type_slug as string | undefined

  const [families, designData] = await Promise.all([
    getDeviceFamilyMap(),
    designSlug ? getDesign(designSlug) : Promise.resolve(null),
  ])

  const siblings = (designData?.products ?? []).filter(
    (p) => p.handle !== product.handle
  )
  const images = product.images ?? []

  return (
    <article className="space-y-14">
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-3">
          {images.length ? (
            <div className="relative aspect-square overflow-hidden border border-[var(--color-line)] bg-white">
              <ProductImage
                src={images[0].url}
                alt={product.title}
                label={product.title}
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
          ) : null}

          {images.length > 1 ? (
            <div className="grid grid-cols-3 gap-3">
              {images.slice(1, 4).map((image) => (
                <div
                  key={image.id}
                  className="relative aspect-square overflow-hidden border border-[var(--color-line)] bg-white"
                >
                  <ProductImage
                    src={image.url}
                    alt=""
                    label={product.title}
                    sizes="16vw"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-7">
          <div className="space-y-2">
            {product.collection ? (
              <Link
                href={`/collection/${product.collection.handle}/`}
                className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              >
                {product.collection.title}
              </Link>
            ) : null}
            <h1 className="display text-4xl leading-tight">
              {(product.metadata?.design_name as string) ?? product.title}
            </h1>
            <p className="text-sm text-[var(--color-ink-soft)]">
              {product.subtitle}
              {product.metadata?.artist
                ? ` - artwork by ${product.metadata.artist as string}`
                : ""}
            </p>
          </div>

          <DevicePicker
            variants={product.variants ?? []}
            families={families}
            productTitle={product.title}
            thumbnail={product.thumbnail ?? images[0]?.url ?? null}
          />

          {product.description ? (
            <div className="space-y-3 border-t border-[var(--color-line)] pt-6 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {product.description.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {siblings.length ? (
        <section className="space-y-4 border-t border-[var(--color-line)] pt-10">
          <h2 className="display text-2xl">
            {designData?.design.name} in other finishes
          </h2>
          <p className="text-sm text-[var(--color-ink-soft)]">
            The same artwork, built as a different case.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {siblings.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/product/${sibling.handle}/`}
                className="group block border border-[var(--color-line)] bg-white hover:border-[var(--color-ink)]"
              >
                <div className="relative aspect-square overflow-hidden bg-[var(--color-paper)]">
                  <ProductImage
                    src={sibling.thumbnail}
                    alt={sibling.title}
                    label={sibling.case_type_name ?? sibling.title}
                    sizes="20vw"
                    className="transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <p className="p-3 text-sm">{sibling.case_type_name}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {caseTypeSlug ? (
        <p className="text-sm">
          <Link
            href={`/collection/${caseTypeSlug}/`}
            className="underline underline-offset-4"
          >
            See every design in {product.metadata?.case_type_name as string}
          </Link>
        </p>
      ) : null}
    </article>
  )
}
