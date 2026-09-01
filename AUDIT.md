# florayn.com audit

Read-only audit of the live WooCommerce store, done through the Novamira MCP
connector (filesystem + Rank Math read abilities) and plain HTTP. No write or
execute ability was used.

**Status: first pass.** Everything in "Verified" was read off the live site.
Everything in "Not yet covered" is still outstanding — it is listed rather than
guessed at. Nothing below is taken from memory or assumption.

---

## 1. Scale, and where the numbers come from

| Fact | Value | Source |
| --- | --- | --- |
| Product sitemaps | 67 × 200/page | `sitemap_index.xml` |
| Product categories | **991** | 5 × `product_cat-sitemap*.xml` |
| Category URL space | **100% under `/collection/`** | all 991 URLs |
| Published pages | 29 | `page-sitemap.xml` |
| WordPress / PHP | 7.1 / 8.3.33 | Novamira env |
| WooCommerce | 11.0.1 | plugin list |
| Active plugins | 31 of 34 installed | plugin list |

The 991 categories confirm the "attributes masquerading as categories" problem.
Classified by slug shape:

| Kind | Count |
| --- | --- |
| Device-prefixed (`iphone-*`, `samsung-*`, `airpods-*`…) | ~163 |
| Case-type words (`*-case`, `*-magsafe`, `*-clear`…) | ~321 |
| Colour-prefixed (`black-*`, `pink-*`…) | ~107 |
| Remainder (designs + design×case-type) | ~400 |

---

## 2. The category explosion, decoded

Categories are generated as **design × case type**, using slug suffixes. Decoded
by fetching each category's `<title>`:

| Suffix | Case type | Count |
| --- | --- | --- |
| `-abm` | Armor Black | 78 |
| `-atm` | Armor Clear | 76 |
| `-etm` | Elite Clear | 83 |
| `-tm` | Signature | 63 |

Worked example — one design, five categories:

```
/collection/amber-leopard/        -> "Amber Leopard"
/collection/amber-leopard-abm/    -> "Amber Leopard Armor Black"
/collection/amber-leopard-atm/    -> "Amber Leopard Armor Clear"
/collection/amber-leopard-etm/    -> "Amber Leopard Elite Clear"
/collection/amber-leopard-though-magsafe/
```

This is the taxonomy equivalent of the 14,000-product problem, and it is the
single strongest argument for the design × case-type model already built here.

---

## 3. The "Though MagSafe" typo is in the URLs, not just the copy

It is **not** only display text. `though` (should be `tough`) appears in **60
category slugs**, including the case type's own landing category:

```
/collection/though-magsafe/                    -> "Though MagSafe"
/collection/amber-leopard-though-magsafe/
/collection/iphone-17-pro-max-though-magsafe/
/collection/samsung-s26-ultra-though-magsafe/
... 56 more
```

Because it is in live, indexed URLs, fixing it on the live site would need
301s. In the new build it is simply spelled **Tough MagSafe** from the start,
which is what you asked for.

---

## 4. Case types

Six, confirmed present on the live site:

| Case type | Price (verified) | Category exists at top level |
| --- | --- | --- |
| Signature | **1,400.00৳** | no — only as `*-tm` |
| Elite Clear | **1,600.00৳** | no — only as `*-etm` |
| Armor Black | **1,950.00৳** | no — only as `*-abm` |
| Armor Clear | **1,950.00৳** | no — only as `*-atm` |
| Essentials | not yet read | `/collection/essentials/` (200) |
| Tough ("Though") MagSafe | not yet read | `/collection/though-magsafe/` (200) |

Prices read from the CASE TYPE swatches on
`/product/amber-leopard-iphone-17-pro-max-case/`.

**Italian Alcantara is not a case-type category.** It is an Elementor landing
page at `/italian-alcantara/`; `/collection/italian-alcantara/` returns 404. The
local build currently models Alcantara as a case type — that needs a decision.

**Correction to the local build:** the six case types here are Essentials,
Signature, Elite Clear, Armor Black, Armor Clear, **Alcantara**. The live sixth
is **Tough MagSafe**, with Alcantara being a separate line.

---

## 5. Pages (all 29)

Storefront: `shop`, `cart`, `shopping-cart`, `checkout`, `my-account`,
`my-account-2`, `wishlist`, `wishlist-2`, `compare`, `track`, `track-order`,
`recently-view-products`, `reviews`, `men`, `collections`.

Collection landing pages (Elementor): `garage`, `checkmate`, `wild-instinct`,
`frequency`, `florayn-blooms`, `bug-life`, `van-gogh-dreams`, `muse-marvel`,
`leopard-series`, `italian-alcantara`.

Policy: `terms-conditions`, `privacy-policy`.

Admin-ish, publicly listed: `inventory`, `easy-order-manager`.

Two findings:

- **Fruit Punch and Stripes have no landing page.** They exist as categories
  (`*-though-magsafe` slugs reference them) but are not in the page sitemap,
  unlike the other nine collections you listed.
- **Landing page ≠ category.** `/leopard-series/` is an Elementor page;
  `/collection/leopard/` is the product category. Two different surfaces for
  the same collection.

---

## 6. florayn-core plugin — all 20 modules

Read from `includes/modules.php`, which is the registry that drives the plugin's
settings screen. 13 PHP + 7 CSS, all default-on.

| # | Type | Module | What it does |
| --- | --- | --- | --- |
| 1 | PHP | COD fraud guard | Checks courier delivery history at checkout and hides COD for numbers with a poor success rate |
| 2 | CSS | Payment method boxes | Each payment method in its own rounded card, selected one in Florayn purple |
| 3 | PHP | No page header on checkout | Drops breadcrumb/title from checkout, order-pay, thank-you |
| 4 | PHP | bKash payment recovery | Cancelled/failed bKash goes to order-pay, not an empty cart |
| 5 | PHP | Shop filter bar | Model drawer + SELECT CASE TYPE popup on shop/category pages |
| 6 | PHP | Section memory (WOMEN/MEN) | Resolves section from referrer, last choice, or product; never redirects |
| 7 | PHP | Header WOMEN/MEN toggle | The pill toggle in the header HTML slot |
| 8 | PHP | Shop product card style | The bordered card — same one used on the Garage landing page |
| 9 | PHP | Product page model drawer | DEVICE dropdown becomes a searchable side drawer |
| 10 | PHP | Case type name and price | Name + price under each CASE TYPE swatch |
| 11 | PHP | More designs drag scroll | Mouse-drag the MORE DESIGNS row |
| 12 | PHP | Design level reviews | All products of one design share rating, count and review list |
| 13 | PHP | Cursor effects | Per-page Fluid / Checker / Waveform cursor |
| 14 | CSS | Drawer and popup styles | Shared model-drawer + case-type popup styling |
| 15 | CSS | More designs scroller styles | MORE DESIGNS row layout |
| 16 | CSS | Loop title base styles | Two-line title, price spacing, image zoom outside the shop archive |
| 17 | CSS | Filter dropdown styles | Filter by / Featured dropdowns |
| 18 | CSS | Variation thumbnails | Swatches for design and case-type attributes |
| 19 | PHP | No breadcrumb on product page | Removes breadcrumb + prev/grid/next arrows entirely |
| 20 | CSS | Single product cleanup | Hides breadcrumbs, product nav, media controls |

Beyond the module registry, `includes/` holds substantial subsystems not in the
module list: `bundle-offers.php` (57KB), `bulk-edit.php` (42KB),
`bundle-builder.php` (41KB), `mockup-editor.php` (40KB), `design-order.php`
(37KB), `review-requests.php` (36KB), `shared-stock.php` + admin (55KB),
`review-rewards.php` (35KB), `quick-order.php` (31KB), `collection-builder.php`
(28KB), `design-videos.php`, `pairs-well-with.php`,
`frequently-bought-together.php`, `cross-sells.php`, `variants.php`,
`design-gender.php`, `reviews-page.php`, `catalog-check.php`.

**Housekeeping note:** the plugin directory carries ~50 `.bak-*` files
(`bundle-offers.php` alone has 7). They are dead weight and, being `.php` under
a served directory, worth cleaning up on the live site.

---

## 7. Shipping, payment (verified previous turn, re-confirmed)

| | Value |
| --- | --- |
| Inside Dhaka | 60৳ |
| Outside Dhaka | 100৳ |
| Free-delivery threshold | **none** |
| Payment methods | bKash Payment Gateway + Cash on delivery |
| Currency | BDT, prefix empty, **suffix ৳**, 2 decimals, `,` thousands |

Confirmed by the live checkout: 1,950.00৳ subtotal + 60.00৳ = 2,010.00৳.

Checkout fields: Full Name*, Phone*, City/District*, Full Address*, Email
(optional), Order notes (optional), plus a coupon field. **No area/thana
field** — the local build has one.

District dropdown is 64 entries and uses **Barishal**, **Nawabganj**,
**Netrakona**.

---

## 8. Rank Math SEO

| Setting | Value |
| --- | --- |
| Title separator | `-` |
| Homepage title | `%sitename% %page% %sep% %sitedesc%` |
| Product title / desc | `%title% %sep% %sitename%` / `%excerpt%` |
| Product schema | `product` |
| Category title / desc | `%term% %sep% %sitename%` / `%term_description%` |
| Product categories | **indexed** |
| Product tags | noindex |
| Author + date archives | noindex, date archives disabled |
| Global robots | index, `max-image-preview:large`, `max-snippet:-1` |
| Breadcrumbs | **disabled in Rank Math** |
| Sitemap | 200/page, images on; product + page + post + product_cat on; product_tag + category off |
| Knowledge graph | Company — "Florayn", alt "Florayn Fashion", `OnlineStore` |
| Org description | "Florayn is a Bangladeshi designer phone case brand offering premium pretty yet protective iPhone and Samsung cases with fast delivery across Bangladesh." |
| Address | Plot#H-2 (1st Floor), Block-H, Sector-2, Avenue-10, Dhaka 1212, BD |
| Phone / email | +880 1310007055 / info@florayn.com |
| Geo | 23.7808, 90.4318 |
| Modules on | ai-visibility, 404-monitor, analytics, image-seo, instant-indexing, link-counter, local-seo, redirections, rich-snippet, role-manager, seo-analysis, sitemap, woocommerce |

An IndexNow API key and a Maps API key are configured. **Deliberately not
recorded here** — they are credentials; read them from Rank Math if needed.

**SEO risk worth flagging:** with 991 product categories indexed and titled
`%term% - Florayn`, a large share of the indexed surface is near-duplicate
design×case-type pages. Consolidating to real collections should improve
crawl efficiency, but will need a 301 map.

---

## 9. Not yet covered

Listed rather than guessed:

- **The 189 design names.** Needs a crawl of the design-level categories or a
  paged `woocommerce/products-query`. ~92 design bases are visible behind the
  case-type suffixes; the rest are in the unsuffixed remainder.
- **Per-collection landing page layouts.** Section-by-section structure for the
  10 Elementor landings.
- **Header mega menu and mobile menu**, beyond the top-level items
  (Phone Case, Earbuds Cases, Styles, Collections) and the WOMEN/MEN pill.
- **Footer** — column-by-column link list.
- **Product page modules in detail** — gallery/video, Pairs well with,
  Frequently bought together, More designs, reviews, bundle offers. The module
  and include names are known; behaviour is not documented.
- **Coupon logic.** Not readable without a write/execute ability.
- **Email templates**, order-status emails, review-request emails.
- **Account, blog, policy page copy.**
- **Essentials and Tough MagSafe prices.**
