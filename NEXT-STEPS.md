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
| Variants | 22,718 |
| Collections | 12 |
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

- **Reseeding rotates the publishable key and drops the admin user.** After any
  reseed, put the new key in `apps/storefront/.env.local` and recreate the user
  with `npx medusa user -e … -p …`. The seed prints the key.
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

## Outstanding — decisions needed

These need an answer before the work they block can be done well.

1. **Alcantara price.** The other five are confirmed (Essentials 1,400৳,
   Signature 1,400৳, Elite Clear 1,600৳, Armor Black 1,950৳, Armor Clear
   1,950৳). Alcantara is seeded at 3,800৳, which was never verified against the
   live site.
2. **Price decimals.** The build renders `1,400৳`; the live site renders
   `1,400.00৳`. Ours was a deliberate instruction — confirm it stands.
3. **Area / thana field.** Checkout requires it. The live checkout has no such
   field. Keep or drop?
4. **60 designs have no collection.** They seed without one, so they appear in
   no collection page. Is that correct, or should they get a home?
5. **Linea** — 7 designs, set up but never launched. Excluded for now. Seed
   when it launches.

## Outstanding — work

Roughly in the order it makes sense to do it.

1. **Per-design device availability.** The seed derives a product's devices
   from its case type. The live catalogue knows the real per-design device
   list, and the sweep already collected it — it just is not used yet. This is
   the largest remaining fidelity gap in the data.
2. **Product page.** Ours does not match the live one, which has a DEVICE
   dropdown, a MORE DESIGNS carousel, and a CASE TYPE selector showing each
   construction with its price. Ours has a device list picker only.
3. **Collection landing pages.** Ten exist live (Garage, Leopard, Bug Life,
   Van Gogh Dreams, Frequency, Checkmate, Wild Instinct, Muse Marvel, Florayn
   Blooms, Italian Alcantara), each a hero plus a grid of design tiles. None
   are built here. Note Fruit Punch and Stripes have no landing page live.
4. **Home page** — not matched to the live one.
5. **Header mega menu and footer** — structure captured in AUDIT.md sections 9
   and 10, not built.
6. **Design descriptions.** Seeded designs have none. The live site holds copy
   per product, not per design, so this is new copy to write rather than
   import.
7. **Checkout extras** — bKash, and a courier integration. Deliberately not
   built; COD only for now.
8. **Real product images.** Currently deterministic inline SVG placeholders.
   Needs a file provider (S3 / R2) and the host added to
   `images.remotePatterns`.

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
