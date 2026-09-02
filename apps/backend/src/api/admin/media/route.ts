import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/media - products for the media manager, with how complete their
 * per-device imagery is, so gaps are visible without opening each one.
 *
 * ?q= filters by design or case type, ?missing=1 shows only products with a
 * device that has no render.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const q = String(req.query.q ?? "").trim().toLowerCase()
  const onlyMissing = req.query.missing === "1"

  const products = await productModule.listProducts(
    {},
    { select: ["id", "handle", "title", "thumbnail", "metadata"], relations: ["variants"], take: 2000 }
  )

  const rows = products
    .map((product: any) => {
      const variants = product.variants ?? []
      const withImages = variants.filter(
        (v: any) => ((v.metadata?.images as string[]) ?? []).length > 0
      ).length
      return {
        id: product.id,
        handle: product.handle,
        title: product.title,
        thumbnail: product.thumbnail,
        design: product.metadata?.design_name ?? product.metadata?.design_slug ?? null,
        case_type: product.metadata?.case_type_name ?? null,
        variants: variants.length,
        with_images: withImages,
        missing: variants.length - withImages,
      }
    })
    .filter((row: any) => {
      if (onlyMissing && row.missing === 0) return false
      if (!q) return true
      return (
        String(row.design ?? "").toLowerCase().includes(q) ||
        String(row.case_type ?? "").toLowerCase().includes(q) ||
        row.handle.toLowerCase().includes(q)
      )
    })
    .sort((a: any, b: any) => b.missing - a.missing || String(a.design).localeCompare(String(b.design)))

  res.json({
    products: rows.slice(0, 200),
    total: rows.length,
    totals: {
      products: products.length,
      variants: products.reduce((n: number, p: any) => n + (p.variants?.length ?? 0), 0),
      missing: rows.reduce((n: number, r: any) => n + r.missing, 0),
    },
  })
}
