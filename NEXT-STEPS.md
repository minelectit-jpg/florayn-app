# Next steps

Where this repo was left, and what to pick up. Written at the end of the
session that seeded the real catalogue.

---

## Where we are

A working Medusa v2 backend and Next.js storefront, seeded from the live
florayn.com catalogue.

| | State |
| --- | --- |
| Designs | 181, read from the live `pa_more-designs` taxonomy |
| Case types | 6 — Essentials, Signature, Elite Clear, Armor Black, Armor Clear, Alcantara |
| Devices | 50 |
| Products | 525 (design × case type) |
| Variants | 13,041 — matches the live catalogue exactly |
| Collections | 12 |
| Pricing | Flat per case type, except Alcantara which varies by device group |
| Checkout | One page, Cash on Delivery, working end to end |

Read [AUDIT.md](AUDIT.md) first — it records what the live site actually does
and where the two diverge. It is the source of truth for anything about
florayn.com, and its final section lists what was never covered.

## Running it

PostgreSQL is a **portable install** with no Windows service, so it has to be
started by hand after a reboot:

```bash
powershell -ExecutionPolicy Bypass -File scripts/pg.ps1 start
```

Then, in two terminals:

```bash
npm run backend:dev
```

```bash
npm run storefront:dev
```

Storefront on :8000, admin on :9000/app. Admin login is
`admin@florayn.local` / `REDACTED`.

Full setup, including why the storefront is not an npm workspace member, is in
the README.

## Gotchas that cost time this session

- **Reseeding needs the database dropped first.** The seed refuses to run over
  a seeded catalogue. Stop the backend so it releases its connections, then
  drop and recreate `florayn` and run `npm run backend:migrate`, which runs
  the migrations and the seed together.
- **Reseeding rotates the publishable key and drops the admin user.** After any
  reseed, put the new key in `apps/storefront/.env.local` and recreate the user
  with `npx medusa user -e … -p …`. The seed prints the key. Restart the
  storefront afterwards or it serves 500s with the old key.
- **Never run `next build` while `next dev` is running** on the same `.next`.
  It corrupts the dev server with `Cannot find module ./vendor-chunks/*`. Stop
  dev, delete `.next`, then build.
- **A stale storefront on :8000 serves 500s after a reseed** because it still
  holds the old key. Kill every `next` process, do not assume one restart is
  enough.
- **Reading PHP through the MCP connector returns base64**, so large files are
  expensive. Prefer the public Store API or plain HTTP where the data is
  available that way.

## The live-site connector is read-only

The Novamira MCP connector points at the **live production store**. Read only —
never write, edit, create, delete or execute. The full rule, with the specific
abilities that are off limits, is in [AGENTS.md](AGENTS.md).

Everything in this session's audit was obtained without an execute ability,
mostly through WooCommerce's public Store API. That is usually enough:

```
/wp-json/wc/store/v1/products/attributes            # taxonomies
/wp-json/wc/store/v1/products/attributes/<id>/terms?hide_empty=false
/wp-json/wc/store/v1/products?_fields=name,attributes,categories
/wp-json/wc/store/v1/cart                            # currency + shipping
```

`hide_empty=false` matters — without it the terms endpoint hides terms that
have no products and undercounts.

---

## Settled

Decided and implemented, recorded here so they are not reopened.

- **Alcantara pricing.** The only construction whose price varies by device:
  3,800৳ phone shells, 2,200৳ MagSafe Wallet and Apple Watch Band, 2,100৳
  AirPods, 1,900৳ Card Wallet. The other five are flat. See `price_groups` in
  case-types.ts.
- **Price format** is `1,400৳` — no decimals — everywhere.
- **Checkout keeps the area/thana field**, though the live checkout has none.
- **The 60 designs with no collection** stay as they are: seeded, in no
  collection.
- **Linea** — 7 designs, set up but never launched. Still excluded; seed them
  when it launches.
- **Multi-buy tiers** are live and editable in the admin under **Bundles**:
  2-pack 300৳ off clamped to 8-12%, 3-pack 800৳ off clamped to 12-20%, free
  delivery over 3,400৳. The discount is applied for real at checkout as a
  single-use promotion, recomputed server-side from the cart's own lines.
- **The Matching Set bundle** is deliberately not built: it needs a Signature
  Pen product type that does not exist in the catalogue.

## Outstanding — work

Roughly in the order it makes sense to do it.

1. **Collection landing pages.** Ten exist live (Garage, Leopard, Bug Life,
   Van Gogh Dreams, Frequency, Checkmate, Wild Instinct, Muse Marvel, Florayn
   Blooms, Italian Alcantara), each a hero plus a grid of design tiles. None
   are built here. Note Fruit Punch and Stripes have no landing page live.
2. **Home page** — not matched to the live one.
3. **Header mega menu and footer** — structure captured in AUDIT.md sections 9
   and 10, not built.
4. **Per-design product copy.** Every product carries the case type's
   description. The live site has copy per product; there is none per design.
5. **Checkout extras** — bKash, and a courier integration. Deliberately not
   built; COD only for now.
6. **Real product images.** Currently deterministic inline SVG placeholders.
   Needs a file provider (S3 / R2) and the host added to
   `images.remotePatterns`.

## The product page needs data, not layout

Built and measured against florayn.com. Two parts are structure only, because
the data behind them does not exist yet:

- **Reviews.** Ratings pool per design on the live site - every case type built
  from one design shares one score and one list. Needs a review store: a
  `review` entity linked to `design` (not product), with rating, body, photo,
  author and verified-purchase flag. Until that exists the tab renders an
  explanation, not fake stars.
- **Design-level video.** The gallery renders a video as a slide as soon as a
  design carries a URL. No design in the catalogue has one, and the live
  product pages sampled had none either.

Also unresolved by data alone: **"Pairs well with"** on the live site shows the
same design in another *product form* - an AirPods case beside a phone case.
Here a device is a variant, not a product, so there is no separate AirPods
product to link. It currently shows the same design in a construction that
covers non-phone devices, which is the nearest true equivalent.

## Known gaps that need a rule change to close

Both need a write or execute ability on the live site, which is off limits:

- WooCommerce **email settings** (header image, colours, footer text).
- **Hand-made WooCommerce coupons.** The Review Rewards programme is
  documented (photo review 15%, text-only 10%, 60-day expiry) because it lives
  in plugin code; anything created by hand in admin does not.

---

## Not pushed

`origin` is set to `https://github.com/minelectit-jpg/florayn-app.git`, but that
repo returns 404 and this machine has no git credentials and no `gh` CLI.
Nothing has ever been pushed. Once the repo exists and you are authenticated:

```bash
git push -u origin main
```
