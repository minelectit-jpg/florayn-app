# Checkout maintenance

This checkout belongs to `new.florayn.com` and `api.new.florayn.com`. Changes and
deployments must stay within those applications. Do not change the live
WordPress store at `florayn.com`. Read `AGENTS.md` and `PERFORMANCE.md` alongside
this document.

## Customer flow and payment

`/checkout/` is a guest checkout for Bangladesh. Name, mobile number, district,
area/thana and delivery address are required. Email and the delivery note are
optional. Phone normalization accepts Bangladeshi local/international formatting
and Bengali digits. Keep frontend and backend validation compatible.

Cash on delivery is the only connected method. The backend uses Medusa's
`pp_system_default` provider and completes the cart through the core workflow.
bKash is not configured. Do not display a selectable bKash method or an admin
enable switch until its provider, server confirmation and retry handling exist.

The Terms and Privacy routes currently contain placeholders. Checkout does not
claim that placing an order agrees to those unwritten documents. Publish
business-approved policy content before introducing an agreement statement.
Do not invent delivery guarantees, urgency, reviews or payment capabilities.

Form drafts remain in component memory; the checkout adds no customer details
to localStorage, sessionStorage or analytics. Required address/contact data is
saved to the Medusa cart/order for fulfilment. Do not log checkout request
bodies. This does not imply that customer data is absent from the backend.

## Authoritative prices and delivery

`POST /store/checkout/quote` accepts a cart ID and district. It updates the
cart's delivery selection, synchronizes bundle promotions and returns the
actual Medusa totals plus a quote version. Quoting can mutate the cart; it does
not place an order. The storefront calls it through the `quoteCheckout` Server
Action, which obtains the cart ID from its HttpOnly cookie.

The quote uses configured shipping options named `Inside Dhaka` and `Outside
Dhaka`, with real cart/region pricing. Only Dhaka district uses the inside rate;
Gazipur and Narayanganj use the outside rate. Keep option names and district
mapping consistent. The legacy `shipping` values in `/store/districts` are
estimates retained for existing consumers, not the checkout's payable amount.

Bundle rules and the free-delivery threshold remain in the existing Bundles
admin. Eligibility uses the goods amount after bundle savings. Do not duplicate
these financial controls on the Checkout settings page or calculate the final
order total from browser-supplied amounts. Use `item_subtotal` for goods:
Medusa's broader `subtotal` can include shipping after a method is attached.

`POST /store/checkout` receives delivery details and `quote_version`. Changed
items, quantities, prices, discounts or delivery require a new quote and an
explicit review/re-submit; a 409 response carries the updated quote when
available. The quote version is an HMAC-SHA256 signature of the cart ID,
currency, district, shipping option, line selections/quantities/prices and
financial totals. Signing uses the server-only `JWT_SECRET` with a checkout
domain prefix; comparisons are timing-safe. Never replace it with a plain hash
or generate it in the browser. A missing signing secret fails closed; rotating
that secret invalidates outstanding quotes and requires a fresh review.

This signature proves a server-issued financial snapshot, not the customer's
identity or authorization to access a cart. It does not replace cart/session
access controls or server-side price recalculation. Cart metadata is writable
through the standard Store API and must never be trusted merely because it
contains `checkout_quote_version`.

Quote and completion use the same checkout workflow and a per-cart lock. A
completion hook requires a valid signed quote and checks the current cart,
exactly one shipping method, and payment collection amount/currency under
Medusa's core cart lock, before order creation. Missing tokens fail with
`CHECKOUT_QUOTE_REQUIRED`; forged or stale tokens fail with
`CHECKOUT_QUOTE_CHANGED`. Keep this check in the core workflow: guarding only
the custom `/store/checkout` route would let standard Store cart metadata,
payment and completion endpoints bypass it. Any future alternate checkout must
establish the same valid quote before completion; do not weaken the hook for it.
Redis-backed locking is configured when `REDIS_URL` is present; do not remove
it when running multiple processes.

Standard Store cart mutations do not acquire the custom checkout lock. Bundle
calculation therefore returns a sorted cart-line snapshot, checked against a
fresh read before signing the quote. If lines, variant titles, quantities or
unit prices changed while the bundle workflows ran, return 409 and request a
new delivery calculation; do not sign newly changed lines with an old fixed
bundle discount. The core completion check remains necessary after this check.

## Retry and response-loss handling

Completion recovers an existing order through its cart/order link. Retries
reuse/refresh an existing payment collection instead of creating another
unconditionally. A lost response must not instruct the buyer to create a new
cart and order again.

The storefront intentionally retains the completed `florayn_cart_id` cookie.
Deleting it on successful Server Action execution loses the recovery capability
if the browser receives cookie headers but loses the response body. `getCart`
hides completed carts; the next add checks `completed_at`, creates a fresh cart
and replaces the cookie. Preserve this contract in cart refactors.

The UI blocks duplicate submission synchronously with a ref and retains the
busy state after success until navigation. Failed requests preserve entered
details. District changes invalidate the previous quote immediately; sequence
guards discard late responses and ordering requires a quote for the current
district. Backend requests have bounded waits: 15 seconds for a quote and
45 seconds for completion. A timeout does not prove that completion failed;
retry uses the same cart to recover safely.

`BuildWatcher` must not silently reload `/checkout/` after a deployment. On a
build mismatch it emits `florayn:checkout-update` and leaves its session reload
marker untouched. The form explains that an update requires a reload, preserves
the current delivery details, and blocks a new submission until the customer
reloads explicitly. Reloading clears the in-memory draft; the notice says so.
The fixed mobile action changes to **View update** and focuses/scrolls to this
notice without reloading, so the explanation is reachable from the fixed bar.
An in-flight order must finish before a reload action is offered. Other routes
retain their automatic once-per-build refresh behavior.

## Admin settings and freshness

The Medusa sidebar **Checkout** page uses `GET`/`POST
`/admin/checkout-settings`. Public `GET /store/checkout-settings` returns only
`{ settings: { heading, description, delivery_note, support_phone,
support_label, show_order_note } }`.

- `heading` and `description` control the introduction.
- `delivery_note` is an optional factual delivery message; blank hides custom
  copy and keeps the normal delivery-charge explanation.
- `support_phone` and `support_label` control the call link; blank phone hides it.
- `show_order_note` controls the customer's optional delivery-note field.

Settings live in the content module's `checkout_setting` singleton. Reads
return defaults without inserting rows. Writes validate a strict display-only
patch and run `updateCheckoutSettingsWorkflow`. Admin saves queue scoped
`content:checkout` invalidation; storefront settings fetches carry `content`
and `content:checkout` tags and a 60-second revalidation interval. Bare
`checkout` is not an allowed cache domain. Checkout quotes, completion and order
reads remain uncached; never add them to a shared HTML/API cache rule.

The new table is introduced by generated `Migration20260920194733.ts`. Existing
migrations must remain unchanged. The dedicated
`src/scripts/migrate-checkout-settings.ts` helper provides read-only preflight
and an explicit, single-migration apply mode; inspect its guards before use.
Do not run general seeding, schema generation or unrelated historical migrations
against an application database as part of a checkout release.

## Payloads and verification

Keep the client boundary narrow. `checkout-form-data.ts` projects line ID,
title, selected model/case, quantity, amounts and one selected-variant image.
Never pass raw product metadata, card pair matrices or all variants to the
checkout component. The quote must retain that selected-device image. The
checkout does not change catalog grouping, product URLs, shop image scheduling
or persistent optimized-image storage.

Run from the repository root:

```sh
npm test
npm --prefix apps/storefront run typecheck
npm --prefix apps/backend run build
npm --prefix apps/storefront run build
```

Storefront fixture build configuration is documented in `PERFORMANCE.md`.
`tests/fixtures/mock-store-api.cjs` supplies disposable, in-memory checkout
endpoints for local UI tests and never forwards requests. Its synthetic
checkout controls exercise changed prices, temporary failures and a lost
completion response. They are not a replacement for real Medusa integration.

The separate `checkout-integration` CI job provisions fresh PostgreSQL 17 and
Redis 7 services, runs `medusa db:migrate --skip-scripts`, then executes
`src/scripts/verify-checkout-isolated.ts`. The runner requires
`CHECKOUT_ISOLATED_TEST=1`, a `florayn_checkout_test_*` database name and no
existing orders. It verifies real shipping prices in both delivery zones,
bundle/free-delivery changes, and changed-quote review. Standard core cart
completion is exercised with missing, forged and stale quote tokens and must
create no orders. Two simultaneous first submissions and subsequent concurrent
retries must return the same COD order, with exactly one order stored. Preserve
these checks when modifying the custom routes, public cart flows or locking.
The same job checks scoped migration preflight and already-applied idempotence.
Never point this runner at the application database or Redis instance.

Isolated runs explicitly use a loopback `STOREFRONT_URL`, an empty revalidation
secret and no external storage/payment/email credentials. An empty storefront
URL would enable the warmer's deployed-site fallback. Disposable PostgreSQL
URLs include `?sslmode=disable` to avoid Medusa assuming SSL for Docker hostnames;
do not copy that test setting into unrelated production connections.

Before release, verify mobile and desktop layouts, keyboard/error focus,
district changes, selected model imagery, changed-total review and retry
behavior. Use local/disposable fixtures for order placement. Routine visual QA
must not create customer-facing orders or send real payment/email requests.
