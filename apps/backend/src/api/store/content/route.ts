import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import { buildMenu, getContent } from "../../../modules/content/config"
import { readStorefrontPresentation } from "../../../lib/read-storefront-presentation"

/**
 * GET /store/content - everything the shell and the home page need: the
 * visible home sections in order, the header mega menu and the footer.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const [{ sections, menuSections, items }, { settings }] = await Promise.all([
    getContent(service),
    readStorefrontPresentation(req.scope),
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
    footerNote: settings.footer.note.replaceAll("{year}", String(new Date().getFullYear())),
    social: settings.footer.social,
    footerAppearance: settings.footer,
  })
}
