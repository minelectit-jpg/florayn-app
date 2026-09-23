/**
 * Who each design is for, read from florayn.com's "Gender" product attribute
 * (public WooCommerce Store API, 2026-09-24). Designs tagged both Men and
 * Women there are left out: untagged means both. Only the one-off
 * men-mode-2026-09-24 migration script reads this; afterwards the owner sets
 * it per design in the Product Manager ("Shown for").
 */
export const MEN_DESIGNS: string[] = [
  "alien-abduction", "amplitude", "blackout", "cobalt-nova", "cow-hide", "croc-scale",
  "dalmatian-dot", "drift-dynasty", "evergreen", "frostbite", "gear-heads", "giraffe-earth",
  "hertz", "jade-coil", "legends", "leopard-spots", "midnight-riders", "no-limits", "oscillate",
  "oxblood", "phase", "pulse", "purple-reign", "rebel-society", "redshift", "reverb", "riptide",
  "safari-dusk", "signal", "sonar", "static", "sunburst", "tiger-ash", "timeless", "tremor",
  "two-wheels", "vertigo", "waveform", "wavelength", "zebra-rust", "zebra-shadow", "zebra-stark",
]

export const WOMEN_DESIGNS: string[] = [
  "alcantara-dirty-pink", "ant-stripes", "banana-bliss", "berry-pop", "blackberry-pinstripe",
  "blue-belle", "blush-leopard", "blush-poppy", "caterpillar-maze", "cherry-cordial",
  "cherry-swirl", "citrus-splash", "classic-leopard", "clover-field", "coco-vibe", "coral-crush",
  "crimson-pop", "date-night", "emerald-muse", "floral-leopard", "floral-pop", "forest-poppy",
  "golden-hour", "good-things-are-coming", "green-lotus", "heartbeat", "heartstorm", "honey-glow",
  "honeycomb-bee", "indigo-leopard", "jackfruit-jungle", "lemon-drip", "lemon-drop", "lilac-dream",
  "lime-sorbet", "look-for-the-good", "love-is-simple", "love-notes", "love-spell", "lychee-love",
  "mango-stamp", "mauve-mood", "mauve-poppy", "midnight-sprinkle", "mint-melt", "mint-muse",
  "misty-poppy", "mocha-dot", "moon-kiss", "moth-dust", "night-hibiscus", "night-out", "noir-bold",
  "orchid-leopard", "peach-blossom", "peppermint-twist", "pineapple-bloom", "pink-lemonade",
  "pink-muse", "pink-plumeria", "positive-heart", "pure-heart", "raspberry-ripple", "red-lily",
  "rose-fizz", "ruby-poppy", "sahara-leopard", "sandstone-poppy", "self-love", "shadow-leopard",
  "silver-haze", "snow-speckle", "soft-ivory-mist", "strawberry-blush", "strawberry-melt",
  "sweet-crush", "tiny-hearts", "violet-veil", "watermelon-crush", "white-magnolia", "wild-orchid",
  "winter-poppy", "yellow-marigold",
]

/** StickPad colours that florayn.com lists for women only. */
export const WOMEN_STICKPAD_COLORS = ["Magenta", "Sky Blue", "Pink", "Cyan"]
