import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"

/**
 * Thin client for the custom /store routes the catalog module exposes. These
 * cover the joins the stock Store API cannot express: design -> its products,
 * and the device list on its own.
 */
async function storeFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}${path}`, {
      ...init,
      headers: {
        "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
        ...(init?.headers ?? {}),
      },
      next: { revalidate: 60 },
    })

    if (!res.ok) {
      return null
    }

    return (await res.json()) as T
  } catch {
    return null
  }
}

export type DesignSibling = {
  id: string
  title: string
  handle: string
  subtitle?: string | null
  thumbnail?: string | null
  case_type_slug: string | null
  case_type_name: string | null
}

export type DesignResponse = {
  design: {
    id: string
    slug: string
    name: string
    description?: string | null
    theme?: string | null
    artist?: string | null
    hero_image_url?: string | null
  }
  products: DesignSibling[]
}

export function getDesign(slug: string) {
  return storeFetch<DesignResponse>(`/store/designs/${slug}`)
}

export type DeviceRecord = {
  id: string
  slug: string
  name: string
  family: string
  brand: string
}

const FAMILY_LABELS: Record<string, string> = {
  iphone: "iPhone",
  samsung: "Samsung Galaxy",
  airpods: "AirPods",
  watch: "Apple Watch",
  wallet: "Card Wallet",
}

/**
 * device name -> family label, used to group the device picker. Falls back to
 * an empty map so the picker still renders if the backend route is missing.
 */
export async function getDeviceFamilyMap(): Promise<Record<string, string>> {
  const data = await storeFetch<{ devices: DeviceRecord[] }>("/store/devices")
  const map: Record<string, string> = {}

  for (const device of data?.devices ?? []) {
    map[device.name] = FAMILY_LABELS[device.family] ?? device.family
  }

  return map
}
