import { Modules } from "@medusajs/framework/utils"

export const RECOMMENDATION_KEY = "florayn_recommendations"
export const RECOMMENDATION_DEFAULTS = {
  phone_model: "iPhone 17 Pro Max",
  phone_case_type: "Signature",
  airpods_model: "AirPods Pro 3",
  airpods_case_type: "Signature Earbuds",
}
export type RecommendationSettings = typeof RECOMMENDATION_DEFAULTS

export function recommendationSettings(value: unknown, legacyAirpods?: string): RecommendationSettings {
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(RECOMMENDATION_DEFAULTS).map(([key, fallback]) => [
    key, typeof saved[key] === "string" && saved[key].trim() ? saved[key].trim()
      : key === "airpods_model" && legacyAirpods ? legacyAirpods : fallback,
  ])) as RecommendationSettings
}

/** Existing store metadata holds storefront preferences; no catalog migration. */
export async function readRecommendationSettings(container: any) {
  const [stores, bundles] = await Promise.all([
    container.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 }),
    container.resolve("bundles").listBundleSettings({}, { take: 1 }),
  ])
  const store = stores[0]
  return { store, settings: recommendationSettings(store?.metadata?.[RECOMMENDATION_KEY], bundles[0]?.matching_set_default_airpods) }
}

export function validateRecommendationSettings(body: unknown, devices: any[], caseTypes: any[]): RecommendationSettings {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Provide recommendation settings.")
  const input = body as Record<string, unknown>
  const settings = {} as RecommendationSettings
  for (const key of Object.keys(RECOMMENDATION_DEFAULTS) as (keyof RecommendationSettings)[]) {
    const value = input[key]
    if (typeof value !== "string" || !value.trim() || value.length > 160) throw new Error(`Choose a valid ${key.replaceAll("_", " ")}.`)
    settings[key] = value.trim()
  }
  for (const form of ["phone", "airpods"] as const) {
    const device = devices.find((d) => d.name === settings[`${form}_model`] && d.is_active !== false)
    if (!device || (form === "phone" ? !["iphone", "samsung"].includes(device.family) : device.family !== "airpods")) throw new Error(`Choose an active ${form} model.`)
    const construction = caseTypes.find((c) => c.name === settings[`${form}_case_type`] && c.is_active !== false)
    if (!construction || !(construction.devices ?? []).some((d: any) => d.id === device.id)) throw new Error(`The selected case type does not support ${device.name}.`)
  }
  return settings
}
