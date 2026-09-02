import { CONTENT_MODULE } from "../modules/content"
import { buildMenu, getContent } from "../modules/content/config"

/** Exercises what the three admin screens do, without the HTTP layer. */
export default async function checkContent({ container }: any) {
  const service: any = container.resolve(CONTENT_MODULE)
  const log = (m: string) => console.log(`  ${m}`)

  const { sections, menuSections, items } = await getContent(service)
  log(`home sections: ${sections.length}, menu sections: ${menuSections.length}, links: ${items.length}`)

  console.log("\n-- reorder: move the last section to the top --")
  const ordered = [...sections].sort((a: any, b: any) => a.position - b.position)
  const before = ordered.map((s: any) => s.key)
  const moved = [ordered[ordered.length - 1], ...ordered.slice(0, -1)]
  for (const [position, s] of moved.entries()) {
    await service.updateHomeSections({ id: s.id, position })
  }
  let after = (await getContent(service)).sections
    .sort((a: any, b: any) => a.position - b.position)
    .map((s: any) => s.key)
  log(`before: ${before.join(" > ")}`)
  log(`after:  ${after.join(" > ")}`)

  // put it back
  for (const [position, s] of ordered.entries()) {
    await service.updateHomeSections({ id: s.id, position })
  }
  after = (await getContent(service)).sections
    .sort((a: any, b: any) => a.position - b.position)
    .map((s: any) => s.key)
  log(`restored: ${after.join(" > ") === before.join(" > ") ? "yes" : "NO"}`)

  console.log("\n-- hide a section --")
  const hero = sections.find((s: any) => s.key === "hero")
  await service.updateHomeSections({ id: hero.id, is_visible: false })
  let visible = (await getContent(service)).sections.filter((s: any) => s.is_visible)
  log(`hero hidden -> storefront would render ${visible.length} sections`)
  await service.updateHomeSections({ id: hero.id, is_visible: true })
  visible = (await getContent(service)).sections.filter((s: any) => s.is_visible)
  log(`hero restored -> ${visible.length} sections`)

  console.log("\n-- menu shape --")
  for (const s of buildMenu(menuSections, items, "primary")) {
    log(`${s.label}: ${s.groups.length} group(s), ${s.groups.reduce((n, g) => n + g.links.length, 0)} links`)
  }
  console.log("\n-- footer shape --")
  for (const s of buildMenu(menuSections, items, "footer")) {
    log(`${s.label}: ${s.groups.reduce((n, g) => n + g.links.length, 0)} links`)
  }

  console.log("\n-- add + delete a footer column --")
  const created = await service.createMenuSections({
    menu: "footer", label: "Temp", href: null, position: 99, is_visible: true,
  })
  const id = Array.isArray(created) ? created[0].id : created.id
  await service.createMenuItems({ section_id: id, label: "Temp link", href: "/", position: 0, is_visible: true })
  log(`created column ${id} with 1 link`)
  const owned = await service.listMenuItems({ section_id: id })
  await service.deleteMenuItems(owned.map((i: any) => i.id))
  await service.deleteMenuSections(id)
  const final = await getContent(service)
  log(`after delete: ${final.menuSections.filter((s: any) => s.menu === "footer").length} footer columns, ${final.items.length} links total`)
}
