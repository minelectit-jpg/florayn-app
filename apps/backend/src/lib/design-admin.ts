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
  kind?: "design" | "regular"
}

/** Every live design, grouped from its products, newest first. */
export async function listLiveDesigns(container: any, includeRegular = false): Promise<DesignSummary[]> {
  if (includeRegular) return listManagedProducts(container)
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
    const slug = p.metadata?.design_slug || (includeRegular ? p.handle : null)
    if (!slug) continue
    const entry =
      byDesign.get(slug) ??
      ({
        slug,
        kind: p.metadata?.design_slug ? "design" : "regular",
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
    const form = (p.metadata?.form as string) ?? (p.metadata?.design_slug ? "phone" : "regular")
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
      { select: ["id", "handle", "metadata"], relations: ["variants"], take: 10000 }
    )
    for (const p of all as any[]) {
      const slug = p.metadata?.design_slug || (includeRegular ? p.handle : null)
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

/** Read variant IDs only: the list must not hydrate every gallery and price. */
async function listManagedProducts(container: any): Promise<DesignSummary[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const groups = new Map<string, DesignSummary & { statuses: Set<string> }>()
  for (let skip = 0; ; skip += 100) {
    const { data } = await query.graph({ entity: "product", fields: ["id", "handle", "title", "thumbnail", "status", "metadata", "variants.id"], pagination: { take: 100, skip, order: { id: "ASC" } } })
    for (const p of data as any[]) {
      const slug = p.metadata?.design_slug || p.handle
      if (!slug) continue
      const form = p.metadata?.form ?? (p.metadata?.design_slug ? "phone" : "regular")
      const row: DesignSummary & { statuses: Set<string> } = groups.get(slug) ?? { slug, name: p.metadata?.design_name ?? p.title, theme: p.metadata?.theme ?? null, thumbnail: p.thumbnail ?? null, kind: p.metadata?.design_slug ? "design" : "regular", forms: [], productCount: 0, variantCount: 0, status: "draft", statuses: new Set<string>() }
      if (!row.forms.includes(form)) row.forms.push(form)
      row.productCount++; row.variantCount += p.variants?.length ?? 0; row.statuses.add(p.status)
      row.thumbnail ||= p.thumbnail ?? null
      groups.set(slug, row)
    }
    if (data.length < 100) break
  }
  return [...groups.values()].map(({ statuses, ...row }) => ({ ...row, status: statuses.size > 1 ? "mixed" : statuses.has("published") ? "published" : "draft" })).sort((a, b) => a.name.localeCompare(b.name)) as DesignSummary[]
}

export type DesignVariantDetail = {
  id: string
  caseType: string | null
  device: string | null
  image: string | null
  sku: string | null
  title: string
  images: string[]
  price: number | null
  options: Record<string, string>
  caseTypeSlug: string | null
  deviceSlug: string | null
  inventory: { id: string; shared: boolean; levels: { location_id: string; stocked: number; reserved: number }[] }[]
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
  description: string
  images: string[]
  options: { title: string; values: string[] }[]
}

export type DesignDetail = {
  slug: string
  name: string
  theme: string | null
  collection: { id: string; title: string } | null
  products: DesignProductDetail[]
  kind: "design" | "regular"
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
      "description", "images.url",
      "collection.id",
      "collection.title",
      "options.id",
      "options.title",
      "options.values.value",
      "variants.id",
      "variants.sku",
      "variants.metadata",
      "variants.title", "variants.prices.amount", "variants.prices.currency_code", "variants.prices.rules_count", "variants.prices.price_list_id", "variants.prices.min_quantity", "variants.prices.max_quantity",
      "variants.inventory_items.inventory.id", "variants.inventory_items.inventory.metadata",
      "variants.inventory_items.inventory.location_levels.location_id",
      "variants.inventory_items.inventory.location_levels.stocked_quantity",
      "variants.inventory_items.inventory.location_levels.reserved_quantity",
      "variants.options.option_id",
      "variants.options.value",
    ],
    filters: { handle: handles },
  })

  const mine = (products ?? []).filter((p: any) => p.metadata?.design_slug === slug || (!p.metadata?.design_slug && p.handle === slug))
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
        image: (v.metadata?.images as string[] | undefined)?.[0] ?? (!caseTypes.length ? p.thumbnail : null),
        sku: v.sku ?? null,
        title: v.title ?? "Default",
        images: v.metadata?.images?.length ? v.metadata.images : (!caseTypes.length ? (p.images ?? []).map((i: any) => i.url) : []),
        price: v.prices?.find((price: any) => price.currency_code === "bdt" && !price.rules_count && !price.price_list_id && price.min_quantity == null && price.max_quantity == null)?.amount ?? null,
        options: Object.fromEntries((v.options ?? []).map((o: any) => [optTitleById.get(o.option_id) ?? o.option_id, o.value])),
        caseTypeSlug: v.metadata?.case_type_slug ?? null,
        deviceSlug: v.metadata?.device_slug ?? null,
        inventory: (v.inventory_items ?? []).flatMap((link: any) => link.inventory ? [{
          id: link.inventory.id,
          shared: Boolean(link.inventory.metadata?.is_blank),
          levels: (link.inventory.location_levels ?? []).map((l: any) => ({ location_id: l.location_id, stocked: Number(l.stocked_quantity), reserved: Number(l.reserved_quantity) })),
        }] : []),
      }
    })
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      form: (p.metadata?.form as string) ?? (p.metadata?.design_slug ? "phone" : "regular"),
      status: p.status,
      thumbnail: p.thumbnail ?? null,
      caseTypes,
      devices,
      variants,
      description: p.description ?? "",
      images: (p.images ?? []).map((i: any) => i.url),
      options: (p.options ?? []).map((o: any) => ({ title: o.title, values: (o.values ?? []).map((v: any) => v.value) })),
    }
  })

  return {
    slug,
    kind: first.metadata?.design_slug ? "design" : "regular",
    name: (first.metadata?.design_name as string) ?? first.title,
    theme: (first.metadata?.theme as string) ?? null,
    collection: first.collection ? { id: first.collection.id, title: first.collection.title } : null,
    products: productDetails,
  }
}
