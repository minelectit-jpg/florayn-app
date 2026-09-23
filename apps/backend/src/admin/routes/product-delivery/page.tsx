import { defineRouteConfig } from "@medusajs/admin-sdk"
import { TruckFast } from "@medusajs/icons"
import { DeliveryPresentationEditor } from "../../components/storefront-presentation-editor"

export const config = defineRouteConfig({ label: "Product delivery", icon: TruckFast })
export default DeliveryPresentationEditor
