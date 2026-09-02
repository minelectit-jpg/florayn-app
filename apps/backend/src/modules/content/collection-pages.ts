/**
 * Seed content for the twelve collection landing pages.
 *
 * Ten of these exist on florayn.com as hand-built Elementor pages. They share
 * a structure but not a design, so what is carried over is their content -
 * heading, button, and the intro copy where it was readable - rather than
 * their wildly varying typography.
 *
 * `hero_image_url` is deliberately left null almost everywhere. The live
 * heroes are one-off marketing renders that are not in the product image set,
 * and several pages reuse a shared theme asset rather than a real hero. Null
 * makes the template fall back to the collection's own artwork, which looks
 * right immediately; the admin can point it at a real hero later.
 *
 * `intro_copy` is null where the live wording could not be read out of the
 * Elementor markup. Writing replacement marketing copy is the shop owner's
 * call, not something to invent here.
 */

export type CollectionPageSeed = {
  collection_slug: string
  hero_eyebrow: string | null
  hero_heading: string
  cta_label: string
  cta_href: string | null
  intro_heading: string
  intro_copy: string | null
  hero_image_url?: string | null
}

export const DEFAULT_COLLECTION_PAGES: CollectionPageSeed[] = [
  {
    collection_slug: "leopard",
    hero_eyebrow: "Meet The New",
    // The live heading reads "Leoapard Collection by Florayn" - a typo in the
    // hero of the page itself. Spelled correctly here.
    hero_heading: "Leopard Collection by Florayn",
    cta_label: "Shop Now",
    cta_href: null,
    intro_heading: "Leopard Phone Cases",
    intro_copy:
      "Florayn Leopard Collection — glossy finish with a bold, statement look, designed for everyday style and lasting protection.",
  },
  {
    collection_slug: "bug-life",
    hero_eyebrow: "Bug Life",
    hero_heading: "Bug Life",
    cta_label: "Shop Bug Life",
    cta_href: null,
    intro_heading: "Bug Life Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "garage",
    hero_eyebrow: "Florayn Garage",
    hero_heading: "Take the long way home.",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Garage Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "van-gogh-dreams",
    hero_eyebrow: "Meet The New",
    hero_heading: "Van Gogh Dreams",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Van Gogh Dreams Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "frequency",
    hero_eyebrow: "Meet The New",
    hero_heading: "Frequency",
    cta_label: "Shop the collection",
    cta_href: null,
    intro_heading: "Frequency Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "checkmate",
    hero_eyebrow: "Meet The New",
    hero_heading: "Checkmate",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Checkmate Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "wild-instinct",
    hero_eyebrow: "Meet The New",
    hero_heading: "Wild Instinct",
    cta_label: "Shop the collection",
    cta_href: null,
    intro_heading: "Wild Instinct Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "muse-marvel",
    hero_eyebrow: "Meet The New",
    hero_heading: "Muse Marvel",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Muse Marvel Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "florayn-blooms",
    hero_eyebrow: "Meet The New",
    hero_heading: "Florayn Blooms",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Florayn Blooms Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "alcantara",
    hero_eyebrow: "Meet The New",
    hero_heading: "Florayn Italian Alcantara Series",
    cta_label: "Shop Now",
    cta_href: null,
    intro_heading: "Alcantara Phone Cases",
    intro_copy:
      "Florayn Premium Italian Alcantara® material with a soft, luxurious feel and refined everyday style.",
  },
  // These two have no landing page on the live site. They get the same
  // template so nothing 404s; the copy is for the owner to write.
  {
    collection_slug: "fruit-punch",
    hero_eyebrow: "Meet The New",
    hero_heading: "Fruit Punch",
    cta_label: "Shop Fruit Punch",
    cta_href: null,
    intro_heading: "Fruit Punch Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "stripes",
    hero_eyebrow: "Meet The New",
    hero_heading: "Stripes",
    cta_label: "Shop Stripes",
    cta_href: null,
    intro_heading: "Stripes Phone Cases",
    intro_copy: null,
  },
]
