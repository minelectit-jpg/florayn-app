import {
  DEFAULT_HOME_SECTIONS,
  DEFAULT_MENU,
  FOOTER_NOTE,
  SOCIAL_LINKS,
} from "./defaults"

/**
 * Reading the site content, seeding it from the live site's structure the
 * first time it is asked for. Same pattern as the bundles module: a fresh
 * database serves a complete home page and menu immediately, and everything
 * is editable in the admin from then on.
 */
export async function getContent(service: any) {
  let sections = await service.listHomeSections(
    {},
    { order: { position: "ASC" } }
  )

  if (!sections?.length) {
    await service.createHomeSections(DEFAULT_HOME_SECTIONS as any)
    sections = await service.listHomeSections({}, { order: { position: "ASC" } })
  }

  let menuSections = await service.listMenuSections(
    {},
    { order: { position: "ASC" } }
  )

  if (!menuSections?.length) {
    for (const [index, group] of DEFAULT_MENU.entries()) {
      const created = await service.createMenuSections({
        menu: group.menu,
        label: group.label,
        href: group.href,
        position: index,
        is_visible: true,
      })
      const sectionId = Array.isArray(created) ? created[0].id : created.id
      await service.createMenuItems(
        group.items.map((item, i) => ({
          section_id: sectionId,
          group: item.group ?? null,
          label: item.label,
          href: item.href,
          badge: item.badge ?? null,
          position: i,
          is_visible: true,
        }))
      )
    }
    menuSections = await service.listMenuSections(
      {},
      { order: { position: "ASC" } }
    )
  }

  const items = await service.listMenuItems({}, { order: { position: "ASC" } })

  return {
    sections,
    menuSections,
    items,
    footerNote: FOOTER_NOTE,
    social: SOCIAL_LINKS,
  }
}

/** Shapes the flat rows into the nested menu the storefront renders. */
export function buildMenu(
  menuSections: any[],
  items: any[],
  menu: string,
  { visibleOnly = true } = {}
) {
  return menuSections
    .filter((s) => s.menu === menu && (!visibleOnly || s.is_visible))
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const own = items
        .filter(
          (i) => i.section_id === section.id && (!visibleOnly || i.is_visible)
        )
        .sort((a, b) => a.position - b.position)

      // Preserve the order groups first appear in, rather than sorting names.
      const groups: { heading: string | null; links: any[] }[] = []
      for (const item of own) {
        const heading = item.group || null
        let bucket = groups.find((g) => g.heading === heading)
        if (!bucket) {
          bucket = { heading, links: [] }
          groups.push(bucket)
        }
        bucket.links.push({
          id: item.id,
          label: item.label,
          href: item.href,
          badge: item.badge,
        })
      }

      return {
        id: section.id,
        label: section.label,
        href: section.href,
        groups,
      }
    })
}
