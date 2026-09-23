import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../../../modules/content"
import { buildMenu, getCollectionCards, getContent, MEN_MENU } from "../../../modules/content/config"
import { readStorefrontPresentation } from "../../../lib/read-storefront-presentation"

/**
 * GET /store/content[?audience=men] - everything the shell and the home page
 * need: the visible home sections of that mode (Women unless asked) in order,
 * its header mega menu, the footer, and the visible collection landing pages as
 * cards (each saying which modes it has designs for). The Men menu is always
 * included as `primaryMen` so one header can switch without another request;
 * while it is empty the Women menu stands in.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const audience = req.query?.audience === "men" ? "men" : "women"
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const productModule: any = req.scope.resolve(Modules.PRODUCT)
  const knex: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const [{ sections, menuSections, items }, { settings }, collections] = await Promise.all([
    getContent(service),
    readStorefrontPresentation(req.scope),
    // Cards are a nicety; a failure here must not take the menu down with it.
    getCollectionCards(service, productModule, knex).catch(() => []),
  ])

  const women = buildMenu(menuSections, items, "primary")
  const menOwn = buildMenu(menuSections, items, MEN_MENU)
  const men = menOwn.length ? menOwn : women

  res.json({
    sections: sections
      .filter((s: any) => s.is_visible && (s.audience === "men" ? "men" : "women") === audience)
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
    primary: audience === "men" ? men : women,
    primaryMen: men,
    footer: buildMenu(menuSections, items, "footer"),
    footerNote: settings.footer.note.replaceAll("{year}", String(new Date().getFullYear())),
    social: settings.footer.social,
    footerAppearance: settings.footer,
    collections,
  })
}
