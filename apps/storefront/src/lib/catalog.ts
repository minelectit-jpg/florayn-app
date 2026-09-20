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
    const domain = path.split("?")[0].split("/")[2]
    const res = await fetch(`${MEDUSA_BACKEND_URL}${path}`, {
      ...init,
      headers: {
        "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
        ...(init?.headers ?? {}),
      },
      next: {
        revalidate: 60,
        tags: domain === "stock"
          ? ["stock"]
          : ["shop-cards", "shop-catalog"].includes(domain)
            ? ["products", "catalog", `catalog:${domain}`]
            : ["catalog", `catalog:${domain}`],
      },
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

/** The full device list, in catalogue order, for the collection filter bar. */
export async function getDeviceCatalog(): Promise<DeviceRecord[]> {
  const data = await storeFetch<{ devices: DeviceRecord[] }>("/store/devices")
  return data?.devices ?? []
}

/** Public R2 bucket that holds every wired render, for building card image URLs. */
const R2_BASE = (
  process.env.NEXT_PUBLIC_R2_URL ??
  "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"
).replace(/\/+$/, "")

/**
 * The render for a design in a given construction and model. Every design is
 * wired per-device (image_granularity === "device"), so this path always
 * exists for a live pair; a missing one 404s and the card shows its fallback.
 */
export function shopCardImage(
  designSlug: string,
  caseTypeSlug: string,
  deviceSlug: string
): string {
  return `${R2_BASE}/${designSlug}/${caseTypeSlug}/${deviceSlug}/1.webp`
}

export type ShopCard = {
  handle: string
  variantId: string | null
  image: string | null
  /** Case-type names for this device only, never the all-model image matrix. */
  imagesByCaseType: Record<string, string>
}

/** Only this page's selected device renders and exact add-to-cart variants. */
export async function getShopCards(
  handles: string[], deviceName: string, caseTypeName: string
): Promise<ShopCard[] | null> {
  if (!handles.length) return []
  const query = new URLSearchParams({
    handles: [...new Set(handles)].sort().join(","),
    device: deviceName,
    case_type: caseTypeName,
  })
  const data = await storeFetch<{ cards: ShopCard[] }>(`/store/shop-cards?${query}`)
  return Array.isArray(data?.cards) ? data.cards : null
}

export type ShopDesign = {
  slug: string
  name: string
  /** Case-type slugs this design is published in (armor-black, signature, …). */
  caseTypes: string[]
  /** Forms it is sold in (phone, airpods, …). */
  forms: string[]
}

/**
 * The light design list the shop grid renders from - no variants, no prices.
 * Cards get their price from the case type and their image from shopCardImage(),
 * so a 180-design shop never triggers a per-variant price calculation.
 */
export async function getShopCatalog(): Promise<ShopDesign[]> {
  const data = await storeFetch<{ designs: ShopDesign[] }>("/store/shop-catalog")
  return data?.designs ?? []
}

export type CaseTypeRecord = {
  slug: string
  name: string
  price: number
  description?: string | null
}

/** The active case types (constructions), in catalogue order, for the shop selectors. */
export async function getCaseTypes(): Promise<CaseTypeRecord[]> {
  const data = await storeFetch<{ case_types: any[] }>("/store/case-types")
  return (data?.case_types ?? []).map((c) => ({
    slug: c.slug,
    name: c.name,
    price: c.price,
    description: c.description ?? null,
  }))
}

/**
 * Availability per blank (case type x device), keyed "<Case Type>|<Device>".
 * Shared across every design, so this one number decides sold-out for a
 * (case type, device) everywhere.
 */
export async function getBlankStock(): Promise<Record<string, number>> {
  const data = await storeFetch<{ stock: Record<string, number> }>(
    "/store/stock"
  )
  return data?.stock ?? {}
}
