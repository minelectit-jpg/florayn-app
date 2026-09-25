# Header, menu and search

The site header (v2): a solid bar with the Florayn wordmark, a search field,
a CASETiFY-style menu drawer on phones and tablets, a nav row with panels on
desktop, and search that runs in the browser. Read this before changing the
header, the menu drawer, the desktop panels, search, or their admin screens.
Read [WOMEN_MEN.md](WOMEN_MEN.md) for the WOMEN | MEN switch and
[PERFORMANCE.md](PERFORMANCE.md) for the budgets.

## What the shopper sees

- **Phone (under 768px):** a 56px bar with Menu and Search on the left, the
  wordmark in the middle, Account and Bag on the right. On home, shop and
  collection pages a browse row sits under it (search field and a compact
  WOMEN | MEN switch) and scrolls away; the bar's search icon then fades in.
- **Tablet (768-1023px):** the same, 64px.
- **Desktop (1024px and up):** a 72px row (WOMEN | MEN pill, wordmark, search
  field with a "/" hint, Account, Bag) and a 48px nav row whose sections open
  panels on hover or with their chevron. "/" or Ctrl/Cmd+K opens search.
- **Menu drawer:** WOMEN / MEN tabs, "Your phone" (the last phone, iPhone or
  Samsung, the shopper opened or picked), then the menu sections in admin
  order: the Collections row, drill rows (Phone Case > iPhone / Samsung Galaxy
  > models, newest first, with a "Find your model" filter), Styles with
  prices, and plain links. Bottom links come from Admin > Navigation. Opening
  the drawer does not load search; its search field loads it on a press or
  hover, like the header's search links.
- **Desktop nav row:** on pages that exist in both modes (cart, account, pages)
  the row follows the same mode as the WOMEN | MEN pill and every other header
  link (the shell's `useAudience()`): Women in the static HTML, then the
  remembered mode after hydration.
- **Search:** a sheet with recent searches, Try suggestions and results as
  you type (models, designs, collections, styles, categories). Enter on a
  single model ("iphone 16") opens its shop; anything else opens
  `/search/?q=...`.

## Files

Storefront (`apps/storefront/src`):

| File | Role |
| --- | --- |
| `app/layout.tsx` | Reads content, case types and devices in parallel and renders `<SiteHeader wire={packHeaderData(buildHeaderData(...))} />`. No cookies, headers or search params. |
| `lib/header-data.ts` | `buildHeaderData` (one compact `HeaderData`), `packHeaderData` / `unpackHeaderData` (the smaller wire form), `sectionsFor`. |
| `components/header/site-header.tsx` | The client shell: bar, browse row, skip link, remembered phone, dialogs. |
| `components/header/header-dialogs.tsx` | The two native `<dialog>` sheets (menu and search): open, animated close, focus return, `useFocusTrap`, intent preloading. |
| `components/header/load-on-intent.tsx` | `retryImport`, `loadable`, `LoadBoundary`: lazy parts with one retry and a once-per-build reload. |
| `components/header/nav-drawer.tsx`, `nav-model.ts` | The drawer's levels (lazy) and their pure helpers. |
| `components/header/desktop-nav.tsx`, `mega-panel.tsx` | The desktop nav row and its panels (lazy). |
| `components/header/search-sheet.tsx`, `search-results.tsx` | The always-mounted search sheet and its lazy results. |
| `components/header/intent-link.tsx` | A link with prefetch off that prefetches once on pointerdown, touch or focus. |
| `lib/search/*` | `normalize.ts` (shared matcher), `engine.ts`, `load-index.ts`, `types.ts` (index v2). |
| `lib/remembered-device.ts` | "Your phone": `localStorage` key `fl_device`. Phones only: write through `phoneSlugs()`, read through `phoneOf()`, so an AirPods, watch-band or wallet page never replaces the phone and an old non-phone value reads as none. |
| `app/search-index.json/route.ts` | The edge-cached search index. |
| `app/search/page.tsx`, `app/men/search/page.tsx` | One static results page per mode. |
| `app/header.css`, `nav-drawer.css`, `search.css` | Dialog, drawer and search styles (imported by `globals.css`). |

Backend (`apps/backend/src`):

| File | Role |
| --- | --- |
| `modules/content/models/menu-section.ts` | `kind`, `image_url`, `badge`, `placement`, `config` (Migration20260927090000). |
| `modules/content/models/collection-page.ts` | `show_in_menu`. |
| `modules/catalog/models/device.ts` | `badge` (Migration20260927091000). |
| `lib/menu-section-input.ts` | The checks for a section's type, placement, badge, image and settings. |
| `modules/content/config.ts` | `buildMenu`, `copyMenu`, `getCollectionCards` (`in_menu`). |
| `api/store/content/route.ts` | Menus plus `navigation` and `search` (no synonyms). |
| `lib/search-index.ts`, `api/store/search-index/route.ts` | The search index builder and its route. |
| `lib/storefront-presentation.ts` | Navigation and Search settings (byte-identical to the storefront copy). |
| `migration-scripts/header-navigation-2026-09-27.ts` | The one-off data move (below). |
| `jobs/warm-storefront.ts` | Warms the index, `/search/`, `/men/search/` and every model page the menu opens. |

## Menu sections

Each header section (`menu_section`, menus `primary` and `primary-men`) has a
type. Only Links sections use their hand-made links; the others fill
themselves, so a new model, style or collection shows up without editing the
menu.

| Type (`kind`) | Settings (`config`) | Fills from |
| --- | --- | --- |
| Links (`links`) | none | its own links (grouped) |
| Device models (`devices`) | `families` (ordered), `case_type` for model links or null | Devices, each brand newest first |
| Case styles (`case_types`) | `form`, `exclude`, `links` (per-style link overrides) | Case types (name, photo, from price for the section's form) |
| Collections row (`collections`) | `title`, `view_all_href`, `limit` (1-12) | Collection pages with Show in menu, in their order (the header carries up to 12 per mode) |

A style's "from" price is per form: the lowest price an active device of that
form actually costs (its per-device price group, else the flat price), so
Alcantara reads from 3,800 among phones and from 2,100 among AirPods, not the
card wallet's 1,900 everywhere (`lib/content.ts` `fromPrices`, the header's
6th case-type field, search's per-form `stylePrice`).

Case styles saves keep the exclusions and link overrides of switched-off case
types and of case types with no models yet; only a known case type of another
form is dropped.

`placement` is `all`, `drawer` (phone menu only) or `bar` (desktop only).
`image_url` is the round picture in the drawer and the desktop promo. The
footer is always Links, shown everywhere.

A model link opens `/shop/<device>/<case type>/` when that case type is made
for the device's form, else `/shop/<device>/`, so Signature Earbuds never opens
on an iPhone. A style opens its override link, else the shop for the
remembered phone (when its form fits), else the newest device of that form.
In search, which knows each case type's devices, a style or model link uses
a case type only when it is sold for that exact model (Elite Clear never opens
a Samsung shop; Essentials never an iPhone 11), else the newest model it is
made for.

## Admin screens

- **Navigation** (`/app/mega-menu`): Women and Men tabs, one card per section
  with Type, Shows in, Image and Badge, and the settings for each type. At the
  bottom: brand names, menu bottom links and "Remember the shopper's phone".
  Link edits count as unsaved changes (badge, leave-page guard, WOMEN/MEN
  confirm) and a card's Save changes saves them with the section; an edit
  typed while a save is in flight stays unsaved. "Unsaved" compares values the
  way the server stores them, so jsonb key order never shows it.
- **Search** (`/app/search`): placeholder, Try suggestions for Women and Men,
  synonyms (for example chita, cheetah -> leopard) and the help link shown when
  nothing matches. Suggestions show as "Try", never "Popular".
- **Devices**: each brand newest first, with a Badge (for example New) per model.
- **Collection pages**: a Show in menu switch per page.
- **Case types**: the style photo used in the menu and panels.

Every save goes through `/admin/content/*`, `/admin/devices` or
`/admin/case-types`, which refreshes the storefront's `content` or
`catalog`/`products` tags: the header and the search index both follow.

## Search

- **Index:** `GET /store/search-index` builds one small JSON (v2, see
  `lib/search/types.ts`): case types, devices (newest first), collections,
  products (newest first), menu link categories, synonyms and the Try
  suggestions. Audience fields are a mask: 1 Women, 2 Men, 3 both.
  - Each case type carries the devices it is sold for, its flat price, its
    per-device price groups and its render folder
    (`[slug, name, fromPrice, forms, sold, price, groups, folder]`).
  - Each product carries, from its precomputed `metadata.card.pairs`, where
    its renders live (`pics`: 1 = its own folder, a folder name, 0 = unknown,
    for example versioned admin uploads) and `facts`: only where one of its
    case types differs from the case type (devices it has no variant for, its
    own prices).
  - A design is linked, priced and pictured for a model only when one of its
    case types sells it there; otherwise the result uses the design's own
    link, thumbnail and price. /search cards show the exact price of the
    style and model they name, or "From" when no model is known.
  - A trailing number still being typed ("1" of "15") never names a model on
    its own, so "leopard 1" does not jump to AirPods 1/2 ("airpods 2" still
    does).
  - The storefront's loader accepts `v === 2` only: deploy the backend first.
- **Caching:** the backend answers with `max-age=60`. The storefront's
  `/search-index.json` keeps the body in the Next data cache for 30 minutes,
  tagged `products`, `catalog` and `content`, and never caches a failure (it
  answers 503 `{v:0}`, `no-store`). It sends `public, max-age=300,
  s-maxage=1800, stale-while-revalidate=86400`, so after a save the edge can
  serve the old index for up to 30 minutes unless it is purged.
- **Loading:** the browser fetches `/search-index.json` once, on the first
  sign of wanting to search, never on page load. A failed load resets so the
  next intent tries again; meanwhile Enter still opens `/search/?q=...`.
- **Results page:** `/search/` and `/men/search/` are static
  (`dynamic = "force-static"`), so every query shares one cached HTML. The
  page reads `?q=` in the browser (`useSearchParams` inside Suspense) but only
  after hydration (`useSyncExternalStore`, server snapshot false): until then
  it renders the SearchSkeleton, the same markup the static HTML has, so a
  direct load of `/search/?q=...` never hits hydration error #418. Keep it that
  way: nothing that depends on `?q=` may render before hydration.
- **Bump the version** (`v` in the backend builder, `lib/search/types.ts` and
  `load-index.ts`, and the `search-index-v2` cache key in
  `app/search-index.json/route.ts`) whenever the index shape changes.

## Budgets

- Header prop: 10,000 bytes or less (`tests/header-data.test.cjs`).
- Search index: 60,000 JSON bytes and 14,000 gzip bytes or less for 400 designs
  (`apps/backend/tests/search-index.test.cjs`).
- `engine.ts` 3 KB gzip or less, `normalize.ts` 1.2 KB or less.
- No `/search-index.json` request and no drawer or panel prefetch on page load.
- "First Load JS shared by all" must not grow.

## Cloudflare (new.florayn.com only)

florayn.com is not touched.

- A cache rule for the path `/search-index.json`: eligible for cache, edge and
  browser TTL respect the origin headers.
- A cache key that ignores the query string on `/search/` and `/men/search/`.
- Keep the HTML document rule keyed on `sec-fetch-dest == document`. The warm
  job asks for `/search-index.json` the way a page's `fetch()` does
  (`Sec-Fetch-Dest: empty`, `Sec-Fetch-Mode: cors`, `Accept: application/json`),
  so only the index rule applies to it.
- The post-deploy purge-and-warm list includes `/search-index.json`, `/search/`
  and `/men/search/`.

## Data move and deploy order

`migration-scripts/header-navigation-2026-09-27.ts` runs once inside
`db:migrate`, only fills empty or default values, and changes nothing on a
second run. On the live data it turns Phone Case and Earbuds Cases into device
lists (fixing the Earbuds link to `signature-earbuds`), turns Styles into case
styles with the Alcantara and Essentials link overrides, adds a Collections row
(phone menu only) and the home page's accessory links with pictures, sets the
New badges on 8 models, and sets the six style photos (R2 copies). The seed's
old Collections links column (shown or hidden, in either menu) becomes that
drawer-only row at the top; a Collections section the owner made is left
alone and the row is added beside it. The old links stay in the database;
setting a section's Type back to Links restores it.

After writing anything, the script refreshes the storefront (tags `content`,
`catalog`, `products`) the way an admin save does, so the header, the ISR
pages and `/search-index.json` follow at once. That needs `STOREFRONT_URL` and
`REVALIDATE_SECRET` where migrate runs; without them (or if the call fails) it
only logs a warning and the migration still succeeds. A second run writes
nothing and refreshes nothing.

The backend container does not run migrations (see `apps/backend/Dockerfile`);
they are run against the database from a machine where the CLI works. Coolify
builds the pushed commit, so push everything first.

1. Push the product-page default-device fix together with the device-order
   commit.
2. `npx medusa db:migrate --skip-scripts` (the new columns only).
3. Deploy the backend.
4. Deploy the storefront.
5. `npx medusa db:migrate` (runs `header-navigation-2026-09-27`). Running it
   before the new storefront is live would show empty panels and the new
   sections in the old header.
6. Admin > Publish > Refresh storefront now, unless step 5 logged
   `storefront refreshed`. Do this before the purge, so the edge re-caches the
   migrated menus and index, not the 30-minute-old ones.
7. Add the Cloudflare rules above.
8. Purge and warm, then measure only when warm.

A fresh database seeds the typed menu directly (`modules/content/defaults.ts`),
and the catalogue seed sets the same New badges and style photos
(`DEFAULT_DEVICE_BADGES`, `DEFAULT_CASE_TYPE_IMAGES`), whichever of the seed
and the script runs first.
