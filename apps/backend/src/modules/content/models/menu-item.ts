import { model } from "@medusajs/framework/utils"

/**
 * A link inside a menu section. `group` is the sub-heading it sits under in a
 * mega-menu panel ("iPhone 17 Series"); the footer leaves it null.
 */
const MenuItem = model.define("menu_item", {
  id: model.id({ prefix: "menuitem" }).primaryKey(),
  section_id: model.text(),
  group: model.text().nullable(),
  label: model.text(),
  href: model.text(),
  /** Small ribbon, e.g. New or Hot. */
  badge: model.text().nullable(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default MenuItem
