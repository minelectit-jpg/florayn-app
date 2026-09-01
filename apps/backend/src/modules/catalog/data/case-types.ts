import type { DeviceFamily } from "./devices"

/**
 * The six case constructions Florayn sells. A design is published once per case
 * type it is offered in, and each of those is a separate product.
 *
 * `fits_families` plus `excludes_devices` is what decides a product's variant
 * list at seed time, so this is where device compatibility is maintained.
 */
export type CaseTypeSeed = {
  slug: string
  name: string
  description: string
  sku_code: string
  /** Floor price in BDT, before the device's `price_delta`. */
  base_price: number
  fits_families: DeviceFamily[]
  /** Device slugs this construction is not tooled for. */
  excludes_devices?: string[]
}

export const CASE_TYPES: CaseTypeSeed[] = [
  {
    slug: "essentials",
    name: "Essentials",
    description:
      "A slim flexible shell with a soft-touch finish. The everyday case, and the widest device coverage we offer.",
    sku_code: "ESS",
    base_price: 1290,
    fits_families: ["iphone", "samsung", "airpods"],
  },
  {
    slug: "armor-clear",
    name: "Armor Clear",
    description:
      "Shock-absorbing bumper with a rigid clear back that holds the artwork without yellowing.",
    sku_code: "ARMCLR",
    base_price: 1690,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "armor-black",
    name: "Armor Black",
    description:
      "Dual-layer drop protection in a matte black frame. Raised lips over the camera and screen.",
    sku_code: "ARMBLK",
    base_price: 1790,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "elite-clear",
    name: "Elite Clear",
    description:
      "Optically clear polycarbonate with a hardened anti-scratch coat, cut thin enough to disappear.",
    sku_code: "ELTCLR",
    base_price: 1990,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "signature",
    name: "Signature",
    description:
      "Our full-wrap print finish, available across phones, AirPods, watch bands and wallets.",
    sku_code: "SIG",
    base_price: 2290,
    fits_families: ["iphone", "samsung", "airpods", "watch", "wallet"],
  },
  {
    slug: "alcantara",
    name: "Alcantara",
    description:
      "Italian Alcantara bonded to a rigid core. Warm to hold, and it does not slip out of a pocket.",
    sku_code: "ALC",
    base_price: 2990,
    fits_families: ["iphone", "samsung", "airpods", "wallet"],
    // Alcantara tooling was never cut for the small and discontinued bodies.
    excludes_devices: [
      "iphone-11",
      "iphone-11-pro",
      "iphone-11-pro-max",
      "iphone-12-mini",
      "iphone-13-mini",
      "iphone-se-2020",
      "iphone-se-2022",
      "airpods-1",
      "airpods-2",
    ],
  },
]
