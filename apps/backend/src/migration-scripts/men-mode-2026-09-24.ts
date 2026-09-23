import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { MEN_DESIGNS, WOMEN_DESIGNS, WOMEN_STICKPAD_COLORS } from "../lib/design-audience-seed"
import { CONTENT_MODULE } from "../modules/content"
import { copyMenu, menHomeSections, MEN_MENU } from "../modules/content/config"

/**
 * Sets up the Women / Men modes (the Men site lives at /men):
 *
 *   - every design gets the audience florayn.com gives it ("Gender": Men,
 *     Women, or both). Only products with no audience yet are touched, so a
 *     choice made in the Product Manager is never overwritten.
 *   - StickPad's Magenta, Sky Blue, Pink and Cyan are Women only, as on
 *     florayn.com; its other colours (and every charm colour) stay for both.
 *   - the Men header menu starts as a copy of the Women one (if it is empty).
 *   - the Men home page is created from florayn.com/men (if it has no sections).
 *
 * Idempotent: a second run changes nothing.
 */
export default async function menMode({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModule: any = container.resolve(Modules.PRODUCT)
  const content: any = container.resolve(CONTENT_MODULE)

  const men = new Set(MEN_DESIGNS)
  const women = new Set(WOMEN_DESIGNS)
  const products: any[] = await productModule.listProducts({}, { select: ["id", "handle", "metadata"], take: 10000 })
  const updates = products.flatMap((p) => {
    const meta = p.metadata ?? {}
    const slug = typeof meta.design_slug === "string" ? meta.design_slug : ""
    if (!slug || meta.audience !== undefined) return []
    const audience = men.has(slug) ? "men" : women.has(slug) ? "women" : "both"
    return [{ id: p.id, metadata: { ...meta, audience } }]
  })
  for (let i = 0; i < updates.length; i += 100) await productModule.upsertProducts(updates.slice(i, i + 100))
  logger.info(`[men-mode] audience set on ${updates.length} products`)

  const stickpad = products.find((p) => p.handle === "stickpad-pro")
  if (stickpad) {
    const variants: any[] = await productModule.listProductVariants({ product_id: stickpad.id }, { select: ["id", "title", "metadata"], take: 100 })
    const colours = variants
      .filter((v) => WOMEN_STICKPAD_COLORS.includes(v.title) && v.metadata?.audience === undefined)
      .map((v) => ({ id: v.id, metadata: { ...(v.metadata ?? {}), audience: "women" } }))
    if (colours.length) await productModule.upsertProductVariants(colours)
    logger.info(`[men-mode] ${colours.length} StickPad colours set to Women only`)
  }

  const copied = await copyMenu(content, "primary", MEN_MENU)
  if (copied) logger.info(`[men-mode] Men menu started from the Women menu (${copied} menus)`)

  const sections: any[] = await content.listHomeSections({}, { order: { position: "ASC" }, take: 500 })
  if (!sections.some((s) => s.audience === "men")) {
    const keys = new Set(sections.map((s) => s.key))
    const rows = menHomeSections(sections.filter((s) => s.audience !== "men")).filter((s) => !keys.has(s.key))
    if (rows.length) await content.createHomeSections(rows)
    logger.info(`[men-mode] Men home page created with ${rows.length} sections`)
  }
}
