# Women and Men modes

The storefront has two shopping modes. Women is the default at the root
(`/`, `/shop/…`, `/collection/…`, `/product/…`). Men is the same site under
`/men` (`/men/`, `/men/shop/…`, …). Cart, checkout, account, contact and legal
pages exist once and are shared.

The mode lives in the URL, not a cookie. Every page stays static/ISR and
edge-cacheable, and an ad or a shared link opens the mode it was made in. A
returning visitor who picked Men still lands on the Women home at `/`. This was
the owner's choice.

## Storefront

- `lib/audience.ts` holds the pure helpers:
  - `withAudience(href, mode)` adds `/men` to scoped paths only.
  - `switchAudiencePath` gives the toggle's target.
  - `fitsAudience` and `forAudience` filter by `metadata.audience`.
- `components/audience-link.tsx` is `next/link` plus the mode. Admin content
  (menus, tiles, hero slides) keeps plain paths, and this adds `/men`. Use it
  for every internal link that has a Men counterpart.
- `components/use-audience.ts` resolves the mode from the path. On shared pages
  it falls back to the `fl_audience` cookie after hydration, so there is no
  mismatch.
- `components/audience-toggle.tsx` is the switch:
  - a sliding pill in the desktop header
  - a full-width tab bar under the phone header on home, shop and collection
    pages (not on product pages)
  - the same switch at the top of the phone menu drawer

  It opens the same page in the other mode and has `prefetch={false}`, so
  product pages are not rendered twice.
- The page bodies live in `components/pages/*` and take an `audience`. The files
  in `app/…` and `app/men/…` only fix the mode and their cache settings, and
  both must keep them identical.
- Men product pages canonicalise to the root `/product/<slug>/`. Men home, shop
  and collection pages have their own canonical URLs and are in the sitemap.
- `lib/revalidation.ts` refreshes both modes of any scoped path.

## What a mode changes

- **Home page:** each mode has its own `home_section` rows (`audience` column).
- **Header menu:** Women uses `menu_section.menu = "primary"`, Men uses
  `"primary-men"`. An empty Men menu falls back to the Women one. The footer is
  shared.
- **Listings:** shop, collection pages, home rows, collection cards, "More
  designs" and the product-page strips list only designs for that mode, plus
  those for both.
- **Collection cards:** these carry `audiences` from one grouped SQL read, so a
  collection with no men's designs does not appear in Men.
- **Simple products:** colours tagged for the other mode are hidden (for
  example the StickPad colours for women only), unless that would leave none.

## Data and admin

- A design's audience is `product.metadata.audience` on every product of the
  design: `women`, `men` or `both`. Missing means both.
  - Set it in **Product Manager > Shown for**, per product or in bulk from the
    list, which also filters by it.
  - It is written through `PATCH /admin/designs/:slug {audience}`.
- A simple product's colour uses `variant.metadata.audience`, set in the variant
  editor (`POST /admin/products/:id/manager-variants`). Case products are tagged
  as a whole, never per variant.
- **Admin > Home page** and **Admin > Mega menu** have Women and Men tabs.
  - Home page: "Copy to Men" / "Copy to Women" copies a section across.
  - Mega menu: "Copy Women menu" starts an empty Men menu.
- `migration-scripts/men-mode-2026-09-24.ts` did the first setup:
  - tagged 42 men and 83 women designs from florayn.com's Gender attribute (the
    rest are for both)
  - made StickPad's Magenta, Sky Blue, Pink and Cyan women-only
  - copied the Women menu to Men
  - built the Men home page from florayn.com/men, with pictures on R2 under
    `site/home/men/`

  It only fills empty values and is idempotent.
