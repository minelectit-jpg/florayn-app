/**
 * Bangladesh delivery geography and the shipping rules that depend on it.
 *
 * The storefront reads this through GET /store/districts so the dropdown and
 * the backend can never disagree about which districts exist or what delivery
 * costs. Shipping is always priced server-side at checkout - the client sends a
 * district, never a price.
 */

/** All 64 districts, alphabetical. */
export const DISTRICTS = [
  "Bagerhat",
  "Bandarban",
  "Barguna",
  "Barisal",
  "Bhola",
  "Bogura",
  "Brahmanbaria",
  "Chandpur",
  "Chapainawabganj",
  "Chattogram",
  "Chuadanga",
  "Cox's Bazar",
  "Cumilla",
  "Dhaka",
  "Dinajpur",
  "Faridpur",
  "Feni",
  "Gaibandha",
  "Gazipur",
  "Gopalganj",
  "Habiganj",
  "Jamalpur",
  "Jashore",
  "Jhalokati",
  "Jhenaidah",
  "Joypurhat",
  "Khagrachhari",
  "Khulna",
  "Kishoreganj",
  "Kurigram",
  "Kushtia",
  "Lakshmipur",
  "Lalmonirhat",
  "Madaripur",
  "Magura",
  "Manikganj",
  "Meherpur",
  "Moulvibazar",
  "Munshiganj",
  "Mymensingh",
  "Naogaon",
  "Narail",
  "Narayanganj",
  "Narsingdi",
  "Natore",
  "Netrokona",
  "Nilphamari",
  "Noakhali",
  "Pabna",
  "Panchagarh",
  "Patuakhali",
  "Pirojpur",
  "Rajbari",
  "Rajshahi",
  "Rangamati",
  "Rangpur",
  "Satkhira",
  "Shariatpur",
  "Sherpur",
  "Sirajganj",
  "Sunamganj",
  "Sylhet",
  "Tangail",
  "Thakurgaon",
] as const

export type District = (typeof DISTRICTS)[number]

export const DISTRICT_COUNT = DISTRICTS.length

/**
 * Only Dhaka district is charged the inside-Dhaka rate. Gazipur and
 * Narayanganj are adjacent and often lumped in, but they are separate
 * districts and are charged the outside rate.
 */
export const INSIDE_DHAKA_DISTRICTS: string[] = ["Dhaka"]

export const SHIPPING = {
  insideDhaka: 70,
  outsideDhaka: 130,
  /** Order subtotal, in BDT, at or above which delivery is free. */
  freeThreshold: 2000,
} as const

export type ShippingZone = "inside-dhaka" | "outside-dhaka"

export function zoneForDistrict(district: string): ShippingZone {
  return INSIDE_DHAKA_DISTRICTS.includes(district)
    ? "inside-dhaka"
    : "outside-dhaka"
}

export function isDistrict(value: string): boolean {
  return (DISTRICTS as readonly string[]).includes(value)
}

export function shippingCost(district: string, subtotal: number): number {
  if (subtotal >= SHIPPING.freeThreshold) {
    return 0
  }
  return zoneForDistrict(district) === "inside-dhaka"
    ? SHIPPING.insideDhaka
    : SHIPPING.outsideDhaka
}

/**
 * Bangladeshi mobile numbers: 11 digits, always 01 followed by an operator
 * digit of 3-9 (013 GP, 014 Banglalink, 015 Teletalk, 016 Airtel, 017 GP,
 * 018 Robi, 019 Banglalink).
 */
export const PHONE_PATTERN = /^01[3-9]\d{8}$/

export function normalizePhone(value: string): string {
  let digits = value.replace(/[^\d]/g, "")
  // Accept +8801XXXXXXXXX and 8801XXXXXXXXX as well.
  if (digits.startsWith("880")) {
    digits = digits.slice(3)
  }
  if (digits.length === 10 && digits.startsWith("1")) {
    digits = `0${digits}`
  }
  return digits
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(value))
}

/**
 * Shipping option names created by the seed. The checkout route looks options
 * up by name, so these are the contract between the seed and checkout.
 */
export const SHIPPING_OPTION_NAMES: Record<ShippingZone, { paid: string; free: string }> = {
  "inside-dhaka": {
    paid: "Inside Dhaka",
    free: "Inside Dhaka (Free delivery)",
  },
  "outside-dhaka": {
    paid: "Outside Dhaka",
    free: "Outside Dhaka (Free delivery)",
  },
}
