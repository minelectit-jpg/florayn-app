import { BUNDLES_MODULE } from "../modules/bundles"
import { getBundleConfig } from "../modules/bundles/config"
import { validateTier } from "../modules/bundles/validate"

/** Exercises exactly what the admin routes do, without the HTTP layer. */
export default async function checkBundles({ container }: any) {
  const service: any = container.resolve(BUNDLES_MODULE)
  const log = (m: string) => console.log(`  ${m}`)

  const { settings, tiers } = await getBundleConfig(service)
  log(`settings: "${settings.heading}" / "${settings.single_label}" / free over ${settings.free_shipping_threshold}`)
  log(`tiers: ${tiers.map((t: any) => `${t.quantity}x -${t.discount_amount} [${t.min_pct}-${t.max_pct}%] ${t.is_enabled ? "on" : "off"}`).join("  |  ")}`)

  console.log("\n-- validation --")
  for (const [label, body] of [
    ["quantity 1 (too low)", { quantity: 1, discount_amount: 10, min_pct: 0, max_pct: 0 }],
    ["max below min", { quantity: 4, discount_amount: 10, min_pct: 20, max_pct: 5 }],
    ["max 0 = uncapped", { quantity: 4, discount_amount: 10, min_pct: 20, max_pct: 0 }],
  ] as [string, any][]) {
    const r = validateTier(body, { partial: false })
    log(`${label}: ${"error" in r ? "rejected - " + r.error : "accepted"}`)
  }

  console.log("\n-- create / update / delete --")
  const created = await service.createBundleTiers({
    quantity: 4, badge: "TEMP", discount_amount: 1000, min_pct: 10, max_pct: 25,
    is_enabled: false, sort_order: 99,
  })
  const id = Array.isArray(created) ? created[0].id : created.id
  log(`created ${id}`)
  await service.updateBundleTiers({ id, badge: "TEMP EDITED", discount_amount: 1200 })
  const after = await service.listBundleTiers({ id })
  log(`updated -> badge "${after[0].badge}", discount ${after[0].discount_amount}`)
  await service.deleteBundleTiers(id)
  const gone = await service.listBundleTiers({ id })
  log(`deleted -> ${gone.length === 0 ? "row removed" : "STILL PRESENT"}`)

  const final = await getBundleConfig(service)
  console.log(`\n  tiers now: ${final.tiers.length}`)
}
