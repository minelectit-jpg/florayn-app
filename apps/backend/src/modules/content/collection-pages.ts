/**
 * Seed content for the twelve collection landing pages.
 *
 * Ten of these exist on florayn.com as hand-built Elementor pages. They share
 * a structure but not a design, so what is carried over is their content -
 * heading, button, copy and campaign imagery - plus a template and theme that
 * echo each page's character (Van Gogh's night navy, Bug Life's moss green)
 * on one consistent layout, rather than ten one-off typographic treatments.
 *
 * Where florayn.com has no hero for a collection, `hero_image_url` stays null
 * and the page falls back to the collection's own artwork. `intro_copy` is
 * null where the live wording could not be read: writing replacement
 * marketing copy is the shop owner's call, not something to invent here.
 */

import {
  presetById,
  type CollectionBlock,
  type CollectionTheme,
  type HeroLayout,
} from "./collection-templates"
import { BUG_LIFE_DECOR, SITE_IMAGES as IMG } from "./site-images"

export type CollectionPageSeed = {
  collection_slug: string
  title?: string | null
  template?: HeroLayout
  theme?: CollectionTheme
  hero_eyebrow: string | null
  hero_heading: string
  hero_copy?: string | null
  cta_label: string
  cta_href: string | null
  intro_heading: string
  intro_copy: string | null
  hero_image_url?: string | null
  hero_mobile_image_url?: string | null
  card_image_url?: string | null
  blocks?: CollectionBlock[]
}

function look(presetId: string, overrides: Partial<CollectionTheme> = {}) {
  const preset = presetById(presetId)!
  return { template: preset.template, theme: { ...preset.theme, ...overrides } }
}

/** The AirPods band florayn.com runs under each collection's phone cases. */
function airpodsBanner(
  slug: string,
  heading: string,
  image: string,
  mobile: string | null = null
): CollectionBlock {
  return {
    type: "banner",
    eyebrow: "Match your case",
    heading,
    copy: null,
    image,
    mobile_image: mobile,
    cta_label: "Shop AirPods Cases",
    cta_href: `/collection/${slug}/?form=airpods#shop`,
  }
}

export const DEFAULT_COLLECTION_PAGES: CollectionPageSeed[] = [
  {
    collection_slug: "leopard",
    ...look("sand"),
    hero_eyebrow: "Meet The New",
    // The live heading reads "Leoapard Collection by Florayn" - a typo in the
    // hero of the page itself. Spelled correctly here.
    hero_heading: "Leopard Collection by Florayn",
    cta_label: "Shop Now",
    cta_href: null,
    intro_heading: "Leopard Phone Cases",
    intro_copy:
      "Florayn Leopard Collection — glossy finish with a bold, statement look, designed for everyday style and lasting protection.",
    hero_image_url: IMG.leopardHero,
    hero_mobile_image_url: IMG.leopardHeroMobile,
    card_image_url: IMG.leopardCard,
  },
  {
    collection_slug: "bug-life",
    ...look("forest", { decor: BUG_LIFE_DECOR }),
    hero_eyebrow: "Florayn",
    hero_heading: "Bug Life",
    hero_copy:
      "Hand-drawn beetles, bees and dragonflies pressed onto cases built to survive a drop.",
    cta_label: "Shop Bug Life",
    cta_href: null,
    intro_heading: "Bug Life Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.heroBugLife,
    hero_mobile_image_url: null,
    card_image_url: IMG.bugLifeCard,
    blocks: [airpodsBanner("bug-life", "Bug Life AirPods Cases", IMG.bugLifeAirpods)],
  },
  {
    collection_slug: "garage",
    ...look("noir"),
    hero_eyebrow: "Florayn Garage",
    hero_heading: "Take the long way home.",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Garage Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.garageHero,
    hero_mobile_image_url: IMG.garageHeroMobile,
  },
  {
    collection_slug: "van-gogh-dreams",
    ...look("midnight"),
    hero_eyebrow: "Florayn",
    hero_heading: "Van Gogh Dreams",
    hero_copy: "Carry a masterpiece in your hands.",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Van Gogh Dreams Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.heroVanGoghMobile,
    card_image_url: IMG.vanGoghCard,
    blocks: [airpodsBanner("van-gogh-dreams", "Van Gogh AirPods Cases", IMG.vanGoghAirpods)],
  },
  {
    collection_slug: "frequency",
    ...look("midnight", { accent: "#a78bfa", accent_text: "#0b1033" }),
    hero_eyebrow: "Meet The New",
    hero_heading: "Frequency",
    cta_label: "Shop the collection",
    cta_href: null,
    intro_heading: "Frequency Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "checkmate",
    ...look("noir", { accent: "#e8e4d9", accent_text: "#111111" }),
    template: "split",
    hero_eyebrow: "Meet The New",
    hero_heading: "Checkmate",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Checkmate Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.checkmateCard,
    card_image_url: IMG.checkmateCard,
  },
  {
    collection_slug: "wild-instinct",
    ...look("sand"),
    hero_eyebrow: "Meet The New",
    hero_heading: "Wild Instinct",
    cta_label: "Shop the collection",
    cta_href: null,
    intro_heading: "Wild Instinct Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "muse-marvel",
    ...look("lilac"),
    // The campaign image already carries "Muse Marvel Series" in 3D type.
    template: "image",
    hero_eyebrow: "Meet The New",
    hero_heading: "Muse Marvel",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Muse Marvel Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.museMarvelHero,
    hero_mobile_image_url: IMG.heroMuseMarvelMobile,
    card_image_url: IMG.museMarvelCard,
    blocks: [
      {
        type: "banner",
        eyebrow: "Built to take a hit",
        heading: "Muse Marvel Armor Cases",
        copy: null,
        image: IMG.bannerArmor,
        mobile_image: null,
        cta_label: "Shop Armor",
        cta_href: "/collection/muse-marvel/?case_type=Armor%20Clear#shop",
      },
      airpodsBanner("muse-marvel", "Muse Marvel AirPods Cases", IMG.bannerAirpods),
    ],
  },
  {
    collection_slug: "florayn-blooms",
    ...look("blossom"),
    hero_eyebrow: "New Collection",
    hero_heading: "Florayn Blooms",
    cta_label: "Shop Phone Case",
    cta_href: null,
    intro_heading: "Florayn Blooms Phone Cases",
    intro_copy: null,
    hero_image_url: IMG.bloomsHero,
    hero_mobile_image_url: IMG.bloomsHeroMobile,
    card_image_url: IMG.heroBloomsMobile,
    blocks: [
      airpodsBanner("florayn-blooms", "Florayn Blooms AirPods Cases", IMG.bloomsAirpods, IMG.bloomsAirpodsMobile),
    ],
  },
  {
    collection_slug: "alcantara",
    ...look("cream"),
    hero_eyebrow: "Meet The New",
    hero_heading: "Florayn Italian Alcantara Series",
    cta_label: "Shop Now",
    cta_href: null,
    intro_heading: "Alcantara Phone Cases",
    intro_copy:
      "Florayn Premium Italian Alcantara® material with a soft, luxurious feel and refined everyday style.",
    hero_image_url: IMG.alcantaraHero,
    card_image_url: IMG.alcantaraCard,
  },
  // These two have no landing page on the live site. They get the same
  // template so nothing 404s; the copy is for the owner to write.
  {
    collection_slug: "fruit-punch",
    ...look("blossom", { accent: "#f2542d" }),
    hero_eyebrow: "Meet The New",
    hero_heading: "Fruit Punch",
    cta_label: "Shop Fruit Punch",
    cta_href: null,
    intro_heading: "Fruit Punch Phone Cases",
    intro_copy: null,
  },
  {
    collection_slug: "stripes",
    ...look("classic"),
    hero_eyebrow: "Meet The New",
    hero_heading: "Stripes",
    cta_label: "Shop Stripes",
    cta_href: null,
    intro_heading: "Stripes Phone Cases",
    intro_copy: null,
  },
]
