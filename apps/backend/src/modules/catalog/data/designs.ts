/**
 * Sample designs. In production this table is the artwork library (~189 rows);
 * these five exist so the admin and storefront have something to render.
 *
 * `case_types` lists the case-type slugs this artwork is published in. One
 * product is created per entry, so five designs here produce 21 products.
 */
export type DesignSeed = {
  slug: string
  name: string
  description: string
  theme: string
  artist: string
  sku_code: string
  case_types: string[]
}

export const DESIGNS: DesignSeed[] = [
  {
    slug: "caterpillar-maze",
    name: "Caterpillar Maze",
    description:
      "A single unbroken line folds back on itself until it reads as a body in motion. Printed edge to edge so the maze runs off the sides of the case.",
    theme: "Abstract",
    artist: "Florayn Studio",
    sku_code: "CATMAZE",
    case_types: [
      "essentials",
      "armor-clear",
      "armor-black",
      "elite-clear",
      "signature",
      "alcantara",
    ],
  },
  {
    slug: "midnight-bloom",
    name: "Midnight Bloom",
    description:
      "Night-flowering jasmine painted in ink and picked out in pale gold against a deep indigo ground.",
    theme: "Floral",
    artist: "Nusrat Jahan",
    sku_code: "MIDBLM",
    case_types: ["essentials", "elite-clear", "signature", "alcantara"],
  },
  {
    slug: "dhaka-rickshaw",
    name: "Dhaka Rickshaw",
    description:
      "Rickshaw-panel painting in its original palette: hot pink, marigold and cobalt, framed the way the panel painters frame it.",
    theme: "Heritage",
    artist: "Rafiq Hasan",
    sku_code: "DHKRIK",
    case_types: ["essentials", "armor-clear", "armor-black", "signature"],
  },
  {
    slug: "tidal-glass",
    name: "Tidal Glass",
    description:
      "Layered translucent washes that shift from sea green to slate depending on the light, built for the clear constructions.",
    theme: "Abstract",
    artist: "Florayn Studio",
    sku_code: "TIDGLS",
    case_types: ["essentials", "armor-clear", "elite-clear"],
  },
  {
    slug: "sundarbans-tiger",
    name: "Sundarbans Tiger",
    description:
      "A Royal Bengal tiger half-hidden in mangrove roots, drawn in heavy brush and left mostly in shadow.",
    theme: "Wildlife",
    artist: "Tanvir Alam",
    sku_code: "SUNTIG",
    case_types: ["essentials", "armor-black", "signature", "alcantara"],
  },
]
