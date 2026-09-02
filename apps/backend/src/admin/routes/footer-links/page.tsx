import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Link as LinkIcon } from "@medusajs/icons"

import MenuEditor from "../../components/menu-editor"

const FooterLinksPage = () => (
  <MenuEditor
    menu="footer"
    title="Footer"
    description="The four footer columns and their links."
    useGroups={false}
  />
)

export const config = defineRouteConfig({
  label: "Footer",
  icon: LinkIcon,
})

export default FooterLinksPage
