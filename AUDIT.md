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

Six, confirmed from the `pa_case-type` taxonomy in the live database:

| Case type | Price |
| --- | --- |
| Essentials | 1,400৳ |
| Signature | 1,400৳ |
| Elite Clear | 1,600৳ |
| Armor Black | 1,950৳ |
| Armor Clear | 1,950৳ |
| Alcantara | not yet read |

Armor Black / Armor Clear / Elite Clear / Signature prices were read from the
CASE TYPE swatches on `/product/amber-leopard-iphone-17-pro-max-case/`.

### Tough MagSafe is a category, not a case type

`/collection/though-magsafe/` is a **product category and marketing name for
Signature**, not a seventh construction. 3,225 of the 3,304 products in that
category carry `pa_case-type = Signature`. This is consistent with the slug
suffix decoded in section 2, where `-tm` resolves to Signature.

The same applies to `/collection/essentials/`: a category page existing at top
level says nothing about whether something is a case type.

**Correction.** An earlier version of this audit claimed Tough MagSafe was the
sixth case type and Alcantara was not one. That was wrong. It inferred the case
type list from which `/collection/` URLs return 200 - a category signal - rather
than from `pa_case-type`. The local build’s six case types were correct all
along and must not be changed.

Alcantara also has an Elementor landing page at `/italian-alcantara/`; the
landing page and the case type are separate surfaces, as with the other
collections (see section 5).

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

## 9. Header — mega menu

Four top-level items. Every device link goes to the shop with a **case-type
filter already applied**, not to a category:

```
/shop/?filter_device=<device>&filter_case-type=<case-type>&filter=1
```

| Menu | Contents |
| --- | --- |
| **Phone Case** | iPhone 17 Pro Max / 17 Pro / 17 Air / 17 (all badged "New"), 16 series, 15 series, 14 series, 13 series, 12 series, then Samsung S26 (New + Hot) / S25 / S24 / S23 — each `filter_case-type=signature` |
| **Earbuds Cases** | AirPods 1/2, 3, 4, Pro, Pro 2, Pro 3 (New), Designer Vivid |
| **Styles** | Alcantara, Essentials, Though Magsafe, Elite Transparent, Armor Transparent, Armor Black |
| **Collections** | Leopard, Muse Marvel, van Gogh Dreams, Bug Life, and a Collections index |

### Marketing names differ from taxonomy names

This is the important find, and it independently confirms section 4:

| Menu label | Actually filters to |
| --- | --- |
| Though Magsafe | `filter_case-type=signature` |
| Elite Transparent | `filter_case-type=elite-clear` |
| Armor Transparent | `filter_case-type=armor-clear` |
| Armor Black | `filter_case-type=armor-black` |
| Essentials | `/collection/essentials/` |
| Alcantara | `/italian-alcantara/` |

So the store presents **six style entries whose display names are not the
taxonomy names**. "Though Magsafe" resolving to `signature` is direct proof
that Tough MagSafe is Signature's marketing name.

The WOMEN / MEN pill sits left of the wordmark (`header-toggle.php`), with
`section-resolver.php` remembering the choice across pages without redirecting.

---

## 10. Footer

Four columns plus a bar:

| Column | Contents |
| --- | --- |
| **Help Customers** | Plot#H-2 (1st Floor), Block-H, Sector-2, Avenue-10, Zahurul Islam City (Aftabnagar Eastern Housing Project), Dhaka-1212, Dhaka, Bangladesh · +880 1310-007055 · email (Cloudflare-obfuscated) |
| **About** | Terms and Conditions, Privacy Policy, Contact Us |
| **Shop Categories** | Shop Phone Case, Shop AirPods Case, iPhone 17 Series |
| **Popular Products** | Wavelength widget — iPhone 17 Pro Max / 17 Pro / 17 Air / 17 / 16 Pro Max, 1,950.00৳, with Add to cart |

Bar: `© 2026 Florayn Store. All rights reserved.`

Two notes: **"Contact Us" points at Facebook**
(`facebook.com/FloraynFashion`), not an on-site page; and the footer has no
delivery-terms column, so the 60৳/100৳ rates appear only on the product page
and at checkout.

---

## 11. Collection landing pages

Ten Elementor pages, all following the same shape: a hero, then a grid of
**design tiles** where each tile is one design in that collection, linking
through to the design's category.

| Landing page | Designs listed |
| --- | --- |
| `/muse-marvel/` | 14 |
| `/garage/` | 13 |
| `/frequency/` | 13 |
| `/van-gogh-dreams/` | 13 |
| `/wild-instinct/` | 12 |
| `/leopard-series/` | 11 |
| `/florayn-blooms/` | 11 |
| `/bug-life/` | 9 |
| `/checkmate/` | 9 |
| `/italian-alcantara/` | 4 |

**106 distinct design names** are recoverable this way. Examples: Leopard —
Amber / Arctic / Blush / Classic / Floral / Indigo / Midnight / Obsidian /
Orchid Leopard. Garage — Redshift, Midnight Riders, Two Wheels, Drift Dynasty,
Rebel Society, Sunburst, Timeless, Gear Heads, Alien Abduction.

`/collections/` is an index page above the ten.

**Fruit Punch and Stripes have no landing page**, which is why their designs do
not appear above. Their designs are visible in category slugs — banana-bliss,
berry-pop, citrus-splash, coco-vibe, jackfruit-jungle, lychee-love, mango-stamp,
pineapple-bloom, strawberry-blush, watermelon-crush — consistent with a Fruit
Punch collection that was never given a landing page.

---

## 12. Coupons

There is no general coupon programme in florayn-core. Coupons are generated by
one subsystem, **Review Rewards** (`includes/review-rewards.php`):

> Customers can attach photos to a product review. When the review is approved
> they get a single use percentage coupon for their next order, mailed to them:
> a higher one for a review with photos, a lower one for text only.

Defaults:

| Setting | Value |
| --- | --- |
| Photo review | **15%** off |
| Text-only review | **10%** off |
| Coupon expiry | 60 days |
| Max photos | 3 |
| Minimum rating | 1 |
| Cooldown between rewards | 30 days |
| Auto-approve | on |
| Popup | on |
| Email from name | Florayn |

Coupons are single-use and percentage-based. Any coupons created by hand in
WooCommerce admin are **not** readable without a write/execute ability.

---

## 13. Email

**No email template overrides exist on disk.** There is no
`themes/glozin/woocommerce/emails/` directory, and florayn-core's `templates/`
holds only `cart/cross-sells.php` and `woocommerce/single-product-reviews.php`.

So transactional mail is **stock WooCommerce**, styled through WooCommerce's
email settings (header image, base colour, footer text). Those live in the
options table and are not readable read-only.

Custom mail is sent by two florayn-core subsystems, composed in PHP rather than
templates:

- `review-requests.php` (36KB) — post-purchase review request emails, with a
  sent-log.
- `review-rewards.php` (35KB) — the reward-coupon email above.

FluentSMTP is active, so delivery goes through an external SMTP provider.

---

## 14. Designs — the authoritative list

Read from the `pa_more-designs` taxonomy through WooCommerce's **public
read-only Store API**, so no execute ability was needed:

```
/wp-json/wc/store/v1/products/attributes            -> pa_more-designs = id 2
/wp-json/wc/store/v1/products/attributes/2/terms?hide_empty=false&per_page=300
```

| | Count |
| --- | --- |
| Terms in `pa_more-designs` | **189** |
| Terms with at least one product | 181 |
| Terms with no products | 8 |
| Real designs after removing the typo | **188** |

`hide_empty` matters: the default hides terms with no products and returns 181.
Only `hide_empty=false` gives the full 189.

Saved to `apps/backend/src/modules/catalog/data/designs-live.json` with each
design's name, slug and whether it currently has products.

### The Sunny Streett typo, confirmed

Both terms exist. **"Sunny Streett" has no products attached**, which is
independent evidence it is an accidental duplicate rather than a real design.
It is excluded, leaving 188.

### Seven designs exist but have no products

All from one unreleased-looking set: **Linea Espresso, Linea Heather, Linea
Ivory, Linea Mint, Linea Olive, Linea Periwinkle, Linea Ruby**.

A "Linea" line is set up in the taxonomy but nothing is published against it,
and it has no landing page and no collection. Worth confirming whether it is
upcoming, abandoned, or a staging leftover before it is seeded.

---

## 15. Display names — decision recorded

The rebuild uses the **taxonomy names**, not the storefront marketing labels:

| Use | Not |
| --- | --- |
| Signature | "Though Magsafe" |
| Elite Clear | "Elite Transparent" |
| Armor Clear | "Armor Transparent" |
| Armor Black | — |
| Essentials | — |
| Alcantara | — |

The marketing labels are inconsistent with each other and one is misspelled, so
the taxonomy set is the clean baseline. The local build already uses exactly
these six names, so no change to the data model is required.

---

## 16. Design mapping — swept from the live catalogue

Rather than infer collection membership from the ten landing pages (which only
covered 106 designs), the whole catalogue was swept through the public Store
API. `_fields` keeps each page small and every product exposes its design, case
type, device and categories:

```
/wp-json/wc/store/v1/products?per_page=100&page=N
  &_fields=name,attributes,categories
```

**133 pages, 13,281 products, 181 designs.** Read-only throughout.

### Case types per design, from live products

| Case type | Designs sold in it |
| --- | --- |
| Signature | 165 |
| Elite Clear | 131 |
| Armor Black | 109 |
| Armor Clear | 104 |
| Alcantara | 11 |
| Essentials | **5** |

Essentials is nearly unused — five designs. Worth knowing before it is treated
as a headline construction.

Designs by how many constructions they are sold in: 103 in four, 7 in three,
21 in two, **50 in only one**.

### Collections, with design counts

| Collection | Designs |
| --- | --- |
| Florayn Garage, Frequency, Muse Marvel, Van Gogh Dreams | 12 each |
| Alcantara, Leopard, Wild Instinct | 11 each |
| Fruit Punch | 10 |
| Bug Life, Checkmate, Florayn Blooms | 8 each |
| Stripes | 7 |

**Twelve, not eleven.** "Alcantara" is a collection of 11 colourways
(Alcantara Black, Brown, Cyan, Dark Green, Dirty Pink, Gray, Orange, Purple
Blue, Sea Blue, Sierra Blue, Wine Red) *and* a case type. Both are real and
they are different things.

**60 of the 181 designs are filed under no collection at all.** They are live
and sold; they simply have no collection category. They seed without one.

---

## 17. Seeded

`designs.ts` is now generated from the sweep. Seed result:

| | Live | Seeded |
| --- | --- | --- |
| Designs | 181 | **181** |
| Case types | 6 | **6** |
| Products | 13,281 flat | **525** (design × case type) |
| Collections | 12 | **12** |

Products per case type match the live distribution exactly: Signature 165,
Elite Clear 131, Armor Black 109, Armor Clear 104, Alcantara 11, Essentials 5.
525 = the sum of each design's real case-type count, so no product exists that
the live site does not sell.

22,718 variants across 525 products, versus 13,281 flat products live.

Excluded and verified absent: the 7 Linea designs and "Sunny Streett".

### Count reconciliation

The brief said 180 designs. It is **181**:

```
189  terms in pa_more-designs
  -1  Sunny Streett (typo, no products)
= 188
  -7  Linea (never launched, no products)
= 181
```

181 is also exactly the number of terms with at least one product, which is an
independent check. The 180 figure looks like 188 − 8, where the 8 empty terms
already included Sunny Streett, subtracting it twice.

---

## 18. Still not covered

- **Design descriptions.** The live site holds copy per product, not per
  design, so there is nothing design-level to import. Seeded designs have no
  description.
- **WooCommerce email settings** and **hand-made coupons** — options/posts
  tables, not exposed read-only. Left as gaps by instruction.
- **Product page section behaviour** — Pairs well with, Frequently bought
  together, bundle offers, gallery/video.
- **Account and blog page copy.**
- **Per-design product copy.** Each live product has its own description; the
  seed uses the case type's copy for all of them.

---

## 19. Device availability and Alcantara pricing

A second sweep of all 13,281 products, keeping each product's `pa_device`
terms. The first sweep kept only a count, which was not enough to seed from.

### Device availability is a property of the design, not the case type

The build previously derived a product's devices from its case type — a
family rule plus an exclusion list. That is wrong. The live catalogue varies
the device list design by design within the same construction:

| Case type | Devices (union) | Distinct device lists |
| --- | ---: | ---: |
| Signature | 46 | 24 |
| Armor Black | 22 | 7 |
| Armor Clear | 22 | 17 |
| Elite Clear | 22 | 13 |
| Alcantara | 17 | 3 |
| Essentials | 12 | 1 |

Only Essentials is uniform. Signature carries 24 different device lists across
its 165 designs.

The rule produced **22,718 variants**; the live catalogue has **13,041**. It
was inventing roughly 9,700 device/product combinations that are not for sale.
13,041 also reconciles with the sweep: 13,281 products less the 149 carrying no
device term leaves 13,132, within 1% of the variant total.

Now swept into `design-devices.ts` as 60 distinct device lists mapped across
all 525 design/case-type pairs.

### Alcantara fits 17 devices

Eight phone bodies — iPhone 15 Pro, 15 Pro Max, 16 Pro, 16 Pro Max, 17, 17 Air,
17 Pro, 17 Pro Max — plus six AirPods, the MagSafe Wallet, the Apple Watch Band
and the Card Wallet. **No Samsung devices at all.**

Two corrections to what the build assumed: Alcantara **is** made for AirPods 1/2
(previously excluded), and is **not** made for AirPods Max (previously
included).

### Alcantara is the one construction priced by device

Every other case type is flat across every device it fits.

| Device group | Price |
| --- | ---: |
| Phone cases (8 bodies) | 3,800৳ |
| MagSafe Wallet, Apple Watch Band | 2,200৳ |
| AirPods cases (6 models) | 2,100৳ |
| Card Wallet | 1,900৳ |

So an Alcantara product spans 1,900৳–3,800৳ and its card reads "From 1,900৳".

### iPhone 16e

In the device catalogue but attached to no live product, so it appears in no
design's device list. Kept, as instructed when the device list was set.

---

## 20. Images — what the catalogue actually needs

A sweep of all 13,281 live products reading their `images`, to size the job
before downloading anything. Nothing was fetched but the JSON.

### What is there

| | |
| --- | ---: |
| Products swept | 13,281 |
| Products with no image | 5 |
| Products with more than one image | 4,951 |
| **Distinct images** | **22,369** |
| Measured size, 1200w WebP | ~86 KB each |
| **Total if every image were taken** | **~1.84 GB** |

There is almost no reuse: 19,750 of the 22,369 images are used by exactly one
product, 1,978 by two. One image is shared by 290 products, which is the only
sign of a generic fallback in the set.

### Images are rendered per design per device

The filenames give the scheme away. For one design, the set reads:

```
17-Pro-Max_-95.webp   17-Pro_-95.webp   17-Air_-95.webp   17_-95.webp
16-Pro-Max_-95.webp   16-Pro_-95.webp   16-Plus_-63.webp  16_-95.webp
```

`<device>_-<design index>`. Each body gets its own render of the same artwork,
which is why the count runs to five figures rather than the 181 the design
library would suggest.

### Coverage of our catalogue

Every one of our 525 products and **all 13,041 variants** have a live image -
100%, no gaps. 1,334 of those variants share an image with another variant, so
the variants resolve to 11,707 distinct files.

### The four ways to do this

| | Images | Size | What you get |
| --- | ---: | ---: | --- |
| **A. One shot per product** | 525 | ~44 MB | Every product card and product page has correct artwork. The image does not change when the shopper picks a different device. |
| **B. All shots of one device** | 1,180 | ~99 MB | As above plus extra angles - but wrong for Signature and Alcantara, see below. |
| **C. One per variant** | 11,707 | ~0.96 GB | The picture changes with the device, as on the live site. |
| **D. Everything** | 22,149 | ~1.82 GB | Full parity including every alternate angle. |

iPhone 15 Pro Max is the most photographed body, present for 519 of the 525
products (99%); iPhone 16 Pro Max, 16 Pro, 17 Pro Max and 17 are all within two
of it. Any of them works as the representative shot for option A or B.

### Per device family — the option that is actually right

Option B is wrong, and not by a small margin. On Signature and Alcantara the
variants of one product span different **objects**, not different phone bodies:

| Case type | Products | Span >1 family | Families in one product |
| --- | ---: | ---: | --- |
| Signature | 165 | 160 | phone, AirPods |
| Alcantara | 11 | **11** | phone, AirPods, watch, card wallet, MagSafe wallet |
| Elite Clear | 131 | 0 | phone |
| Armor Black | 109 | 0 | phone |
| Armor Clear | 104 | 0 | phone |
| Essentials | 5 | 0 | phone |

A single phone shot on an Alcantara product means somebody buying a Card Wallet
is looking at a picture of a phone case. So the unit is one image per product
**per family** - phone, AirPods, Apple Watch band, Card Wallet, MagSafe Wallet -
with the best-covered body standing in for its family.

| Family | Products | Images | Representative |
| --- | ---: | ---: | --- |
| phone | 525 | 1,180 | iPhone 15 Pro Max |
| AirPods | 171 | 776 | AirPods 1/2 |
| Apple Watch band | 11 | 77 | Apple Watch Band |
| MagSafe Wallet | 11 | 77 | MagSafe Wallet |
| Card Wallet | 6 | 30 | Card Wallet |
| **Total** | | **2,140** | **~180 MB** |

**Zero gaps** - every product has a live shot for every family it sells into.
Without the extra gallery angles it is 723 images at ~61 MB.

171 of the 525 products span more than one family, so the gallery swaps when the
shopper moves between phone and AirPods and stays put while they move between
phone bodies. That is the right way round: the case that matters is covered, the
case that does not costs nothing.

### The architectural catch

Medusa attaches images to a **product**, not a variant. Options A and B fit that
model directly. Option C does not: showing a different picture per device means
either carrying a device→URL map in variant metadata and swapping the gallery
client-side, or abandoning the one-product-per-design×case-type model - which is
the whole reason this build has 525 products instead of 13,281.

So option C is not just 20x the bytes, it is a change to the data model. That
is the decision to make before anything is downloaded.
