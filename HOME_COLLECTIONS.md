# Home page and collection pages

Both pages are assembled from admin-edited content (`modules/content`). Nothing
about their words, pictures, order or colours needs a deploy.

## Home page (Admin > Home page)

`home_section` rows render top to bottom through `components/home-sections.tsx`.
Section types and their `config` are listed in `modules/content/defaults.ts`
(`HOME_SECTION_TYPES`); `modules/content/home-sections.ts` cleans every config
before it is stored (known keys only, bounded lists, links and images limited to
`https://` URLs or `/paths`). The admin can add a section of any type, duplicate
one, delete, hide and reorder. New and copied sections start hidden.

- The hero is `components/hero-slider.tsx`: slide 1 is server-rendered with a
  priority image; later slides' pictures load after 2.5s. Autoplay stops on
  hover/focus, a hidden tab and reduced motion. No carousel library.
- Each `product_carousel` is priced separately (newest first, optionally one
  collection's), after choosing one phone card per design. Keep `/` static/ISR.
- `collection_grid` reads the collection cards that `/store/content` returns.

## Collection pages (Admin > Collection pages)

One `collection_page` row per `/collection/<slug>/`: a hero layout
(`template`: overlay, centered, image, split), a `theme` (page, hero and card
colours, card radius, headline size, hero decor) and `blocks` (banners/text
under the grid). Presets live in `modules/content/collection-templates.ts`; a new
page copies one, and "Duplicate" copies a page onto another collection, swapping
its name and links. Pages must target an existing Medusa collection or category
and start as drafts.

- `components/collection-shell.tsx` turns the theme into CSS variables. The
  product card reads `--fl-card-*` with its normal values as fallbacks, so
  `ProductCard` is unchanged and every other grid looks the same.
- The page browses one product form at a time (`?form=phone|airpods|...`); model
  choices stay inside that form's family, matching the shop's model scope.
  Banner links such as `?form=airpods#shop` jump to the grid.
- Full-bleed bands rely on `html, body { overflow-x: clip }`. Do not replace it
  with `hidden`: that makes a scroll container and breaks sticky panels.

## Images

florayn.com's campaign photos were copied with public GETs, converted to WebP
and stored in R2 under `site/` with content-hashed names
(`modules/content/site-images.ts`). New pictures are chosen or uploaded in the
admin through the R2 media picker. Only R2 and `img.florayn.com` go through the
Next optimizer (`components/art-image.tsx`); any other host is served as-is.
Phone crops use `<picture>`, so a phone downloads one image.

## Existing databases

`migration-scripts/home-and-collection-looks.ts` brings a store seeded earlier up
to date: pictures for items without one, the new sections, and template/theme/
imagery for pages never styled. It never overwrites a filled field and a second
run changes nothing. `Migration20260923120000` adds the columns idempotently.
