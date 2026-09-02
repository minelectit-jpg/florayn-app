import { CONTENT_MODULE } from "../modules/content"
import { getCollectionPages } from "../modules/content/config"

/** Exercises what the collection-page editor does, without the HTTP layer. */
export default async function check({ container }: any) {
  const service: any = container.resolve(CONTENT_MODULE)
  const log = (m: string) => console.log(`  ${m}`)

  const pages = await getCollectionPages(service)
  log(`landing pages: ${pages.length}`)
  log(pages.map((p: any) => p.collection_slug).join(", "))

  const leopard = pages.find((p: any) => p.collection_slug === "leopard")

  console.log("\n-- edit copy --")
  await service.updateCollectionPages({
    id: leopard.id,
    intro_heading: "Leopard, reworked",
  })
  let after = (await getCollectionPages(service)).find(
    (p: any) => p.collection_slug === "leopard"
  )
  log(`intro_heading -> "${after.intro_heading}"`)
  await service.updateCollectionPages({
    id: leopard.id,
    intro_heading: "Leopard Phone Cases",
  })

  console.log("\n-- curate the design list --")
  const curated = ["amber-leopard", "arctic-leopard", "blush-leopard"]
  await service.updateCollectionPages({ id: leopard.id, design_slugs: curated })
  after = (await getCollectionPages(service)).find(
    (p: any) => p.collection_slug === "leopard"
  )
  log(`design_slugs -> ${JSON.stringify(after.design_slugs)}`)

  console.log("\n-- hide and show --")
  await service.updateCollectionPages({ id: leopard.id, is_visible: false })
  let visible = (await getCollectionPages(service)).filter((p: any) => p.is_visible)
  log(`hidden  -> ${visible.length} visible`)
  await service.updateCollectionPages({ id: leopard.id, is_visible: true })
  visible = (await getCollectionPages(service)).filter((p: any) => p.is_visible)
  log(`shown   -> ${visible.length} visible`)

  console.log("\n(leaving leopard curated to 3 designs so the ordering can be checked)")
}
