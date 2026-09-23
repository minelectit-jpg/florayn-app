import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../../../modules/content"
import { buildMenu, getCollectionCards, getContent } from "../../../modules/content/config"

/**
 * GET /store/content - everything the shell and the home page need: the
 * visible home sections in order, the header mega menu, the footer, and the
 * visible collection landing pages as cards.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const [{ sections, menuSections, items, footerNote, social }, collections] =
    await Promise.all([
      getContent(service),
      // Cards are a nicety; a failure here must not take the menu down with it.
      getCollectionCards(service, productModule).catch(() => []),
    ])

  res.json({
    sections: sections
      .filter((s: any) => s.is_visible)
      .map((s: any) => ({
        key: s.key,
        type: s.type,
        title: s.title,
        subtitle: s.subtitle,
        eyebrow: s.eyebrow,
        cta_label: s.cta_label,
        cta_href: s.cta_href,
        config: s.config ?? {},
      })),
    primary: buildMenu(menuSections, items, "primary"),
    footer: buildMenu(menuSections, items, "footer"),
    footerNote,
    social,
    collections,
  })
}
