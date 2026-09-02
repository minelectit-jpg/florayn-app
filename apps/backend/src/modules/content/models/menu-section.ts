import { model } from "@medusajs/framework/utils"

/**
 * A top-level entry. In the header menu that is one mega-menu column set
 * ("Phone Case"); in the footer it is one column ("About").
 */
const MenuSection = model.define("menu_section", {
  id: model.id({ prefix: "menusec" }).primaryKey(),
  /** "primary" for the header, "footer" for the footer. */
  menu: model.text(),
  label: model.text(),
  /** Where the top-level label itself points. Null for a heading only. */
  href: model.text().nullable(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default MenuSection
