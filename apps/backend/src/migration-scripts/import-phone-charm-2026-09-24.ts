import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { rebuildCards } from "../lib/rebuild-cards"

/**
 * Imports florayn.com's Leather Chain Phone Charms (category "Phone Charms")
 * as ONE simple product with a Color option, the same shape as StickPad Pro,
 * so it renders through the shared product page with colour tiles.
 *
 * Photos were copied from florayn.com (public GETs) to R2 under phone-charms/.
 * Price and colours are florayn.com's; Lavender is left out because it is
 * sold out there. Stock is not tracked (like StickPad) - the owner can switch
 * that on per colour in the admin. It borrows StickPad's sales channel and
 * shipping profile, and does nothing if the handle already exists.
 */
const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/phone-charms"
export const PHONE_CHARM_HANDLE = "leather-chain-phone-charm"
export const PHONE_CHARM_COLORS: { color: string; image: string }[] = [
  { color: "Magenta", image: `${R2}/magenta-6f21763b.webp` },
  { color: "Pink", image: `${R2}/pink-462db4a5.webp` },
  { color: "Red", image: `${R2}/red-9cf36162.webp` },
  { color: "Cream", image: `${R2}/cream-90668231.webp` },
  { color: "Beige", image: `${R2}/beige-927a07a6.webp` },
  { color: "White", image: `${R2}/white-7a75b9f7.webp` },
  { color: "Black", image: `${R2}/black-57013d18.webp` },
]
const PRICE = 350

export default async function importPhoneCharm({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existing } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: PHONE_CHARM_HANDLE } })
  if (existing?.length) {
    logger.info("[phone-charm] already imported")
    return
  }

  const { data: [model] } = await query.graph({
    entity: "product",
    fields: ["id", "shipping_profile.id", "sales_channels.id"],
    filters: { handle: "stickpad-pro" },
  })
  const shippingProfileId = model?.shipping_profile?.id
  const salesChannels = (model?.sales_channels ?? []).map((c: any) => ({ id: c.id }))
  if (!shippingProfileId || !salesChannels.length) {
    logger.warn("[phone-charm] StickPad Pro's shipping profile or sales channel not found; skipped")
    return
  }

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title: "Leather Chain Phone Charm",
        handle: PHONE_CHARM_HANDLE,
        status: ProductStatus.PUBLISHED,
        description:
          "A premium leather strap woven through a polished metal chain.\n\n" +
          "It clips to any phone case with a durable transparent anchor, for a secure, comfortable carry " +
          "and a finishing touch that matches your Florayn case, AirPods case and more.",
        thumbnail: PHONE_CHARM_COLORS[0].image,
        images: PHONE_CHARM_COLORS.map((c) => ({ url: c.image })),
        shipping_profile_id: shippingProfileId,
        sales_channels: salesChannels,
        metadata: { form: "charm", design_name: "Leather Chain Phone Charm", design_slug: PHONE_CHARM_HANDLE },
        options: [{ title: "Color", values: PHONE_CHARM_COLORS.map((c) => c.color) }],
        variants: PHONE_CHARM_COLORS.map((c) => ({
          title: c.color,
          sku: `PCH-${c.color.toUpperCase().replace(/[^A-Z0-9]+/g, "")}`,
          options: { Color: c.color },
          manage_inventory: false,
          metadata: { images: [c.image] },
          prices: [{ amount: PRICE, currency_code: "bdt" }],
        })),
      }],
    },
  })
  // The related-product strips read the precomputed card, like every other product.
  await rebuildCards(container, { productIds: result.map((p) => p.id) })
  logger.info(`[phone-charm] imported ${PHONE_CHARM_COLORS.length} colours at ${PRICE} BDT`)
}
