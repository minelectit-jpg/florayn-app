import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Read helpers for the Design Manager admin screen. A "design" is one or more
 * Structure-B products (one per form: phone / airpods / watch / wallet) sharing
 * a `metadata.design_slug`. These functions gather a design's live shape so the
 * manager can list, inspect and (later) edit it. Read-only; no mutation here.
 */

export type DesignSummary = {
  slug: string
  name: string
  theme: string | null
  thumbnail: string | null
  forms: string[]
  productCount: number
  variantCount: number
  /** published | draft | mixed — across the design's products. */
  status: "published" | "draft" | "mixed"
}

/** Every live design, grouped from its products, newest first. */
export async function listLiveDesigns(container: any): Promise<DesignSummary[]> {
  const productModule = container.resolve(Modules.PRODUCT)
  const products = await productModule.listProducts(
    {},
    {
      select: ["id", "title", "handle", "thumbnail", "status", "created_at", "metadata"],
      take: 10000,
    }
  )

  const byDesign = new Map<string, DesignSummary & { _created: number; _statuses: Set<string> }>()
  for (const p of products as any[]) {
    const slug = p.metadata?.design_slug
    if (!slug) continue
    const entry =
      byDesign.get(slug) ??
      ({
        slug,
        name: p.metadata?.design_name ?? p.title,
        theme: (p.metadata?.theme as string) ?? null,
        thumbnail: p.thumbnail ?? null,
        forms: [],
        productCount: 0,
        variantCount: 0,
        status: "published",
        _created: 0,
        _statuses: new Set<string>(),
      } as any)
    const form = (p.metadata?.form as string) ?? "phone"
    if (!entry.forms.includes(form)) entry.forms.push(form)
    entry.productCount += 1
    if (!entry.thumbnail) entry.thumbnail = p.thumbnail ?? null
    entry._statuses.add(p.status)
    const created = p.created_at ? Date.parse(p.created_at) : 0
    if (created > entry._created) entry._created = created
    byDesign.set(slug, entry)
  }

  // Variant counts in one grouped pass (avoids hydrating every variant above).
  const slugs = [...byDesign.keys()]
  if (slugs.length) {
    const all = await productModule.listProducts(
      {},
      { select: ["id", "metadata"], relations: ["variants"], take: 10000 }
    )
    for (const p of all as any[]) {
      const slug = p.metadata?.design_slug
      const entry = slug ? byDesign.get(slug) : undefined
      if (entry) entry.variantCount += (p.variants?.length ?? 0)
    }
  }

  return [...byDesign.values()]
    .map((e) => {
      const statuses = e._statuses
      const status =
        statuses.size > 1 ? "mixed" : statuses.has("published") ? "published" : "draft"
      const { _created, _statuses, ...rest } = e
      return { ...rest, status } as DesignSummary
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type DesignVariantDetail = {
  id: string
  caseType: string | null
  device: string | null
  image: string | null
  sku: string | null
}

export type DesignProductDetail = {
  id: string
  handle: string
  title: string
  form: string
  status: string
  thumbnail: string | null
  caseTypes: string[]
  devices: string[]
  variants: DesignVariantDetail[]
}

export type DesignDetail = {
  slug: string
  name: string
  theme: string | null
  collection: { id: string; title: string } | null
  products: DesignProductDetail[]
}

/** One design's full shape (its products, options and variants) for the editor. */
export async function getDesignDetail(container: any, slug: string): Promise<DesignDetail | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // A design's products are its base handle plus per-form suffixes.
  const handles = [slug, `${slug}-airpods`, `${slug}-watch`, `${slug}-wallet`]
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "title",
      "status",
      "thumbnail",
      "metadata",
      "collection.id",
      "collection.title",
      "options.id",
      "options.title",
      "options.values.value",
      "variants.id",
      "variants.sku",
      "variants.metadata",
      "variants.options.option_id",
      "variants.options.value",
    ],
    filters: { handle: handles },
  })

  const mine = (products ?? []).filter((p: any) => p.metadata?.design_slug === slug)
  if (!mine.length) return null

  const first = mine[0]
  const productDetails: DesignProductDetail[] = mine.map((p: any) => {
    const optTitleById = new Map<string, string>((p.options ?? []).map((o: any) => [o.id, o.title]))
    const caseTypes = (p.options ?? []).find((o: any) => o.title === "Case Type")?.values?.map((v: any) => v.value) ?? []
    const devices = (p.options ?? []).find((o: any) => o.title === "Device")?.values?.map((v: any) => v.value) ?? []
    const variants: DesignVariantDetail[] = (p.variants ?? []).map((v: any) => {
      let caseType: string | null = null
      let device: string | null = null
      for (const o of v.options ?? []) {
        const title = optTitleById.get(o.option_id)
        if (title === "Case Type") caseType = o.value
        else if (title === "Device") device = o.value
      }
      return {
        id: v.id,
        caseType,
        device,
        image: (v.metadata?.images as string[] | undefined)?.[0] ?? null,
        sku: v.sku ?? null,
      }
    })
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      form: (p.metadata?.form as string) ?? "phone",
      status: p.status,
      thumbnail: p.thumbnail ?? null,
      caseTypes,
      devices,
      variants,
    }
  })

  return {
    slug,
    name: (first.metadata?.design_name as string) ?? first.title,
    theme: (first.metadata?.theme as string) ?? null,
    collection: first.collection ? { id: first.collection.id, title: first.collection.title } : null,
    products: productDetails,
  }
}
