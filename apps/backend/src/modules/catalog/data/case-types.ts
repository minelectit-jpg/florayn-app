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
  /**
   * The price in BDT. Price is flat per case type - it does not vary by
   * device, so this is the price of every variant of every product built in
   * this construction.
   */
  price: number
  fits_families: DeviceFamily[]
  /** Device slugs this construction is not tooled for. */
  excludes_devices?: string[]
}

// Ordered cheapest first; this is also the order they appear in the admin.
export const CASE_TYPES: CaseTypeSeed[] = [
  {
    slug: "essentials",
    name: "Essentials",
    description:
      "A slim flexible shell with a soft-touch finish. The everyday case, and the widest device coverage we offer.",
    sku_code: "ESS",
    price: 1400,
    fits_families: ["iphone", "samsung", "airpods"],
  },
  {
    slug: "signature",
    name: "Signature",
    description:
      "Our full-wrap print finish, available across phones, AirPods, watch bands and wallets.",
    sku_code: "SIG",
    price: 1400,
    fits_families: ["iphone", "samsung", "airpods", "watch", "wallet"],
  },
  {
    slug: "elite-clear",
    name: "Elite Clear",
    description:
      "Optically clear polycarbonate with a hardened anti-scratch coat, cut thin enough to disappear.",
    sku_code: "ELTCLR",
    price: 1600,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "armor-black",
    name: "Armor Black",
    description:
      "Dual-layer drop protection in a matte black frame. Raised lips over the camera and screen.",
    sku_code: "ARMBLK",
    price: 1950,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "armor-clear",
    name: "Armor Clear",
    description:
      "Shock-absorbing bumper with a rigid clear back that holds the artwork without yellowing.",
    sku_code: "ARMCLR",
    price: 1950,
    fits_families: ["iphone", "samsung"],
  },
  {
    slug: "alcantara",
    name: "Alcantara",
    description:
      "Italian Alcantara bonded to a rigid core. Warm to hold, and it does not slip out of a pocket.",
    sku_code: "ALC",
    // Alcantara varies by device in the real store; held flat here until the
    // per-device figures are confirmed.
    price: 3800,
    fits_families: ["iphone", "samsung", "airpods", "wallet"],
    // Alcantara tooling was never cut for the small and oldest bodies.
    excludes_devices: [
      "iphone-11",
      "iphone-11-pro",
      "iphone-11-pro-max",
      "iphone-12-mini",
      "iphone-13-mini",
      "airpods-1-2",
    ],
  },
]
