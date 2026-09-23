import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Link as LinkIcon } from "@medusajs/icons"

import MenuEditor from "../../components/menu-editor"
import { FooterPresentationEditor } from "../../components/storefront-presentation-editor"

const FooterLinksPage = () => (
  <><FooterPresentationEditor /><MenuEditor
    menu="footer"
    title="Footer links"
    description="The ordered footer columns and their links. They become collapsible groups on mobile."
    useGroups={false}
  /></>
)

export const config = defineRouteConfig({
  label: "Footer",
  icon: LinkIcon,
})

export default FooterLinksPage
