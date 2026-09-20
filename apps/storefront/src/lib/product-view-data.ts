import type { StoreVariant } from "@/lib/medusa"
import type { VariantMatrix } from "@/lib/variant-matrix"

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
