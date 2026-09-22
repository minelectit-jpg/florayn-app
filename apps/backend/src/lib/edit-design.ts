import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createCollectionsWorkflow } from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import { slugify } from "./create-uploaded-design"
import { rebuildCards } from "./rebuild-cards"

const FORM_LABEL: Record<string, string> = {
  phone: "Phone Case",
  airpods: "AirPods Case",
  watch: "Watch Band",
  wallet: "Card Wallet",
}

export type DesignMetaPatch = {
  /** New design name (display title); the slug/handle/URL never change. */
  name?: string
  /** New theme; "" clears it. Undefined leaves it unchanged. */
  theme?: string
  /** published | draft, applied to every product of the design. */
  status?: "published" | "draft"
  description?: string
}

/**
 * Edit a design's display metadata and publish status across all its products.
 * Never touches prices (those live in the Case Types screen) or variants; the
 * handle/slug stays fixed so URLs and card keys are stable. Rebuilds the
 * affected cards; the /admin/designs write also triggers a storefront refresh.
 */
export async function editDesignMeta(
  container: any,
  slug: string,
  patch: DesignMetaPatch
): Promise<{ ok: true; updated: number }> {
  const productModule = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const handles = [slug, `${slug}-airpods`, `${slug}-watch`, `${slug}-wallet`]
  const products = (
    await productModule.listProducts(
      { handle: handles },
      { select: ["id", "handle", "status", "title", "metadata"] }
    )
  ).filter((p: any) => p.metadata?.design_slug === slug || (!p.metadata?.design_slug && p.handle === slug))
  if (!products.length) throw new Error(`No design found for "${slug}".`)

  // Theme -> collection (find or create), only when theme is being set.
  const themeGiven = patch.theme !== undefined
  const themeName = patch.theme?.trim() || ""
  let collectionId: string | undefined
  if (themeGiven && themeName) {
    const handle = slugify(themeName)
    const { data: cols } = await query.graph({
      entity: "product_collection",
      fields: ["id", "handle"],
    })
    collectionId = cols.find((c: any) => c.handle === handle)?.id
    if (!collectionId) {
      const { result } = await createCollectionsWorkflow(container).run({
        input: { collections: [{ title: themeName, handle }] },
      })
      collectionId = result[0].id
    }
  }

  const statusVal =
    patch.status === "published"
      ? ProductStatus.PUBLISHED
      : patch.status === "draft"
        ? ProductStatus.DRAFT
        : undefined
  const name = patch.name?.trim()

  const updates = products.map((p: any) => {
    const form = (p.metadata?.form as string) ?? "phone"
    const u: any = { id: p.id }
    const meta = { ...(p.metadata ?? {}) }
    if (name) {
      u.title = !p.metadata?.design_slug || form === "phone" ? name : `${name} - ${FORM_LABEL[form] ?? "Accessory"}`
      meta.design_name = name
    }
    if (themeGiven) meta.theme = themeName || null
    if (name || themeGiven) u.metadata = meta
    if (statusVal) u.status = statusVal
    if (themeGiven) u.collection_id = collectionId ?? null
    if (patch.description !== undefined) u.description = patch.description
    return u
  })
  await productModule.updateProducts(updates)

  // Keep the catalog design record in step with name/theme.
  const [designRec] = await catalog.listDesigns({ slug })
  if (designRec) {
    const recPatch: any = { id: designRec.id }
    if (name) recPatch.name = name
    if (themeGiven) recPatch.theme = themeName || null
    if (Object.keys(recPatch).length > 1) await catalog.updateDesigns(recPatch)
  }

  await rebuildCards(container, { productIds: products.map((p: any) => p.id) })
  return { ok: true, updated: products.length }
}
