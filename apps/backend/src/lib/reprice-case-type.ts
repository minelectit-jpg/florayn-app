import { Modules } from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Re-price every variant of a case type across the whole catalogue.
 *
 * In Structure B "Case Type" is a product OPTION, and each variant carries its
 * own price record - so changing a case type's headline price in the catalog
 * table does nothing to what customers pay. This walks every product, finds the
 * variants whose Case Type option is this one, and updates their price. It is
 * the workflow behind the admin Case Types screen's price field.
 *
 * A flat amount is applied to all of them. That is correct for the five flat
 * constructions; Alcantara varies its price by device group, so its variants
 * should not be flat-repriced here (the screen guards against it).
 */
export async function repriceCaseType({
  container,
  caseTypeName,
  amount,
  currencyCode = "bdt",
}: {
  container: any
  caseTypeName: string
  amount: number
  currencyCode?: string
}): Promise<{ variants: number; products: number }> {
  const productModule = container.resolve(Modules.PRODUCT)
  const products = await productModule.listProducts(
    {},
    {
      select: ["id"],
      relations: ["variants", "variants.options", "options"],
      take: 5000,
    }
  )

  const variantIds: string[] = []
  let productCount = 0
  for (const product of products) {
    const optionTitleById = new Map<string, string>(
      (product.options ?? []).map((o: any) => [o.id, o.title])
    )
    let touched = false
    for (const variant of product.variants ?? []) {
      const ct = (variant.options ?? []).find(
        (o: any) => optionTitleById.get(o.option_id) === "Case Type"
      )?.value
      if (ct === caseTypeName) {
        variantIds.push(variant.id)
        touched = true
      }
    }
    if (touched) productCount++
  }

  if (variantIds.length) {
    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: variantIds.map((id) => ({
          id,
          prices: [{ amount, currency_code: currencyCode }],
        })),
      },
    })
  }

  return { variants: variantIds.length, products: productCount }
}
