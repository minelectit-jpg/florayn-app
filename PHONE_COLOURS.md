# Phone colour pictures

Shoppers can pick the phone colour (Silver, Black, Burgundy, Glacier for the
iPhone 18 Pro Max) on the product page and in the shop, and the pictures
change. The phone colour only changes which picture is shown: the case is the
same for every phone colour, so nothing about what is sold changes.

This file holds the rules and the backend contract. The console (Mockup Studio),
Product Manager and storefront parts add their own sections below.

## Invariants

1. Phone colour never becomes a Medusa option, variant, SKU, price, stock key,
   line-item metadata, tracking dimension or feed item. Variants stay case type x
   device, blank stock stays shared by `<Case Type>|<Device>`, and there is one
   global price per case type (PRODUCT_MANAGER.md invariants 1 to 3).
2. `variant.metadata.images` is always the variant's **main** gallery, so every
   existing reader keeps working unchanged: `buildCard` and `metadata.card`,
   shop cards, More designs, packs and Quick Add, checkout `quoteFromCart`, the
   order summary and Steadfast, the Meta/Google catalog feed, manual
   recommendations, `getDesignDetail`, Product Manager and the product-page
   fallback.
3. Colour galleries live only in the `phone_colour_gallery` table. They never go
   into `product.images` (recomputed by `saveManagedVariantsWorkflow` and the
   media route), `product.metadata` (bulk-read and read-modify-written by
   `rebuildCards`) or `variant.metadata` (sent to the browser and scanned by the
   feed and card builders).
4. Mockup Studio sends colour renders only for `settings.case_type`
   (MOCKUP_STUDIO.md rule 4). The table accepts any case type, so Product
   Manager can add manual colour pictures later.
5. Readers always fall back to the main images. A colour never hides, filters,
   sorts or reprices a product.
6. Image URLs are immutable: every upload gets a new ULID key. Nothing on R2 is
   overwritten and the Next image cache is never cleared.
7. Editing and re-publishing keep product, variant and option IDs. Never delete
   and recreate a design to change its pictures.

## Data

**Palette: the Mockup sets** (store metadata `florayn_mockups`,
`src/lib/mockup-settings.ts`). A set's `colours` are the shopper-facing names in
palette order, `default_colour` is the model's default (main) phone colour and
the shop's colour-less view, and the optional `swatches` maps a colour name to
`#rrggbb` (saved lower-case). A missing hex falls back to `SWATCH_SUGGESTIONS`
(the console's `SWATCH` list; keep them in step), then `#c9c9cf`. `enabled` is
Studio's on/off only: the storefront ignores it.

A colour's **web name** is `colourSlug(name)` ("Deep Blue" -> `deep-blue`),
exactly the console's `slugify`. It is the key in the table, the URLs and the
API, and matches `COLOUR_SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,39}$/`: it
starts with a letter, so a shop page number is never read as a colour. Saving a
set refuses two colours with one web name ("Mockup set 3: two colours make the
same web name (deep-blue). Rename one."), a colour whose web name does not
start with a letter, and a colour named "Constructor" (`constructor` is a key
every plain object already has, so a slug-keyed map would read a function).
Sets saved before these checks still load; readers skip their clashing,
invalid or reserved colours (`setPalette`), and the storefront and console
readers never read an inherited key (an array check on inline pictures, a
null-prototype map for lazy ones, own-key swatch lookups).

**Galleries: `phone_colour_gallery`** (catalog module, migration
`Migration20261016124443`, additive). One row per (variant, phone colour):
`product_id`, `variant_id`, `device_slug`, `case_type_slug` (copied from the
variant's metadata), `colour_slug`, `is_main`, `images` (`text[]`, null on the
main row), `source` (`mockup_studio` | `manual`). Unique (variant, colour) and
at most one main row per variant (`IDX_phone_colour_gallery_one_main`). No module
link, like `gallery_video`: store reads intersect rows with the product's live,
published variants, so rows left by a deleted variant are inert.

| Rows for a variant | Meaning |
|---|---|
| none | Colour unknown (every legacy and hand-made pair). No selector. |
| 1 main row (X) | The main gallery is X. No selector (one colour). |
| main X + rows Y, Z | The selector shows X, Y, Z (main first, then palette order). |
| extra rows without a main row | Never written; readers ignore the variant. |

A variant shows colours only when its main row's colour is in its model's
palette and at least one other of its colours is too. Colours dropped from a
palette (a new layer version under another folder name) simply disappear.

## Backend API

### Admin (signed in)

**`POST /admin/designs/:slug/colours`** (`savePhoneColourGalleriesWorkflow`,
`src/workflows/phone-colours.ts`; input rules in `src/lib/phone-colour-input.ts`).

```json
{ "source": "mockup_studio",
  "variants": [
    { "caseType": "signature", "device": "iphone-18-pro-max", "main": "black",
      "galleries": { "silver": ["https://img.florayn.com/..."], "glacier": ["..."] }, "replace": true },
    { "variantId": "variant_01K...", "main": "silver", "galleries": {}, "replace": true }
  ] }
```

- `source` defaults to `manual`. 1 to 100 variants, each addressed by
  `variantId` **or** (`caseType`, `device`) slugs, never both, each once.
- `main` and every `galleries` key are web names in that model's palette; at
  most 11 extra colours; `main` is never a `galleries` key; each gallery is 1 to
  30 HTTPS URLs (at most 2,048 characters). `galleries` defaults to `{}` (a
  single-colour model sends only the main marker). `replace` defaults to false.
- The variant must belong to the design (same ownership as `getDesignDetail`)
  and its model must have a Mockup set.
- Writes: the main row is written or moved (only one is kept), extra rows are
  created or updated, and with `replace` the variant's unlisted rows are
  hard-deleted. An unlisted old main row of another colour is always removed.
  The same body twice gives the same rows. A save is one transaction, one at a
  time per variant (`CatalogModuleService.savePhoneColourRows`: a
  per-variant `pg_advisory_xact_lock` in variant ID order, then the read, the
  plan and the writes): a failure changes nothing, and a retry that overlaps
  the first request (or Product Manager and Studio saving together) waits for
  it. A wait longer than 30 s fails (`lock_timeout`).
- 200 `{ "saved": 3, "removed": 0, "warnings": ["iPhone 18 Pro Max: Silver has 12 pictures, the main colour has 13. Shoppers switching colour start at picture 1."] }`.
  `saved` counts the rows the listed colours now have (one main plus the
  extras per variant), `removed` the rows deleted. Warnings never block.
- 400 `{ message }`, e.g. "iPhone 16 has no Signature case in this design. Add
  the model first.", "iPhone 16 has no phone colours. Add them in Mockup sets.",
  "pink is not a phone colour of iPhone 18 Pro Max. Choose one from its Mockup
  set.", "Variant 2 is not part of this design.". 404 when the design does not
  exist.
- 500 `{ "message": "Could not save the phone colour pictures. Try again." }`
  on a server failure (logged with the cause); the console retries it once.
- The storefront refresh is automatic (`/admin/designs/*` -> `products`,
  `catalog`). No `rebuildCards`: cards and `metadata.images` do not change. Main
  galleries keep changing through `POST /admin/products/:id/manager-variants`.

**`GET /admin/designs/:slug`**: each variant gains
`phoneColours: { main: string | null, extra: Record<colourSlug, string[]> }`
(the raw rows; `{ main: null, extra: {} }` without rows) and the design gains
`palette: Record<deviceSlug, { default: colourSlug, colours: [slug, name, hex][] }>`
for its models that have a Mockup set (switched off ones included).

**`DELETE /admin/designs/:slug`** also deletes the design's rows.

**`POST /admin/designs/upload`** takes an optional `colourSlug` (a web name; 400
otherwise). With it the key is `designs/<design>/<case-type>/<device>/<colour>/<n>.<ext>`;
without it the key is unchanged. Uploads still refresh nothing.

**`GET` and `POST /admin/mockups`** return
`colour_usage: Record<deviceSlug, Record<colourSlug, number>>` (rows per model
and colour) next to `settings`, so the sets screen can warn before a used colour
is removed. Saving a set validates `swatches` and the web names, and now
refreshes the storefront's `catalog` tag (`mockups` is a write prefix in
`api/middlewares.ts`).

### Store (publishable key, published only)

**`GET /store/phone-colours/product?product_id=<prod_...>&device=<slug>`**: the
product page payload, called by the storefront server.

```ts
type ProductPhoneColours = {
  colours: [slug: string, name: string, hex: string][]  // only colours this product uses: Mockup set order, then palette order
  variants: Record<string, number[]>                    // variantId -> indexes into colours; [0] = main (metadata.images), then palette order
  base: string                                          // longest common "/"-ending prefix of the URLs below ("" if none)
  galleries: Record<string, Record<string, string[]>>   // only `device`'s variants: variantId -> extra colour slug -> URL tails
}
```

`{}` when the product is not published or no variant has 2 or more colours.
Only variants with 2 or more colours are listed. A `colours` entry can repeat a
slug when two models name or paint that colour differently; a variant's list
never repeats one. Rebuild a URL with `/^https?:\/\//.test(t) ? t : base + t`
(`expandTail` in `src/lib/phone-colours.ts`). 400 on a malformed query.

**`GET /store/phone-colours/variant/:id`** (`^variant_[0-9A-Z]{26}$`): one
variant's extra galleries for a model switch, `{ base, galleries: Record<colourSlug, string[]> }`
(`{ base: "", galleries: {} }` when it has nothing to show). 400 on a malformed
ID, 404 unless the variant belongs to a published product.

**`GET /store/phone-colours?device=<slug>&case_type=<slug>`**: the shop palette,
`{ caseType, default, colours: [slug, name, hex, available: 0 | 1][] }` in
palette order. `available` is 1 when a live variant of a published product has
a row for that model, case type and colour (one row read, then the product and
variant ID reads in parallel). Sets switched off in Studio still count. A model
without a set gives `{ caseType, default: null, colours: [] }`.

**`GET /store/shop-cards`** takes an optional `colour=<slug>` (400 when it is not
a web name). One extra query for the page's at most 32 card variants; a card
whose variant has that colour's **extra** row gets `colourImage` (its first
picture). `image` and `imagesByCaseType` never change, and a missing or main row
means no `colourImage`.

Nothing changes in `/store/shop-catalog`, `/store/search-index`,
`/store/devices`, `/store/designs/:slug`, the warm job, the feed, checkout or
`rebuildCards`.

### Volume and reads

About 180 designs x 20 colour models x 4 colours is roughly 14,400 rows. Rows are
read per product (two small reads on the product page), per variant, per 32
shop variants, per (model, case type) for the palette, and as two columns for
`colour_usage`; never in the feed, the search index or the card scans.

## Console (Mockup Studio)

Details in MOCKUP_STUDIO.md; the code is `apps/backend/console/src/pages/mockup-studio/`.

- **Mockup sets** edits the palette: each colour's dot (colour picker or hex,
  saved in `swatches` only once changed; until then the dot is the SWATCH
  suggestion, the same as the shop's fallback), the default colour, and Remove,
  which asks first when `colour_usage` counts pictures of that colour.
- **New product** ticks several colours per model; every colour of a ticked
  model is pre-selected, and "Main only" is one click on the Models toolbar,
  next to the estimate. The main colour is `mainColourOf`: the model's default
  colour when ticked (owner decision: no per-design override), else the first
  ticked one. It is the one `/custom` (and Update pictures' manager-variants
  and `/pairs`) put in `variant.metadata.images`; the others go only through
  `POST /admin/designs/:slug/colours`, one call per model with
  `source: "mockup_studio"` and `replace: true`, single-colour models included.
- Uploads send `colourSlug` for every colour, the main one too. A colour's web
  name is the console's `slugify` of its name, which equals `colourSlug`.
- **Update pictures** re-uploads an existing design onto its existing variant
  IDs (manager-variants, `/pairs` for missing models, then the colours calls);
  it is how the owner re-uploads every design before go-live.

## Storefront

Code: `apps/storefront/src/lib/phone-colours.ts` (pure, no imports, so the
product page's client code can use it), the server reads in `lib/catalog.ts`
(`getProductPhoneColours`, `getVariantPhoneColours`, `getShopPhoneColours`,
`getShopCards(..., colour)`), all tagged `products`, `catalog` and
`catalog:phone-colours` (or `catalog:shop-cards`), revalidate 60.

**Product page.** `product-page.tsx` asks for the product's colours with the
first model's pictures inline, beside the related reads (one `Promise.all`, no
new waterfall); simple products and legacy pictures ask for nothing and send no
prop. The product data, `productViewVariants` and the Redis product entry are
unchanged.

- PHONE COLOR sits under MODEL (`PhoneColourRow` in `product-buy-box.tsx`):
  native radios in a `radiogroup` (arrow keys and one tab stop come with
  them), a 28px dot in a 44px target, the name beside the label and the note
  "Only changes the pictures. The case is the same for every phone colour."
  It is server-rendered with the main colour checked, only when the current
  pair has 2 or more colours, and never in simple mode, the H1, the quick-buy
  bar or the model drawer.
- The colour is a preference (`settleColour`): kept across model and case
  switches when the next pair has it, else that pair's main colour; hidden for
  a case type without colours and restored on the way back. The first render
  is always the main colour (no hydration mismatch, the same hero), and
  nothing is remembered between visits.
- A switch changes only the pictures: the gallery keeps its item IDs and does
  not remount (the angle stays), the current case type's tile and More
  designs' current tile follow the colour, and the variant, price, stock,
  ViewContent and the bag line do not change. The bag, wishlist and pack
  picture is the main colour's first picture.
- Other models' colours load from the same-origin `GET /api/phone-colours/<variant id>/`
  (`VARIANT_ID` only, 404 otherwise, `public, max-age=60,
  stale-while-revalidate=600`) once per variant: 250 ms after the shopper's own
  model or case switch, or on intent (pointer, touch, focus on a dot). Never on
  page load. From a model or case switch until the pictures arrive (the 250 ms
  settle, then the request), a kept extra colour's dot stays checked and busy
  over the main pictures, so the row never snaps to the main colour and back.
  A failure, or a payload without that colour, shows the main colour (never
  busy forever), and only a tap asks again: the dots react to `click`, so a
  tap on the dot already shown as checked counts too.
- The dot row gets the slider bar only with more than 6 colours (six fit at
  320px), so the server HTML never has a bar that hydration removes.
- `?color=<web name>` is read in the one post-hydration effect, after
  `pickFromQuery`; it never changes the pair and is ignored when the pair lacks
  that colour. The address is never rewritten.

**Shop.** `/shop/<device>/<case type>/<colour>/[<page>/]` and the same under
`/men` (`parseShopSlug` in `shop-filter-page.tsx`; a number is always the
page, a colour is a web name). An unknown or unavailable colour is a 404, the
model's default colour redirects (307) to the colour-less page, and a failed
palette read shows the colour-less pictures. The canonical URL never has the
colour; colour paths are not in the sitemap or the warm job.

- The toolbar's **Phone color** menu appears when 2 or more colours have
  pictures. `shopColourMenu` (`lib/phone-colours.ts`) builds it on the server
  and `shop-grid.tsx` shows it, with links set to `prefetch={false}`. The
  default colour links to the colour-less page. It follows BURGA (owner,
  2026-10-17): on phones, Model + Case type sit on the first row and Phone
  color + Sort on the second; on desktop all four share one row. Models
  without a set get no menu and no extra RSC data.
- Each card still gets one picture: `colourImage` when the design has that
  colour, else its own. Count, order, prices and Quick Add variants are those
  of the colour-less page. Card links add `&color=<slug>`; page links keep the
  colour (`pageBase`, built on the server). Quick Add on a colour page puts
  the main colour's picture (`product.thumbnail`) in the bag, like the
  product page, so the drawer line never flips.

**Measured (fixture builds, 2026-10-16).** Client JS gzip, merge-base vs head:
`/product/[slug]/page` 203,962 -> 204,851 (+889, the budget was raised to +900
in `check-client-budget.cjs`), `/shop/page` 187,220 -> 187,250 (+30, within
+32), layout and the rest within their limits (re-measured after the review
fixes). The `phoneColours` prop is
4,657 JSON bytes for the synthetic 39 models x 4 colours x 13 pictures (test
limit 8,000). Product RSC without colours is unchanged (40,931 -> 40,930 B);
the fixture's colour product sends a 662-byte prop. A shop page without
colours grew by 60 B of RSC (`pageBase`).

**Local check.** `PHONE_COLOUR_FIXTURE=1 node apps/storefront/tests/fixtures/mock-store-api.cjs`
adds "Audit Colours" with real-format IDs and colour pictures on the 17 and 16
Pro Max (their pictures are on a host that never resolves, so they show the
fallback block).

## Verification

`apps/backend/tests/phone-colours.test.cjs` covers the input rules, the row
plan, the workflow steps (ownership, messages, order of writes, a failed save
that leaves another writer's rows, undo), the catalog service's locked
transaction, the route's 400/404/500, the store projections (a deleted
variant's rows never count), shop cards, the upload key, design delete and the
Mockup set checks. `src/scripts/verify-product-manager-isolated.ts` runs the
real-database path in CI: create, `/colours`, refusals, idempotence,
published-only store reads, a main-colour move, a manager-variants edit that
keeps the rows, compensation, both unique indexes, two overlapping saves of one
variant, a save that fails part-way changing nothing, and delete cleanup.
`apps/backend/tests/mockup-studio.test.cjs` covers the console: the multi-colour
reducer (pre-selected colours, the locked last chip, Main only / All colours,
the stage colour, sanitising against the set), `mainColourOf`, `sharedShots`,
the estimate, upload bodies with `colourSlug`, the unchanged `/custom` body,
one `/colours` body per model, Stop and failure leaving the product with a
Retry that sends only the rest, one model's refused colours never holding back
the others (no answer, 401 and 404 still stop), Update pictures
(manager-variants and `/pairs` in batches of 20 or fewer, `/colours` with
`replace`, never `/custom`), own-key swatch lookups and the ZIP folders per
colour.
`apps/storefront/tests/phone-colours.test.cjs` covers the storefront with the
backend's own projections: `settleColour`, `?color=`, the payload readers and
expansion, the 8,000-byte prop, ProductView (main colour first, the unchanged
gallery identity and bag picture, hide and restore, the lazy load once, busy
from the switch and failure, `?color=` on inline, lazy and legacy pairs, a
device page never changing device), own-key colour lookups, the PHONE COLOR
markup (no slider bar for 6 dots or fewer, the click handler), shop paths, the
404 / redirect / palette-down cases, card picture choice, Quick Add's
main-colour bag picture, the shop row, page and card links, the cache tags and
the lazy route.

## Rollout

Deploy the backend and run `medusa db:migrate` (the one additive migration),
then check that the store routes return empty. Nothing changes for shoppers
until colours are saved.

The storefront can ship any time after the backend: without colour rows it
renders exactly as before. Each `?case=x&color=y` product URL is its own
Cloudflare edge key (a first MISS); extending the document Transform Rule to
cut `color` from the origin query is a separate, owner-approved Cloudflare
step and not part of this change.

The console ships with the same backend build (`npm run build` builds it). Then
the owner sets each colour's dot in Console > Mockup Studio > Mockup sets
(iPhone 18 Pro Max: Black is the default; its layer folders on D: are Black,
Silver, Wine Red and Glacier), pilots one **draft** design in four colours (Product Manager should
show the rows, and Update pictures should keep the variant IDs), and then
re-uploads the designs one by one with Update pictures.
