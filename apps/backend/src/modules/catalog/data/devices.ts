/**
 * The device catalogue, taken from the live florayn.com device list.
 *
 * This is the variant axis for every product in the store: a product is one
 * design in one case type, and its variants are the devices that case type
 * fits. Order here is the order devices appear in the storefront picker and in
 * the admin.
 *
 * Price is flat per case type and does not vary by device, so devices carry no
 * price of their own.
 */
export type DeviceFamily = "iphone" | "samsung" | "airpods" | "watch" | "wallet"

export type DeviceSeed = {
  slug: string
  name: string
  family: DeviceFamily
  brand: string
  sku_code: string
}

const IPHONE: DeviceSeed[] = [
  { slug: "iphone-11", name: "iPhone 11", sku_code: "IP11" },
  { slug: "iphone-11-pro", name: "iPhone 11 Pro", sku_code: "IP11P" },
  { slug: "iphone-11-pro-max", name: "iPhone 11 Pro Max", sku_code: "IP11PM" },
  { slug: "iphone-12-mini", name: "iPhone 12 Mini", sku_code: "IP12MN" },
  { slug: "iphone-12", name: "iPhone 12", sku_code: "IP12" },
  { slug: "iphone-12-pro", name: "iPhone 12 Pro", sku_code: "IP12P" },
  { slug: "iphone-12-pro-max", name: "iPhone 12 Pro Max", sku_code: "IP12PM" },
  { slug: "iphone-13-mini", name: "iPhone 13 Mini", sku_code: "IP13MN" },
  { slug: "iphone-13", name: "iPhone 13", sku_code: "IP13" },
  { slug: "iphone-13-pro", name: "iPhone 13 Pro", sku_code: "IP13P" },
  { slug: "iphone-13-pro-max", name: "iPhone 13 Pro Max", sku_code: "IP13PM" },
  { slug: "iphone-14", name: "iPhone 14", sku_code: "IP14" },
  { slug: "iphone-14-plus", name: "iPhone 14 Plus", sku_code: "IP14PL" },
  { slug: "iphone-14-pro", name: "iPhone 14 Pro", sku_code: "IP14P" },
  { slug: "iphone-14-pro-max", name: "iPhone 14 Pro Max", sku_code: "IP14PM" },
  { slug: "iphone-15", name: "iPhone 15", sku_code: "IP15" },
  { slug: "iphone-15-plus", name: "iPhone 15 Plus", sku_code: "IP15PL" },
  { slug: "iphone-15-pro", name: "iPhone 15 Pro", sku_code: "IP15P" },
  { slug: "iphone-15-pro-max", name: "iPhone 15 Pro Max", sku_code: "IP15PM" },
  // Spelled "16e", not "16E" - it is the entry model of the 16 family.
  { slug: "iphone-16e", name: "iPhone 16e", sku_code: "IP16E" },
  { slug: "iphone-16", name: "iPhone 16", sku_code: "IP16" },
  { slug: "iphone-16-plus", name: "iPhone 16 Plus", sku_code: "IP16PL" },
  { slug: "iphone-16-pro", name: "iPhone 16 Pro", sku_code: "IP16P" },
  { slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", sku_code: "IP16PM" },
  { slug: "iphone-17", name: "iPhone 17", sku_code: "IP17" },
  { slug: "iphone-17-air", name: "iPhone 17 Air", sku_code: "IP17AIR" },
  { slug: "iphone-17-pro", name: "iPhone 17 Pro", sku_code: "IP17P" },
  { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", sku_code: "IP17PM" },
].map((d) => ({ ...d, family: "iphone" as const, brand: "Apple" }))

// S22 and older are not stocked.
const SAMSUNG: DeviceSeed[] = [
  { slug: "samsung-s23", name: "Samsung S23", sku_code: "SGS23" },
  { slug: "samsung-s23-plus", name: "Samsung S23 Plus", sku_code: "SGS23PL" },
  { slug: "samsung-s23-ultra", name: "Samsung S23 Ultra", sku_code: "SGS23U" },
  { slug: "samsung-s24", name: "Samsung S24", sku_code: "SGS24" },
  { slug: "samsung-s24-plus", name: "Samsung S24 Plus", sku_code: "SGS24PL" },
  { slug: "samsung-s24-ultra", name: "Samsung S24 Ultra", sku_code: "SGS24U" },
  { slug: "samsung-s25", name: "Samsung S25", sku_code: "SGS25" },
  { slug: "samsung-s25-plus", name: "Samsung S25 Plus", sku_code: "SGS25PL" },
  { slug: "samsung-s25-ultra", name: "Samsung S25 Ultra", sku_code: "SGS25U" },
  { slug: "samsung-s26", name: "Samsung S26", sku_code: "SGS26" },
  { slug: "samsung-s26-plus", name: "Samsung S26 Plus", sku_code: "SGS26PL" },
  { slug: "samsung-s26-ultra", name: "Samsung S26 Ultra", sku_code: "SGS26U" },
].map((d) => ({ ...d, family: "samsung" as const, brand: "Samsung" }))

const AIRPODS: DeviceSeed[] = [
  // 1st and 2nd generation share a case shell, so they share one SKU.
  { slug: "airpods-1-2", name: "AirPods 1/2", sku_code: "APD12" },
  { slug: "airpods-3", name: "AirPods 3", sku_code: "APD3" },
  { slug: "airpods-4", name: "AirPods 4", sku_code: "APD4" },
  { slug: "airpods-pro", name: "AirPods Pro", sku_code: "APDP1" },
  { slug: "airpods-pro-2", name: "AirPods Pro 2", sku_code: "APDP2" },
  { slug: "airpods-pro-3", name: "AirPods Pro 3", sku_code: "APDP3" },
  { slug: "airpods-max", name: "AirPods Max", sku_code: "APDMAX" },
].map((d) => ({ ...d, family: "airpods" as const, brand: "Apple" }))

const ACCESSORIES: DeviceSeed[] = [
  {
    slug: "apple-watch-band",
    name: "Apple Watch Band",
    family: "watch" as const,
    brand: "Apple",
    sku_code: "AWB",
  },
  {
    slug: "card-wallet",
    name: "Card Wallet",
    family: "wallet" as const,
    brand: "Florayn",
    sku_code: "WALLET",
  },
  {
    slug: "magsafe-wallet",
    name: "MagSafe Wallet",
    family: "wallet" as const,
    brand: "Florayn",
    sku_code: "MSWALLET",
  },
]

export const DEVICES: DeviceSeed[] = [
  ...IPHONE,
  ...SAMSUNG,
  ...AIRPODS,
  ...ACCESSORIES,
]

export const DEVICE_COUNT = DEVICES.length

export const DEVICES_BY_FAMILY: Record<DeviceFamily, DeviceSeed[]> = {
  iphone: IPHONE,
  samsung: SAMSUNG,
  airpods: AIRPODS,
  watch: ACCESSORIES.filter((d) => d.family === "watch"),
  wallet: ACCESSORIES.filter((d) => d.family === "wallet"),
}
