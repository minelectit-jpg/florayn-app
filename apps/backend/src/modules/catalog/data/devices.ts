/**
 * The device catalogue. This is the variant axis for every product in the
 * store: a product is one design in one case type, and its variants are the
 * devices that case type fits.
 *
 * Order in this array is the order devices appear in the storefront picker and
 * in the admin, so keep families grouped and newest-first within a family.
 *
 * `price_delta` is added to the case type's `base_price` to get the variant
 * price, in BDT. Bigger and newer devices cost more to tool for.
 */
export type DeviceFamily = "iphone" | "samsung" | "airpods" | "watch" | "wallet"

export type DeviceSeed = {
  slug: string
  name: string
  family: DeviceFamily
  brand: string
  sku_code: string
  price_delta: number
}

const IPHONE: DeviceSeed[] = [
  { slug: "iphone-17-pro-max", name: "iPhone 17 Pro Max", sku_code: "IP17PM", price_delta: 600 },
  { slug: "iphone-17-pro", name: "iPhone 17 Pro", sku_code: "IP17P", price_delta: 450 },
  { slug: "iphone-17-air", name: "iPhone 17 Air", sku_code: "IP17AIR", price_delta: 500 },
  { slug: "iphone-17", name: "iPhone 17", sku_code: "IP17", price_delta: 300 },
  { slug: "iphone-16-pro-max", name: "iPhone 16 Pro Max", sku_code: "IP16PM", price_delta: 450 },
  { slug: "iphone-16-pro", name: "iPhone 16 Pro", sku_code: "IP16P", price_delta: 300 },
  { slug: "iphone-16-plus", name: "iPhone 16 Plus", sku_code: "IP16PL", price_delta: 300 },
  { slug: "iphone-16", name: "iPhone 16", sku_code: "IP16", price_delta: 150 },
  { slug: "iphone-16e", name: "iPhone 16e", sku_code: "IP16E", price_delta: 50 },
  { slug: "iphone-15-pro-max", name: "iPhone 15 Pro Max", sku_code: "IP15PM", price_delta: 300 },
  { slug: "iphone-15-pro", name: "iPhone 15 Pro", sku_code: "IP15P", price_delta: 150 },
  { slug: "iphone-15-plus", name: "iPhone 15 Plus", sku_code: "IP15PL", price_delta: 150 },
  { slug: "iphone-15", name: "iPhone 15", sku_code: "IP15", price_delta: 0 },
  { slug: "iphone-14-pro-max", name: "iPhone 14 Pro Max", sku_code: "IP14PM", price_delta: 200 },
  { slug: "iphone-14-pro", name: "iPhone 14 Pro", sku_code: "IP14P", price_delta: 50 },
  { slug: "iphone-14-plus", name: "iPhone 14 Plus", sku_code: "IP14PL", price_delta: 50 },
  { slug: "iphone-14", name: "iPhone 14", sku_code: "IP14", price_delta: -100 },
  { slug: "iphone-13-pro-max", name: "iPhone 13 Pro Max", sku_code: "IP13PM", price_delta: 100 },
  { slug: "iphone-13-pro", name: "iPhone 13 Pro", sku_code: "IP13P", price_delta: -50 },
  { slug: "iphone-13", name: "iPhone 13", sku_code: "IP13", price_delta: -200 },
  { slug: "iphone-13-mini", name: "iPhone 13 mini", sku_code: "IP13MN", price_delta: -300 },
  { slug: "iphone-12-pro-max", name: "iPhone 12 Pro Max", sku_code: "IP12PM", price_delta: 50 },
  { slug: "iphone-12-pro", name: "iPhone 12 Pro", sku_code: "IP12P", price_delta: -100 },
  { slug: "iphone-12", name: "iPhone 12", sku_code: "IP12", price_delta: -250 },
  { slug: "iphone-12-mini", name: "iPhone 12 mini", sku_code: "IP12MN", price_delta: -350 },
  { slug: "iphone-11-pro-max", name: "iPhone 11 Pro Max", sku_code: "IP11PM", price_delta: 0 },
  { slug: "iphone-11-pro", name: "iPhone 11 Pro", sku_code: "IP11P", price_delta: -150 },
  { slug: "iphone-11", name: "iPhone 11", sku_code: "IP11", price_delta: -300 },
  { slug: "iphone-se-2022", name: "iPhone SE (2022)", sku_code: "IPSE3", price_delta: -300 },
  { slug: "iphone-se-2020", name: "iPhone SE (2020)", sku_code: "IPSE2", price_delta: -300 },
].map((d) => ({ ...d, family: "iphone" as const, brand: "Apple" }))

const SAMSUNG: DeviceSeed[] = [
  { slug: "galaxy-s25-ultra", name: "Galaxy S25 Ultra", sku_code: "SGS25U", price_delta: 400 },
  { slug: "galaxy-s25-plus", name: "Galaxy S25+", sku_code: "SGS25PL", price_delta: 250 },
  { slug: "galaxy-s25-edge", name: "Galaxy S25 Edge", sku_code: "SGS25E", price_delta: 200 },
  { slug: "galaxy-s25", name: "Galaxy S25", sku_code: "SGS25", price_delta: 100 },
  { slug: "galaxy-s24-ultra", name: "Galaxy S24 Ultra", sku_code: "SGS24U", price_delta: 250 },
  { slug: "galaxy-s24-plus", name: "Galaxy S24+", sku_code: "SGS24PL", price_delta: 100 },
  { slug: "galaxy-s24-fe", name: "Galaxy S24 FE", sku_code: "SGS24FE", price_delta: -100 },
  { slug: "galaxy-s24", name: "Galaxy S24", sku_code: "SGS24", price_delta: -50 },
  { slug: "galaxy-s23-ultra", name: "Galaxy S23 Ultra", sku_code: "SGS23U", price_delta: 150 },
  { slug: "galaxy-s23-plus", name: "Galaxy S23+", sku_code: "SGS23PL", price_delta: 0 },
  { slug: "galaxy-s23-fe", name: "Galaxy S23 FE", sku_code: "SGS23FE", price_delta: -200 },
  { slug: "galaxy-s23", name: "Galaxy S23", sku_code: "SGS23", price_delta: -150 },
  { slug: "galaxy-s22-ultra", name: "Galaxy S22 Ultra", sku_code: "SGS22U", price_delta: 50 },
  { slug: "galaxy-s22-plus", name: "Galaxy S22+", sku_code: "SGS22PL", price_delta: -100 },
  { slug: "galaxy-s22", name: "Galaxy S22", sku_code: "SGS22", price_delta: -250 },
].map((d) => ({ ...d, family: "samsung" as const, brand: "Samsung" }))

const AIRPODS: DeviceSeed[] = [
  { slug: "airpods-pro-3", name: "AirPods Pro 3", sku_code: "APDP3", price_delta: -350 },
  { slug: "airpods-pro-2", name: "AirPods Pro 2", sku_code: "APDP2", price_delta: -400 },
  { slug: "airpods-pro", name: "AirPods Pro", sku_code: "APDP1", price_delta: -450 },
  { slug: "airpods-max", name: "AirPods Max", sku_code: "APDMAX", price_delta: 200 },
  { slug: "airpods-4", name: "AirPods 4", sku_code: "APD4", price_delta: -400 },
  { slug: "airpods-3", name: "AirPods 3", sku_code: "APD3", price_delta: -450 },
  { slug: "airpods-2", name: "AirPods 2", sku_code: "APD2", price_delta: -500 },
  { slug: "airpods-1", name: "AirPods 1", sku_code: "APD1", price_delta: -500 },
].map((d) => ({ ...d, family: "airpods" as const, brand: "Apple" }))

const WATCH: DeviceSeed[] = [
  { slug: "apple-watch-band-49mm", name: "Apple Watch Band 49mm", sku_code: "AWB49", price_delta: -300 },
  { slug: "apple-watch-band-46mm", name: "Apple Watch Band 46mm", sku_code: "AWB46", price_delta: -320 },
  { slug: "apple-watch-band-45mm", name: "Apple Watch Band 45mm", sku_code: "AWB45", price_delta: -330 },
  { slug: "apple-watch-band-44mm", name: "Apple Watch Band 44mm", sku_code: "AWB44", price_delta: -350 },
  { slug: "apple-watch-band-42mm", name: "Apple Watch Band 42mm", sku_code: "AWB42", price_delta: -350 },
  { slug: "apple-watch-band-41mm", name: "Apple Watch Band 41mm", sku_code: "AWB41", price_delta: -380 },
  { slug: "apple-watch-band-40mm", name: "Apple Watch Band 40mm", sku_code: "AWB40", price_delta: -400 },
  { slug: "apple-watch-band-38mm", name: "Apple Watch Band 38mm", sku_code: "AWB38", price_delta: -400 },
].map((d) => ({ ...d, family: "watch" as const, brand: "Apple" }))

const WALLET: DeviceSeed[] = [
  { slug: "card-wallet", name: "Card Wallet", sku_code: "WALLET", price_delta: -600 },
].map((d) => ({ ...d, family: "wallet" as const, brand: "Florayn" }))

export const DEVICES: DeviceSeed[] = [
  ...IPHONE,
  ...SAMSUNG,
  ...AIRPODS,
  ...WATCH,
  ...WALLET,
]

export const DEVICE_COUNT = DEVICES.length

export const DEVICES_BY_FAMILY: Record<DeviceFamily, DeviceSeed[]> = {
  iphone: IPHONE,
  samsung: SAMSUNG,
  airpods: AIRPODS,
  watch: WATCH,
  wallet: WALLET,
}
