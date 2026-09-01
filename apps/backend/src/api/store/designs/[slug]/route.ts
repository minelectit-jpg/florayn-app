import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * A design is sold as one product per case type. The product page needs the
 * sibling products so it can offer the same artwork in another finish, and the
 * Store API cannot express that join, so it is served here.
 *
 * GET /store/designs/:slug
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params

  const { data } = await query.graph({
    entity: "design",
    fields: [
      "id",
      "slug",
      "name",
      "description",
      "theme",
      "artist",
      "hero_image_url",
      "products.id",
      "products.title",
      "products.handle",
      "products.subtitle",
      "products.thumbnail",
      "products.status",
      "products.metadata",
    ],
    filters: { slug },
  })

  const design = data?.[0]

  if (!design) {
    return res.status(404).json({ message: `Design '${slug}' not found` })
  }

  const products = (design.products ?? [])
    .filter((product: any) => product?.status === "published")
    .map((product: any) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      subtitle: product.subtitle,
      thumbnail: product.thumbnail,
      case_type_slug: product.metadata?.case_type_slug ?? null,
      case_type_name: product.metadata?.case_type_name ?? null,
    }))

  res.json({
    design: {
      id: design.id,
      slug: design.slug,
      name: design.name,
      description: design.description,
      theme: design.theme,
      artist: design.artist,
      hero_image_url: design.hero_image_url,
    },
    products,
  })
}
