import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../modules/content"
import { getSeoConfig } from "../../../modules/content/config"

/** GET /store/seo - templates and overrides the storefront applies. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CONTENT_MODULE)
  const { settings, overrides } = await getSeoConfig(service)
  res.json({
    templates: {
      title: settings.title_template,
      description: settings.description_template,
      heading: settings.heading_template,
      fit_copy_enabled: settings.fit_copy_enabled,
    },
    overrides: overrides.map((o: any) => ({
      scope: o.scope,
      key: o.key,
      title: o.title,
      description: o.description,
      fit_copy: o.fit_copy,
    })),
  })
}
