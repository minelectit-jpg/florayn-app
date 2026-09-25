import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CursorArrowRays } from "@medusajs/icons"
import { BuyBoxPresentationEditor } from "../../components/storefront-presentation-editor"

export const config = defineRouteConfig({ label: "Buy buttons", icon: CursorArrowRays })
export default BuyBoxPresentationEditor
