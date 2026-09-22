import { Modules } from "@medusajs/framework/utils"
export const BUNDLE_BADGE_KEY = "florayn_bundle_badge"
export async function readBundleBadge(container: any) {
  const [store] = await container.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  const value = store?.metadata?.[BUNDLE_BADGE_KEY]
  return { store, text: typeof value === "string" ? value.slice(0, 32) : "" }
}
export function validateBundleBadge(value: unknown): string {
  if (typeof value !== "string" || value.trim().length > 32) throw new Error("Badge text must be 32 characters or fewer.")
  return value.trim()
}
