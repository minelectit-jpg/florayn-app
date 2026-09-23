import { Modules } from "@medusajs/framework/utils"
import { PRESENTATION_KEY, readPresentation } from "./storefront-presentation"

export async function readStorefrontPresentation(container: any) {
  const [store] = await container.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  return { store, settings: readPresentation(store?.metadata?.[PRESENTATION_KEY]) }
}
