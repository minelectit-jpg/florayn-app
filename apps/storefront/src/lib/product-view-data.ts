import type { PackDesign } from "@/components/choose-design-modal"
import type { RelatedProduct } from "@/components/product-sections"
import type { YouWillLoveItem } from "@/components/you-will-love"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { pairKey, type VariantMatrix } from "@/lib/variant-matrix"

export type ProductVariantMatrix = Omit<VariantMatrix, "pairs">

/** The selectors only need lookup tables, not a second copy of every variant. */
export function productViewMatrix(matrix: VariantMatrix): ProductVariantMatrix {
  return {
    caseTypes: matrix.caseTypes,
    devices: matrix.devices,
    variantIdByPair: matrix.variantIdByPair,
    devicesByCaseType: matrix.devicesByCaseType,
    caseTypesByDevice: matrix.caseTypesByDevice,
  }
}

/**
 * A single-option product (e.g. a StickPad's Color, a plain accessory) rendered
 * through the SAME case ProductView, so the store has one product-page type. The
 * option's values play the Case Type tile role (image + name + price) over one
 * hidden device (""), which ProductView already collapses out of the title. A
 * product with no options collapses to one nameless value (no tiles, just the
 * price + add-to-cart). Returns the matrix plus the option label and its values.
 */
export function buildSimpleMatrix(
  product: StoreProduct
): { matrix: ProductVariantMatrix; optionTitle: string | null; values: string[] } {
  const options = product.options ?? []
  const opt = options[0]
  const optId = opt?.id
  const DEVICE = ""
  const variants = product.variants ?? []
  const variantIdByPair: Record<string, string> = {}
  const values: string[] = []
  const seen = new Set<string>()
  for (const v of variants) {
    let value = options.length > 1
      ? options.map((o) => `${o.title}: ${v.options?.find((choice) => choice.option_id === o.id)?.value ?? "—"}`).join(" / ")
      : (optId ? v.options?.find((o) => o.option_id === optId)?.value : null) ?? v.title ?? "Default"
    // Labels can contain separators. Never drop a distinct sellable variant.
    if (options.length > 1 && seen.has(value)) value = `${value} (${v.sku || v.id})`
    if (!seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
    // First variant wins a value (values are unique per simple product anyway).
    if (!variantIdByPair[pairKey(value, DEVICE)]) {
      variantIdByPair[pairKey(value, DEVICE)] = v.id
    }
  }
  return {
    matrix: {
      caseTypes: values,
      devices: [DEVICE],
      variantIdByPair,
      devicesByCaseType: Object.fromEntries(values.map((v) => [v, [DEVICE]])),
      caseTypesByDevice: { [DEVICE]: values },
    },
    optionTitle: options.length > 1 ? options.map((o) => o.title).join(" / ") : opt?.title ?? null,
    values,
  }
}

/** Preserve every selectable variant while sending only what the buy box uses. */
export function productViewVariants(variants: StoreVariant[]): StoreVariant[] {
  return variants.map((variant) => ({
    id: variant.id,
    title: variant.title,
    calculated_price: variant.calculated_price
      ? {
          calculated_amount: variant.calculated_price.calculated_amount,
          currency_code: variant.calculated_price.currency_code,
        }
      : variant.calculated_price,
    metadata: { images: variant.metadata?.images ?? [] },
  }))
}

/** Indexes refer to the shared device, case-type and image tables; -1 is absent. */
type DesignVariant = [
  device: number,
  caseType: number,
  id: string,
  price: number | null,
  image: number,
]

type ProductDesign = {
  id: string
  title: string
  handle: string
  packHandle: string
  name: string
  thumbnail?: string | null
  price: number | null
  variants: DesignVariant[]
}

/**
 * A design often appears in all three sections. Send its choices once, keeping
 * every device available for instant selectors and mixed-device bundle slots.
 */
export type ProductDesignData = {
  images: string[]
  devices: string[]
  caseTypes: string[]
  designs: ProductDesign[]
  more: number[]
  packs: number[]
  featured: number[]
}

export function productViewDesigns(
  otherPhoneDesigns: StoreProduct[],
  pickedProducts: StoreProduct[]
): ProductDesignData {
  const data: ProductDesignData = {
    images: [], devices: [], caseTypes: [], designs: [], more: [], packs: [], featured: [],
  }
  const imageIndexes = new Map<string, number>()
  const deviceIndexes = new Map<string, number>()
  const caseTypeIndexes = new Map<string, number>()
  const designIndexes = new Map<string, number>()
  function index(value: string | null | undefined, values: string[], indexes: Map<string, number>): number {
    if (value == null) return -1
    const existing = indexes.get(value)
    if (existing !== undefined) return existing
    const next = values.push(value) - 1
    indexes.set(value, next)
    return next
  }
  function add(product: StoreProduct): number {
    const deviceOption = product.options?.find((o) => o.title.toLowerCase() === "device")?.id
    const caseOption = product.options?.find((o) => o.title.toLowerCase() === "case type")?.id
    const amounts = (product.variants ?? [])
      .map((variant) => variant.calculated_price?.calculated_amount)
      .filter((amount): amount is number => typeof amount === "number")
    const design: ProductDesign = {
      id: product.id,
      title: product.title,
      handle: product.handle,
      packHandle: (product.metadata?.design_slug as string) ?? product.handle,
      name: (product.metadata?.design_name as string) ?? product.title,
      thumbnail: product.thumbnail,
      price: amounts.length ? Math.min(...amounts) : null,
      variants: (product.variants ?? []).map((variant) => [
        index(deviceOption ? variant.options?.find((o) => o.option_id === deviceOption)?.value : null, data.devices, deviceIndexes),
        index(caseOption ? variant.options?.find((o) => o.option_id === caseOption)?.value : null, data.caseTypes, caseTypeIndexes),
        variant.id,
        variant.calculated_price?.calculated_amount ?? null,
        index((variant.metadata?.images as string[] | undefined)?.[0], data.images, imageIndexes),
      ]),
    }
    // Two independently cached queries can contain different versions of the
    // same product. Share only identical projections, never an ID alone.
    const key = JSON.stringify(design)
    const existing = designIndexes.get(key)
    if (existing !== undefined) return existing
    const next = data.designs.push(design) - 1
    designIndexes.set(key, next)
    return next
  }
  data.packs = otherPhoneDesigns.map(add)
  data.more = data.packs.slice(0, 12)
  data.featured = pickedProducts.map(add)
  return data
}

/** Restore the existing section contracts once, without sending duplicate maps. */
export function expandProductViewDesigns(data: ProductDesignData): {
  moreDesignItems: RelatedProduct[]
  packDesigns: PackDesign[]
  youWillLoveItems: YouWillLoveItem[]
} {
  const designs = data.designs.map((design) => {
    const imageByPair: Record<string, string> = {}
    const imageByDevice: Record<string, string> = {}
    const variantByPair: YouWillLoveItem["variantByPair"] = {}
    const packVariants: PackDesign["variants"] = {}
    for (const [deviceIndex, caseTypeIndex, id, price, imageIndex] of design.variants) {
      const device = data.devices[deviceIndex]
      const caseType = data.caseTypes[caseTypeIndex]
      const image = data.images[imageIndex]
      if (!device) continue
      if (image && !imageByDevice[device]) imageByDevice[device] = image
      if (!caseType) continue
      const key = `${device}|${caseType}`
      if (image && !imageByPair[key]) imageByPair[key] = image
      if (!variantByPair[key]) variantByPair[key] = { id, price: price ?? 0 }
      if (typeof price === "number" && price > 0 && !packVariants[key]) {
        packVariants[key] = { variantId: id, price, image: image ?? design.thumbnail ?? null }
      }
    }
    return { design, imageByPair, imageByDevice, variantByPair, packVariants }
  })
  return {
    moreDesignItems: data.more.map((i) => {
      const { design, imageByPair, imageByDevice } = designs[i]
      return {
        id: design.id, title: design.title, handle: design.handle,
        thumbnail: design.thumbnail, label: design.name, price: design.price,
        imageByPair, imageByDevice,
      }
    }),
    packDesigns: data.packs.map((i) => {
      const { design, packVariants } = designs[i]
      return {
        handle: design.packHandle, name: design.name,
        thumbnail: design.thumbnail ?? null, variants: packVariants,
      }
    }),
    youWillLoveItems: data.featured.map((i) => {
      const { design, imageByPair, imageByDevice, variantByPair } = designs[i]
      return {
        id: design.id, name: design.name, handle: design.handle,
        thumbnail: design.thumbnail ?? null, price: design.price,
        imageByPair, imageByDevice, variantByPair,
      }
    }),
  }
}
