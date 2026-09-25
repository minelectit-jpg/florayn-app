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
  /**
   * links (the hand-made groups of menu_item rows), or a section that fills
   * itself: devices (from Devices), case_types (from Case types) or collections
   * (from Collection pages). The footer is always links. See
   * lib/menu-section-input.ts for each kind's config.
   */
  kind: model.text().default("links"),
  /** Round picture in the phone menu and the desktop panel (https). */
  image_url: model.text().nullable(),
  /** Short pill next to the label, e.g. New. */
  badge: model.text().nullable(),
  /** all (phone menu and desktop bar), drawer (phone menu only) or bar (desktop only). */
  placement: model.text().default("all"),
  /** The automatic kinds' settings; null for links. */
  config: model.json().nullable(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default MenuSection
