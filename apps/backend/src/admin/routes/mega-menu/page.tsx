import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ListBullet } from "@medusajs/icons"

import MenuEditor from "../../components/menu-editor"

const MegaMenuPage = () => (
  <MenuEditor
    menu="primary"
    title="Mega menu"
    description="The header navigation. Each menu holds links, and a group heading turns a flat list into a mega-menu column."
    useGroups
  />
)

export const config = defineRouteConfig({
  label: "Mega menu",
  icon: ListBullet,
})

export default MegaMenuPage
