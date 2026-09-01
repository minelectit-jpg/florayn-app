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
  const designName = (product.metadata?.design_name as string) ?? product.title

  const [families, designData] = await Promise.all([
    getDeviceFamilyMap(),
    designSlug ? getDesign(designSlug) : Promise.resolve(null),
  ])

  const siblings = (designData?.products ?? []).filter(
    (p) => p.handle !== product.handle
  )
  const images = product.images ?? []

  return (
    <article className="space-y-20">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="space-y-3">
          {images.length ? (
            <div className="relative aspect-square overflow-hidden border border-line bg-surface">
              <ProductImage
                src={images[0].url}
                alt={product.title}
                label={designName}
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
                  className="relative aspect-square overflow-hidden border border-line bg-surface"
                >
                  <ProductImage
                    src={image.url}
                    alt=""
                    label={designName}
                    sizes="16vw"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-8">
          <header className="space-y-3">
            {product.collection ? (
              <Link
                href={`/collection/${product.collection.handle}/`}
                className="eyebrow transition-colors hover:text-purple"
              >
                {product.collection.title}
              </Link>
            ) : null}
            <h1 className="display text-[2.5rem] leading-[1.06] md:text-[3rem]">
              {designName}
            </h1>
            <p className="text-sm text-ink-muted">
              {product.subtitle}
              {product.metadata?.artist
                ? ` - artwork by ${product.metadata.artist as string}`
                : ""}
            </p>
          </header>

          <DevicePicker
            variants={product.variants ?? []}
            families={families}
            productTitle={product.title}
            thumbnail={product.thumbnail ?? images[0]?.url ?? null}
          />

          {product.description ? (
            <div className="space-y-3 border-t border-line pt-7 text-sm leading-relaxed text-ink-muted">
              {product.description.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {siblings.length ? (
        <section className="space-y-6 border-t border-line pt-14">
          <header className="space-y-2">
            <p className="eyebrow">Same artwork</p>
            <h2 className="display text-2xl md:text-3xl">
              {designData?.design.name} in other finishes
            </h2>
          </header>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {siblings.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/product/${sibling.handle}/`}
                className="group block border border-line bg-surface transition-colors hover:border-ink"
              >
                <div className="relative aspect-square overflow-hidden bg-paper">
                  <ProductImage
                    src={sibling.thumbnail}
                    alt={sibling.title}
                    label={sibling.case_type_name ?? sibling.title}
                    sizes="20vw"
                    className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
                  />
                </div>
                <p className="eyebrow border-t border-line px-3 py-3 text-center">
                  {sibling.case_type_name}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {caseTypeSlug ? (
        <p className="text-sm">
          <Link
            href={`/collection/${caseTypeSlug}/`}
            className="text-ink-muted underline underline-offset-4 transition-colors hover:text-purple"
          >
            See every design in {product.metadata?.case_type_name as string}
          </Link>
        </p>
      ) : null}
    </article>
  )
}
