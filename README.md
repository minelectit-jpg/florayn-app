# Florayn

Medusa v2 backend and a Next.js storefront for printed cases, in one Turborepo
workspace.

```text
apps/
  backend/      Medusa v2 (API + admin dashboard)  -> http://localhost:9000
  storefront/   Next.js App Router                 -> http://localhost:8000
```

## The data model

This is the part that decides everything else, so it is worth stating plainly.

**A product is one design in one case type.** Not one design, and not one
design-device pair.

```text
Design            Caterpillar Maze                  ~189 of these
  x Case type     Armor Black                       6 of these
  = Product       "Caterpillar Maze - Armor Black"  ~400-600 of these
      Variants    iPhone 17 Pro Max, Galaxy S24 ... one per compatible device
```

The alternative - a product per design-device pair - produces ~14,000 products
and makes the catalog unmanageable. Devices are the variant axis instead, so a
design in a finish is a single page a customer picks their device on.

### Case types

Six constructions, in `apps/backend/src/modules/catalog/data/case-types.ts`:
Essentials, Armor Clear, Armor Black, Elite Clear, Signature, Alcantara.

Each declares which device families it is tooled for, plus any individual
devices it is not made for. That is what decides a product's variant list at
seed time - a product only gets variants for devices its case type actually
fits, so nothing needs to be greyed out in the storefront.

### Devices

`apps/backend/src/modules/catalog/data/devices.ts` is the single source of truth
for the variant axis: iPhone 11 through 17 Pro Max, Galaxy S22-S25, AirPods
1/2/3/4/Pro/Pro 2/Pro 3/Max, Apple Watch bands and the Card Wallet.

**This file currently holds 62 devices, not 126.** The families and ranges you
named are all covered, but the exact 126-row list is yours - replace or extend
the array and reseed. Nothing else in the codebase hardcodes a device count.

Variant price = the case type's `base_price` + the device's `price_delta`, in
BDT. SKU is `DESIGN-CASETYPE-DEVICE`, e.g. `CATMAZE-ARMBLK-IP17PM`.

### Where each thing lives

| Concept | Stored as |
| --- | --- |
| Design, Case type, Device | `catalog` module (custom) |
| Design -> Product, Case type -> Product | Module links (`src/links/`) |
| Product | Medusa product, `handle` = the URL slug |
| Device | Medusa variant, under a single `Device` option |
| Theme (Abstract, Floral, ...) | Medusa **collection** |
| Case type, device family | Medusa **categories** |

Design and case type are also mirrored onto `product.metadata` so the Store API
can render a product card without a second round trip.

## URLs

These two are contractual and must not change shape:

```text
/product/<slug>/       slug = <design-slug>-<case-type-slug>
/collection/<slug>/
```

`trailingSlash: true` in `apps/storefront/next.config.ts` is what keeps the
trailing slash. `/collection/<slug>/` resolves a Medusa collection first, then
falls back to a category with the same handle, so both themes and case types
live at that one URL shape.

## Running it

### PostgreSQL

Development uses a portable PostgreSQL 17 install - the EDB binaries zip
unpacked to `%USERPROFILE%\pgsql-root`, with its data directory at
`%USERPROFILE%\pgsql-data`. There is no Windows service, so start it by hand
after a reboot:

```bash
powershell -ExecutionPolicy Bypass -File scripts/pg.ps1 start
```

`stop`, `status` and `psql` work the same way. Set `FLORAYN_PG_BIN` and
`FLORAYN_PG_DATA` if your install lives elsewhere.

The database is `florayn`; `apps/backend/.env` holds the connection string.

### The apps

```bash
npm run setup
npm run backend:migrate
```

`setup` installs twice on purpose. **The storefront is not an npm workspace
member.** Medusa's admin peers on React 18 and Next 15's App Router needs React
19; npm workspaces hoist a single React for the whole tree, so sharing one
install makes Next resolve the backend's React 18 and fail with React error #31
at build time. `apps/storefront` therefore has its own `node_modules` and
lockfile. Turbo manages the backend; the storefront runs through
`npm --prefix apps/storefront`.

`db:migrate` also runs the scripts in `apps/backend/src/migration-scripts/`, so
the first migrate seeds the catalog. `npm run backend:seed` runs the same seed
on demand; it exits without changing anything if the catalog already has data.

Then, in two terminals:

```bash
npm run backend:dev
```

```bash
npm run storefront:dev
```

- Storefront: http://localhost:8000
- Admin: http://localhost:9000/app

Create an admin user:

```bash
cd apps/backend && npx medusa user -e you@example.com -p yourpassword
```

The seed prints a publishable API key. Put it in
`apps/storefront/.env.local` as `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, or read it
back from the database later:

```bash
cd apps/backend && npm run key
```

## Seed data

Five designs, published across the case types each is offered in - 21 products
and roughly a thousand variants. Region is Bangladesh, currency BDT, shipping is
Inside Dhaka (৳60) / Outside Dhaka (৳120).

Reseeding requires a fresh database; the seed refuses to run twice.

## Custom Store API

The stock Store API cannot express the design-to-products join, so the catalog
module adds:

```text
GET /store/designs           the artwork library
GET /store/designs/:slug     one design plus every product it is published in
GET /store/case-types        the six constructions and the devices they fit
GET /store/devices           the device list, grouped by family
```

All of them need the `x-publishable-api-key` header.

## Adding a design

1. Add a row to `apps/backend/src/modules/catalog/data/designs.ts` with the
   case types it ships in.
2. Reseed, or create the products in the admin - one per case type, with
   `design_slug` and `case_type_slug` in the product metadata.

For the real ~189-design catalog, write an import script that reads your artwork
source and calls `createProductsWorkflow` the way the seed does.

## Not built yet

- **Checkout.** The cart is real (Medusa carts, line items, BDT totals) but
  there is no address, shipping-selection or payment step. Shipping options and
  the manual payment provider are already configured in the backend.
- **Admin CRUD for the catalog module.** Designs, case types and devices are
  seeded from the data files and readable through the Store API, but the admin
  dashboard has no screens to edit them. The product page does show a Catalog
  widget with the design and case type. Adding real screens means an admin route
  plus API routes under `src/api/admin/`.
- **The full 189-design import.** Only the 5 sample designs exist.
- **Product images.** The seed points at `picsum.photos` placeholders. Wire up a
  real file provider (S3, Cloudflare R2) before loading actual artwork.
