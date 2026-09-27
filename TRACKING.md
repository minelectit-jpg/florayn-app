# TRACKING.md - Florayn ad tracking, live dashboard and catalog feed

Status: FINAL build spec, revision 2, 2026-09-27. It replaces the first draft:
every blocking issue from the skeptic review is resolved (section 0.4), the
owner decisions of 2026-09-27 are recorded (section 0.1) and the work is cut
into dependency waves with single file ownership (section 13).

As built, 2026-09-27: all fifteen packages are done. Where the final code
differs from this spec, the code wins. Section 19 records every difference and
why, the verification results and the steps left for the operator and the
owner; statements below that the code contradicts carry a short "As built"
note pointing there. No owner decision (0.1) changed.

Scope: `apps/storefront` (Next.js 15.5.25, React 19, its own lockfile) and
`apps/backend` (Medusa 2.19, npm workspace of the root). Hosts: `new.florayn.com`
(storefront, behind Cloudflare) and `api.new.florayn.com` (backend, not proxied)
now; `florayn.com` after cutover.

Read with AGENTS.md, PERFORMANCE.md, CHECKOUT.md, WOMEN_MEN.md and
HEADER_SEARCH.md. Where this spec needs one of those docs changed, it says so and
WP13 makes the change.

How builders use this file:
- Read sections 0 to 4 in full, then the sections your package names.
- Section 13 lists every file and its single owner. Edit only files your package
  owns (plus new tests it names). If you truly need a change elsewhere, do not
  make it: report it as a deviation.
- Never run `next build`, `npm install`, `git commit`/`push`, deploys,
  `db:migrate` or anything against production. Write migration files only.
- Tests: `cd apps/backend && node --test tests/<file>.cjs` and
  `cd apps/storefront && node --test tests/<file>.cjs`. Type-check with
  `npx tsc --noEmit -p apps/backend` or `-p apps/storefront`.
- Backend lint: `npx eslint <your files>` from the repo root (the
  `@medusajs` recommended rules that `medusa build` enforces).
- Code style is AGENTS.md: no semicolons, double quotes, 2-space indent,
  kebab-case files, camelCase functions, snake_case DB columns, no emojis. Each new
  file starts with a short comment that says why it exists; comment density
  matches the neighbouring code.
- Never print, log or commit a secret value.

---

## 0. Decisions

### 0.1 Owner decisions

2026-09-26:
- Tracking is built into the shop. No GTM, no server GTM, no PixelFly, Stape or
  other middleman.
- All three platforms matter. TikTok optimises on `Purchase`. Meta catalog
  (Advantage+ catalog) ads WILL run, so the shop publishes a catalog feed.
- GA4 is not used. A live dashboard in Medusa admin replaces it.
- Sized for 300+ orders a day, about 100k events a day.

2026-09-27 (final, do not re-argue):
1. Meta is built and QA'd first. TikTok and Google Ads code is built in the
   same components but is DISABLED by default until their tokens and a test
   pixel exist. There is no TikTok test pixel yet.
2. Meta live dataset `650439547920083`. Meta TEST dataset `2247389409441720`.
   `new.florayn.com` routes to TEST. The live hosts `florayn.com` and
   `www.florayn.com` route to live only when `live_armed` is on.
3. `share_contact_hashes` stays OFF until the owner approves the Privacy page
   and the checkout consent sentence. Claude drafted both (Appendix A and B);
   the owner approves them later in admin.
4. About 5 real TEST ORDERs on new.florayn.com are approved for QA. They are
   named "TEST ORDER", go only to the TEST destinations and are cancelled
   afterwards.
5. The R2 custom domain `https://img.florayn.com` is attached to the bucket
   `florayn-images` (same keys as the `pub-...r2.dev` URLs), so catalog JPEG
   copies are served from it.
6. Staff DO place orders through the website on their own devices. The staff
   exclusion (`/api/t/staff/`, internal flag) is required.
7. Purchase value = order total including delivery (what the buyer pays). The
   Live dashboard's daily target is 300 orders. "No Purchase" alerts only
   between 10:00 and 24:00 Dhaka. Alert email `floraynweb@gmail.com`.
8. Loading: the Meta pixel loads for every visitor after load + idle. The
   TikTok pixel and the Google tag load only for visitors who came from those
   ads (`ttclid`; `gclid`, `gbraid`, `wbraid`). Google Ads runs only on live
   hosts.
9. Catalog: include all variants except Alcantara, which is held back until
   its per-device prices are confirmed identical to checkout.
10. The owner will turn OFF Meta Automatic Advanced Matching on both datasets
    before the pixel loads. The code must still never send PII while share is
    OFF.
11. Infra steps that need the owner's OK later (origin port 443 firewalled to
    Cloudflare ranges, a Cloudflare Transform Rule that adds the
    `x-florayn-edge` header, env vars) are not done yet. The code must be SAFE
    without them: no ad-platform send without a valid edge header.
12. `capi-param-builder-nodejs@1.3.2` is already installed in
    `apps/storefront` (exports `ParamBuilder`, `CookieSettings`,
    `PlainDataObject`, `PII_DATA_TYPE`). Agents do not run `npm install`.

Answers to the first draft's open questions, so nobody asks again:
- Consent is a plain notice line under Place order (not a checkbox), shown only
  while share is ON (Appendix B).
- Google stays off on new.florayn.com. Enforced in code: Google has no test
  environment at all (section 3.4).
- An order booked with the courier straight from Processing counts as
  confirmed. A "Cancelled" event is not in this build.
- On cutover day the owner switches off PixelFly, the WooCommerce pixel and
  GTM-M5LBZFGL on WordPress, and disconnects the old catalog (section 18).

### 0.2 Dependencies that are missing (reported, not installed)

| Package | Where | Status and handling |
|---|---|---|
| `sharp` | `apps/backend` (root lockfile) | As built: INSTALLED with the owner's approval, `sharp@0.34.5` in `apps/backend/package.json` and the root lockfile (commit f65dd96); the backend image installs it, so the rest of this row is history (19.4). Originally: NOT installed. Needed only to make JPEG copies of catalog images. WP08 loads it lazily (`await import(moduleName)` with a non-literal name and a local type) and reports "sharp is not installed" in Admin > Tracking > Catalog instead of failing. An operator runs `cd apps/backend && npm install sharp` with the owner's OK, commits the lockfile change and rebuilds the image. Until then catalog images can use `image_mode: "cf_transform"` (needs Cloudflare Image Transformations enabled on the florayn.com zone, owner OK) or the feed publishes no items (items without an image are left out). |
| `server-only` | `apps/storefront` | NOT installed. Server modules use the runtime guard in section 4.8 instead, and a test asserts no client component imports them. |

### 0.3 Corrections to the approved plan

Each is forced by a repo rule or a vendor limit.

| # | Approved plan said | This spec does | Why |
|---|---|---|---|
| C1 | Purchase `event_id` = order id | `event_id` = `fl-<display_id>` (e.g. `fl-1234`), also used as `order_id` / `transaction_id`. The raw `order_...` id never leaves the backend. | `/order/<order.id>/` is a guest access capability that must not reach analytics (CHECKOUT.md, "Order confirmation"). `display_id` is not a capability. The `fl-` prefix cannot collide with WooCommerce numeric ids already sent to the same Google conversion action. |
| C2 | Meta PageView on every client route change with a shared event_id | First-load PageView goes browser + server with a shared id. Route-change PageViews are server-only (CAPI) with their own id, and `fbq.disablePushState = true`. Every browser copy fires only while `location.pathname` equals the item's pathname. | fbevents.js fires one explicit PageView per page load and silently drops repeats. Its history listener carries no eventID and would report `/order/<id>/` after `router.push`. |
| C3 | TikTok gets the same standard events | TikTok PageView is browser-only (`ttq.page()`); the Events API gets VC, ATC, IC and Purchase. TikTok's SPA page views are switched off (owner step C and the `spa_off_confirmed` gate). | Events API v1.3 has no web PageView. Its automatic history observer would report `/order/<id>/`. |
| C4 | Context in `order.metadata.tracking` | Context lives in tracking-module tables (`tracking_cart_context`, `tracking_order_context`). Nothing tracking-related is read from cart or order metadata. | Cart metadata is writable through the public Store API and is copied onto the order. `GET /store/orders/:id` is public by id and returns metadata. |
| C5 | A test/live switch | Destination is chosen by request host. Hosts are allowlisted (`test_hosts`, `live_hosts`); any other host is off. `new.florayn.com` goes to TEST; live hosts go live only when `live_armed`. Google only in live. | `test_event_code` does not keep test traffic out of ad data. Host routing makes cutover a DNS change, not a settings race. |
| C6 | Parameter Builder with the eTLD+1 | `capi-param-builder-nodejs` is used only to produce `_fbp`/`_fbc`. Our own cookie rule applies: host-only, except `Domain=florayn.com` on live hosts. Its hashes, phone normaliser and suffixed values never leave Meta CAPI. PII hashing is ours (`bdMobile()`). Known limit: once fbevents.js runs on new.florayn.com it writes `_fbp`/`_fbc` itself with `domain=.florayn.com`; this is accepted because new.florayn.com traffic is QA. | Its phone normaliser hashes 01XXXXXXXXX as 1XXXXXXXXX. It appends suffixes to IP, hashes and URLs. |
| C7 | Hashed PII to fbq/ttq/gtag | Only when `share_contact_hashes` is ON. The server refuses to turn it ON unless the consent text is non-empty AND the Privacy page is published. The Meta browser pixel does not load for an environment until the admin ticks "Automatic Advanced Matching is OFF" for that dataset (test or live). | Bangladesh PDPA 2026 does not exempt hashed data. CHECKOUT.md forbids customer details in analytics until approved text exists. Meta AAM reads form fields regardless of our code. |
| C8 | One shared secret as a bearer key | One env secret `TRACKING_INGEST_SECRET` in both apps, never sent over the wire. Headers carry derived keys `HMAC-SHA256(secret, "<purpose>-v1")`; the backend also accepts `TRACKING_INGEST_SECRET_PREVIOUS` while rotating (section 4.7). | Keeps the raw secret off the wire and separates its uses. The backend deploys before the storefront, so rotation needs an overlap. |
| C9 | Google enhanced conversions from phone | Ships, but phone-only orders will NOT enhanced-match. | Google needs an email, or full name + address with postal code. The checkout has no postal code. |

### 0.4 Skeptic review: blocking issues and where each is fixed

| # | Issue | Resolution | Where |
|---|---|---|---|
| B1 | Changing `checkoutWorkflow`'s output breaks `/store/checkout/quote` and the isolated CI script | `checkoutWorkflow` stays byte-identical. A new `checkoutWithTrackingWorkflow` (same file) reuses the same `prepare-checkout` step, adds two tracking steps that return `new StepResponse(...)`, and folds the tracking block into `body` with `transform` only when it exists. Only `/store/checkout/route.ts` switches to it. A test asserts the quote route and the old workflow are unchanged. | 6.5, WP05 |
| B2 | `emitted` set before the outbox insert can lose a Purchase forever | The `emitted` column is gone. Order context, hit and outbox rows are written in ONE knex transaction, idempotent by primary/unique keys. A platform that is off still gets a `skipped` Purchase row, so reconciliation is exact: "context exists, no `tracking_event (platform, 'Purchase', 'fl-N')` row at all". A test injects a failure between inserts. | 2.3, 6.5, 6.6, 7 |
| B3 | Vendor stub queues (`fbq.queue`, ttq, `dataLayer`) can flush on `/order/<id>/` | Vendor functions are never called before that vendor's script `onload`; items wait in our queue. Every vendor call checks, at call time, that `location.pathname` is public and equals the item's pathname. No script is injected while the path is private. Purchase browser copies are skipped for a vendor that is not loaded yet (server copy covers Meta and TikTok). The gtag conversion passes `page_location: "https://<host>/checkout/"`. TikTok loads only after `spa_off_confirmed` (owner switches off SPA page views and automatic events). QA step 7 (Slow 3G, submit within 2 s of load). | 5.2, 5.5, 15 |
| B4 | Meta Automatic Advanced Matching reads checkout fields while share is OFF | Owner turns AAM off on both datasets (decision 10). Code gate: `meta.aam_off_confirmed.<env>` must be ticked in admin for the resolved environment or the Meta browser pixel never loads there (CAPI still works). The live dataset's AAM can stay on for the WordPress site until cutover; it is turned off (and ticked) before `live_armed`. Admin shows the warning. QA: with share OFF, no `facebook.com/tr` request from `/checkout/` carries a contact hash; `ud[external_id]` (the `_fl_vid` hash) on Purchase is expected. | 3.1, 5.5, 15 |
| B5 | Public endpoints can inject events into Meta/TikTok through the origin | No ad-platform row is ever created from a request that failed the edge check (`x-florayn-edge` == `TRACKING_EDGE_SECRET`, timing-safe). Without it `/api/t/id/` sets no cookies and `/api/t/e/` forwards nothing. Hosts are allowlisted in both apps. The backend replaces client prices with the variant index price, clamps values, and sends no ad row for unknown variant ids (still counted). The forwarder has a global events-per-second cap with a counter and an alert. Origin firewall is an owner infra step. | 3.4, 4.2, 4.3, 6.1, 10, 16 |
| B6 | Ingest envelope cannot carry coalesced traffic; Medusa's 100 KB JSON limit | Envelope is `{ v, stats?, batches: [{ host, ctx, events }] }`, at most 200 events and 256 KB per request; the forwarder splits. WP04 owns the `middlewares.ts` entry `{ matcher: "/tracking/ingest", method: ["POST"], bodyParser: { sizeLimit: "512kb" } }`. A test pushes a 64 KB batch end to end. | 4.3, WP04 |
| B7 | A "+0 B shared" gate against a committed baseline cannot pass | CI builds the merge-base and the head with the same fixture environment and compares them. Framework chunks exactly +0 B, webpack runtime at most +64 B, `.js` only, layout set unioned into each page's first load. PERFORMANCE.md wording updated by WP13. | 11, WP00 |
| B8 | Landing click ids and referrer are read too late | The stub snapshots `{ allowlisted params, referrer origin, pathname }` on its first effect into `window.__fl.landing`, and posts it to `/api/t/id/` at the first idle after hydration (not after the 3 s wait). With a click id on the landing, the runtime starts at `load`. On live hosts `/api/t/id/` also sets `_gcl_aw` for a gclid (QA-verified at cutover). | 5.1, 4.2 |
| B9 | The runtime cannot learn `share` | `/api/t/id/` returns `share`, `consent_version` and a `landing` summary. The response type lives in one module, `apps/storefront/src/lib/tracking/contract.ts`, with a shared vector fixture tested on both sides. | 4.1, 4.2 |
| B10 | A missing or mismatched secret silently kills every Purchase and no alert fires | "Storefront orders" = orders with `metadata.checkout_quote_version` set, `is_draft_order = false` and no `order_op.source`. Alert `checkout_without_tracking` when such an order in the last hour has no `tracking_order_context`; alert `purchase_not_enqueued` when a trusted context has no Purchase row. Counter `checkout.header_rejected`. Previous secret accepted while rotating. | 4.7, 10 |

Package conflicts from the review are resolved in section 13 (single owner per
file, shared `contract.ts` and `order-events.ts`, WP06 after WP05, the
`middlewares.ts` entry owned by WP04, staff/optout flags always sent, one
`outboxHealth()` used by Health and Live, one feed-guard alert path, TikTok test
event is ViewContent, no new imports in `lib/order-ops.ts`).

### 0.5 Review improvements

Adopted (numbers follow the review's list):
- I1 Phone clock skew: batches carry `sent_at`; the storefront computes each
  event time as `server_now - (sent_at - t)` (section 4.2).
- I2 OrderConfirmed on any move INTO confirmed/shipped/delivered, once per order
  by the outbox key (section 7). As built: only from a status before
  confirmation, because the outbox key lasts only as long as its row (19.3,
  WP06).
- I3 Missing token: Purchase and COD rows are enqueued as `blocked`
  (`no token`) so the token-fingerprint requeue recovers them; funnel events are
  not enqueued (counted). A platform that is off gets `skipped` Purchase rows, so
  backfill after using the rollback lever is an explicit admin action (Retry
  with `skipped`), never a side effect (sections 6.1, 6.3).
- I4 Stale `sending` rows are reset to `retry` by the sweep (section 6.3).
- I5 `no_purchase` alert: live hosts only while armed, active 10:00-24:00
  Dhaka, and only when the last 14 days make zero Purchases in the window
  unlikely (section 10).
- I6 Stale detection and kicks cover all four jobs through one jobs registry
  (section 6.4). (Merging the jobs into one file is rejected, below.)
- I7 Bounce capture: the stub posts `/api/t/id/` at first idle and beacons
  unsent events on `pagehide`, with no vendor code (section 5.1).
- I8 Live revenue from `query.graph` order `total`; `is_draft_order` and
  `canceled_at` / op status for cancelled (section 9).
- I9 ViewContent once-guard is a per-mount ref (section 5.4).
- I10 Feed links use root product URLs, never `/men` (section 8).
- I11 Feed publish is skipped when the item set's content hash is unchanged
  (section 8).
- I12 C6 limitation documented (0.3).
- I13 Cookie hygiene: `_fl_gclid` and `_fl_src` values are base64url; only
  `_fbp`/`_fbc` are taken from ParamBuilder; our own Domain rule (section 4.2).
- I14 Rate limit per visitor id AND a higher per-IP ceiling (section 4.2).
- I15 `received_at default clock_timestamp()`; ingest sets
  `statement_timeout = 5s`, below the rollup's 20 s grace (sections 2.4, 9).
- I16 Secrets are written straight through the module service in the route;
  only non-secret config goes through the workflow (section 3.3).
- I17 The isolated CI script sets a fake TEST dataset id + token and dry-run
  (section 14).
- I18 Derived keys and previous-key rotation (section 4.7).
- I19 On `/checkout/` keep `requestIdleCallback`, drop only the 3 s wait;
  measure checkout INP before/after (section 11).
- I20 Server-side C7: share ON requires `privacy_setting.published` (section
  3.2).
- I21 TikTok test event is ViewContent (section 4.6).
- I22 Post-deploy checks use a browser user agent (section 16).
- I23 Names come from the stored `shipping_address.first_name/last_name`; Meta
  `fn`/`ln` also drop internal spaces (section 6.2).
- I24 Only valid-token feed fetches are logged (section 8).
- I25 `CheckoutLine.variant_id` is optional (section 5.4).
- I26 TikTok COD events are not built this round (no optimisation value, and
  they would need a TikTok CRM event set rather than the web pixel).
- I27 `tracking_event` gets `fillfactor = 70` and aggressive autovacuum
  (section 2.2).

Rejected, one line each:
- Merging the every-minute jobs into one job file: one file would be owned by
  four packages and a slow outbox flush would delay rollups; the registry plus
  stale kicks gives the same resilience.
- Storing edge-less events as "untrusted" dashboard hits: without the edge
  check an attacker at the origin could fill the dashboard too; they are dropped
  and counted instead.
- v1 `server_scope` setting: only one sensible value exists, so it is removed.
- v1 `google.on_test_hosts`: removed to enforce owner decision 8.
- v1 `tiktok.status_events`: removed with I26.
- Heartbeat pings for "on site now": multiply requests 10-20x for little gain.
- `meta-capi-param-builder-clientjs`: 20 KB gz in the browser for what the pixel
  already does.

---

## 1. Architecture

```
Browser (every page)                       Storefront (Next, behind CF)                    Backend (Medusa, api.new.florayn.com)
----------------------------------------   ---------------------------------------------   ----------------------------------------------
layout: <TrackerStub/> (renders null)      POST /api/t/id/   edge check, host allowlist,    GET  /store/tracking-config (public ids/modes)
  window.__fl = { q, landing, cfg, wake }    cookies (_fl_vid,_fl_sid,_fl_src,_fbp,_fbc,     POST /tracking/ingest (x-florayn-ingest-key)
  PageView per pathname                      ttclid,_fl_gclid,_gcl_aw), public cfg + share    -> tracking_hit + tracking_event (one tx)
  first idle: import(boot) -> /api/t/id/   POST /api/t/e/    edge check, validate, clock      -> scheduleFlush -> Meta CAPI / TikTok API
  pagehide: sendBeacon unsent -> /api/t/e/   fix, rate limit -> 204, after(): forward ---->  POST /store/checkout (+ tracking headers)
  load(+3s)+idle: import(runtime)          GET  /api/t/staff/, /api/t/optout/                  checkoutWithTrackingWorkflow:
runtime chunk (lazy, <= 6 kB gz)           Server Action submitOrder: headers()/cookies()     stash ctx -> prepare-checkout -> record
  loads fbevents / ttq / gtag per cfg        -> x-florayn-ingest-key + x-florayn-tracking      -> order ctx + Purchase hit + outbox (one tx)
  fires browser copies after onload        -> /store/checkout                                 -> response.body.tracking (browser block)
  batches server copies to /api/t/e/                                                         lib/order-status.ts: every workflow_status
components call track():                                                                       writer -> OrderConfirmed/Delivered/Returned
  ProductView -> ViewContent                                                                 jobs: tracking-outbox (1 min), tracking-rollup
  CartProvider.add/addMany -> AddToCart                                                        (1 min), tracking-reconcile (5 min),
  CheckoutForm mount -> InitiateCheckout                                                       catalog-feed (15 min) + jobs registry kicks
  CheckoutForm result.ok -> trackPurchase                                                    GET /feeds/<token>/meta.tsv(.gz), tiktok.tsv
                                                                                             admin: Tracking, Tracking > Health,
                                                                                               Tracking > Catalog, Live, Privacy
```

Invariants (every package must keep all of them):
1. Every event has one `event_id` shared by all its copies (browser pixel, Meta
   CAPI, TikTok API, dashboard hit). Route-change PageViews have exactly one
   copy per platform.
2. Durable state lives only in Postgres. Redis is `allkeys-lru`, was OOM-killed
   3x on 2026-09-19, and the event bus runs with `attempts: 1`. Nothing depends
   on `order.placed` or on Redis keys. Each job records its runs in
   `tracking_state`, and ingest/admin requests kick stale jobs (section 6.4).
3. Browser-originated events may only be `PageView`, `ViewContent`,
   `AddToCart`, `InitiateCheckout`. `Purchase`, `OrderConfirmed`, `Delivered`
   and `Returned` are produced only by the backend from the order.
4. No pixel, no event and no `/api/t/id/` call on private paths: `/order/*`,
   `/review/*`, `/account/*` and their `/men/...` forms. Recorded paths keep only
   the query params `case`, `device`, `variant`. `review` and `r` are scrubbed
   from the address bar before any vendor script loads.
5. The root layout stays static. The stub is a client component that renders
   `null`, touches no `window` at module top level, and uses no `cookies()`,
   `headers()`, `searchParams`, `useSearchParams`, `next/dynamic` or `<Script>`.
6. Staff-created orders (draft/admin) never pass `/store/checkout`, so they
   have no context and send nothing. A browser marked with `_fl_staff` loads no
   pixels, sends nothing to ad platforms and is flagged internal on the
   dashboard.
7. Imported florayn.com orders (`order_op.source` set) never produce events.
8. Trust: nothing reaches an ad platform unless the request passed the edge
   check and the host is allowlisted. Without `TRACKING_EDGE_SECRET` configured
   (or without the Cloudflare rule that sends it) tracking is inert: no
   tracking cookies, no events, no ad sends, no pixels. Checkout works exactly
   as today.
9. Vendor calls (`fbq`, `ttq`, `gtag`) happen only after that vendor's script
   fired `onload`, and only while `location.pathname` is public and equals the
   queued item's pathname.
10. While `share_contact_hashes` is OFF, no contact PII (plain or hashed) goes
    to any vendor or to the browser. The Meta browser pixel does not load until
    `meta.aam_off_confirmed` is ticked for that environment (test or live).

---

## 2. Data model (backend module `tracking`)

Module `apps/backend/src/modules/tracking`, `TRACKING_MODULE = "tracking"`,
registered in `medusa-config.ts` modules[] right after order-ops.
- Only `tracking_settings` is a DML model (`model.define`). Every other table is
  created by the hand-written migration and accessed with the `PG_CONNECTION`
  knex from `lib/tracking/*`. This is a documented exception to AGENTS.md "no
  raw SQL" (it needs `ON CONFLICT`, `FOR UPDATE SKIP LOCKED`, counter upserts);
  precedent `lib/order-ops.ts` search SQL. Every file that does it says so in its
  header comment.
- Never run `medusa db:generate tracking`: the migration is hand-written.

Migration `apps/backend/src/modules/tracking/migrations/Migration20260928090000.ts`,
class `Migration20260928090000` (newer than and different from every existing
name; `tests/migration-names.test.cjs` enforces uniqueness). Additive and
idempotent (`create table if not exists`, `create index if not exists`), with a
top comment that explains why. `down()` drops these tables. It is applied
out-of-band BEFORE the backend deploy with the scoped script
`apps/backend/src/scripts/migrate-tracking.ts` (preflight with no args,
`apply Migration20260928090000` to apply), a copy of the
`migrate-contact-settings.ts` pattern restricted to `/florayn_v3` or
`/florayn_(checkout|contact|tracking)_test_*` databases.

### 2.1 tracking_settings (singleton, DML model)

| column | type | notes |
|---|---|---|
| id | text pk | fixed `trackset_default`; created on first save with the concurrent-create retry of `update-checkout-settings.ts` |
| config | jsonb not null default '{}' (as built: the DML `model.json()` type) | non-secret settings, parsed with defaults by `parseTrackingConfig()` (3.1) |
| meta_test_token | text null | write-only secret |
| meta_live_token | text null | write-only secret |
| tiktok_test_token | text null | write-only secret |
| tiktok_live_token | text null | write-only secret |
| catalog_feed_token | text null | 32 url-safe chars, generated; shown in admin (the owner copies the feed URL) |
| created_at, updated_at, deleted_at | DML defaults | plus the deleted_at index the DML model expects |

### 2.2 tracking_event (outbox)

```sql
create table if not exists tracking_event (
  id bigserial primary key,
  platform text not null,             -- 'meta' | 'tiktok'
  env text not null,                  -- 'test' | 'live'
  destination text not null,          -- dataset id / pixel code fixed at enqueue ('' when none)
  event_name text not null,
  event_id text not null,
  event_time timestamptz not null,    -- the event's own time (Meta 7-day rule)
  source text not null,               -- 'browser' | 'checkout' | 'reconcile' | 'status' | 'test'
  order_id text null,                 -- internal join only, never sent
  payload jsonb null,                 -- vendor-ready event JSON; NULL once sent or expired
  status text not null default 'pending', -- pending|sending|sent|retry|blocked|failed|expired|dry_run|skipped
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz null,
  last_error text null,               -- <= 500 chars, never a token, body or PII
  sent_at timestamptz null,
  created_at timestamptz not null default now()
) with (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
create unique index if not exists tracking_event_key on tracking_event (platform, event_name, event_id);
create index if not exists tracking_event_due on tracking_event (next_attempt_at) where status in ('pending','retry');
create index if not exists tracking_event_sending on tracking_event (locked_until) where status = 'sending';
create index if not exists tracking_event_created on tracking_event (created_at);
create index if not exists tracking_event_order on tracking_event (order_id) where order_id is not null;
```
Volume: about 100k Meta + 30k TikTok rows a day at target. Payload about 1 KB
until sent. `skipped` rows keep their payload (so an explicit Retry can send
them) until retention.

### 2.3 tracking_cart_context / tracking_order_context

```sql
create table if not exists tracking_cart_context (
  cart_id text primary key, context jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists tracking_cart_context_updated on tracking_cart_context (updated_at);

create table if not exists tracking_order_context (
  order_id text primary key, display_id int not null, cart_id text null,
  host text not null, env text null,            -- env null when the host is not allowlisted
  context jsonb not null,
  trusted boolean not null default false,       -- edge check passed at checkout
  staff boolean not null default false, optout boolean not null default false,
  purchase_time timestamptz not null, created_at timestamptz not null default now());
create index if not exists tracking_order_context_created on tracking_order_context (created_at);
```
`context` holds the checkout context keys of section 4.4 (`vid, sid, src, camp,
ip, ua, fbp, fbc, ttp, ttclid, gclid, gbraid, wbraid, country, device, audience,
page_url, consent_version, new`). No names, phones or emails. Hashes are
computed from the order at send time. There is no `emitted` column: once-only
sending is the outbox unique key (B2). As built (19.10): `consent_version` is
null when the shopper was shown no consent line (4.4), and an order's contact
details are hashed only when it is set (6.2).

### 2.4 Dashboard tables

```sql
create table if not exists tracking_hit (
  event_name text not null, event_id text not null,
  origin char(1) not null,                 -- 'b' browser-reported, 's' server-produced
  received_at timestamptz not null default clock_timestamp(),
  visitor_id text null, session_id text null, source text null, campaign varchar(80) null,
  device_class text null, audience text null, host text not null, path varchar(300) null,
  handle text null, variant_id text null, device text null, case_type text null,
  value numeric null, items int null, country char(2) null,
  flags int not null default 0,            -- 1 primary VC, 2 variant-switch VC, 8 internal/staff,
                                           -- 16 new visitor, 32 first PV of document, 64 unknown variant
  primary key (event_name, event_id))
  with (autovacuum_vacuum_scale_factor = 0.02);
create index if not exists tracking_hit_received on tracking_hit (received_at);

create table if not exists tracking_session (
  session_id text primary key, visitor_id text not null, day date not null,
  started_at timestamptz not null, last_at timestamptz not null, source text null, campaign varchar(80) null,
  landing_path varchar(300) null, device_class text null, audience text null, host text not null,
  is_new_visitor boolean not null default false, pageviews int not null default 0,
  flags int not null default 0,            -- 1 VC, 2 ATC, 4 IC, 8 Purchase, 16 internal
  purchase_value numeric not null default 0);
create index if not exists tracking_session_day on tracking_session (day);

create table if not exists tracking_minute (
  bucket timestamptz not null, event_name text not null, source text not null default '', host text not null,
  count int not null, value numeric not null default 0,
  primary key (bucket, event_name, source, host));

create table if not exists tracking_day_dim (
  day date not null, dim text not null, key text not null, event_name text not null, host text not null,
  count int not null, value numeric not null default 0,
  primary key (day, dim, key, event_name, host));

create table if not exists tracking_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());

create table if not exists tracking_counter (
  hour timestamptz not null, key text not null, n bigint not null default 0,
  primary key (hour, key));
```

As built (19.10): an InitiateCheckout hit's `event_id` is `<ic id>:<session
id>` (`ingest.hitEventId`), or the plain id without a session (opt-out). The
outbox rows and the Meta/TikTok payloads keep the plain per-cart `ic-` id, so
the platforms still dedup a reopened checkout, while a later session that
reopens it records its own IC hit (session flag 4). A reload in the same
session still records one.

`tracking_state` keys:
- `job:outbox`, `job:rollup`, `job:reconcile`, `job:catalog` hold
  `{ last_run_at, last_ok_at, last_error }` (written by `runTrackingJob`, 6.4).
- `rollup:watermark` holds `{ done_through }` (an ISO string).
- `alert:<kind>` holds `{ last_sent_at, open }`. As built: `{ open, title,
  since, last_sent_at, last_try_at }`, keyed per platform where the kind is
  (`alert:token:<platform>:<env>`, `alert:payload:<platform>`,
  `alert:send_failures:<platform>`); the other state keys added by the build
  are listed in 19.5.
- `token_fp:<platform>:<env>` holds the first 8 hex of sha256(token).
- `catalog:stale` holds `{ at }`; `catalog:alert` holds
  `{ kind: "feed_guard" | "feed_error", at, detail }` (written by WP08, read by
  WP03 alerts; WP08 never emails).
- `variant_index` holds `{ built_at, count, sellable }`.

`tracking_counter` keys (hourly buckets, `n = n + excluded.n`): `sf.untrusted`,
`sf.unknown_host`, `sf.rate_dropped`, `sf.cap_dropped`, `sf.invalid`,
`sf.forward_failed`, `sf.bot`, `ingest.unknown_variant`,
`ingest.no_token_dropped`, `ingest.no_destination`, `checkout.header_rejected`,
`checkout.untrusted`. As built also `ingest.invalid`, `ingest.unknown_host` and
`outbox.<status>.<platform>.<env>` (19.5).

Retention: hits 7 d; minutes 35 d; sessions 90 d; counters 35 d; day_dim kept
(about 2k rows/day). Backups: `pg_dump --exclude-table-data=tracking_hit
--exclude-table-data=tracking_event`.

### 2.5 Catalog tables

```sql
create table if not exists catalog_feed (
  platform text not null, kind text not null,          -- kind 'published' | 'candidate'
  body_gzip bytea not null, etag text not null, content_hash text not null, item_count int not null,
  built_at timestamptz not null, published_at timestamptz null,
  status text not null, warnings jsonb not null default '[]',   -- status 'published' | 'held' | 'unchanged'
  primary key (platform, kind));
create table if not exists catalog_feed_fetch (
  id bigserial primary key, platform text not null, fetched_at timestamptz not null default now(),
  user_agent varchar(200) null, status int not null, bytes int not null);
create index if not exists catalog_feed_fetch_at on catalog_feed_fetch (fetched_at);
create table if not exists catalog_image (
  source_url text primary key, jpg_url text null, bytes int null, error text null,
  created_at timestamptz not null default now());
create table if not exists tracking_variant (
  variant_id text primary key, product_id text not null, handle text not null, sku text null,
  case_type text null, device text null, price numeric null,     -- BDT major units, what checkout charges
  in_stock boolean not null default false, sellable boolean not null default false,
  updated_at timestamptz not null default now());
```
`tracking_variant` is the variant index (section 8.1): the backend's own list of
real variant ids and prices, used to replace client prices at ingest (B5) and
to count unknown content ids.

---

## 3. Settings and admin screens

Every tunable lives in the DB with an admin page (AGENTS.md). Secrets follow
the courier/WhatsApp pattern: plaintext columns; GET returns only `*_masked`
(`••••••••` + last 4) and `*_set`; a blank POST keeps the saved value; the literal
`"__remove__"` clears it; inputs use `name`/`autoComplete="one-time-code"`,
`data-1p-ignore`, `WebkitTextSecurity: "disc"` and the placeholder "Paste a new
token to replace it". No library logs a token.

### 3.1 `config` JSON (defaults, `DEFAULT_CONFIG` in `lib/tracking/settings.ts`)

```json
{
  "v": 1,
  "test_hosts": ["new.florayn.com"],
  "live_hosts": ["florayn.com", "www.florayn.com"],
  "live_armed": false,
  "meta": {
    "enabled": false, "test_id": "2247389409441720", "live_id": "650439547920083",
    "test_event_code": "", "api_version": "v26.0", "browser": "all",
    "aam_off_confirmed": { "test": false, "live": false },
    "status_events": { "OrderConfirmed": true, "Delivered": true, "Returned": true }
  },
  "tiktok": {
    "enabled": false, "test_id": "", "live_id": "D9ODDBJC77U97D5Q7MQG", "browser": "ads_only",
    "spa_off_confirmed": false
  },
  "google": {
    "enabled": false, "conversion_id": "AW-18147096523", "purchase_label": "0p0wCKu2w70cEMvvms1D",
    "browser": "ads_only"
  },
  "privacy": { "share_contact_hashes": false, "consent_text": "", "consent_version": 1 },
  "alerts": {
    "enabled": true, "email": "floraynweb@gmail.com", "active_from_hour": 10, "active_to_hour": 24,
    "no_purchase_hours": 3, "repeat_hours": 6
  },
  "dashboard": { "daily_order_target": 300, "poll_seconds": 15 },
  "catalog": {
    "enabled": false, "base_url": "https://new.florayn.com", "image_base_url": "https://img.florayn.com",
    "image_mode": "jpeg_copies", "shrink_guard_pct": 20,
    "include_case_types": [], "exclude_case_types": ["alcantara"]
  }
}
```

### 3.2 Validation (`parseTrackingPatch(body, context)`, pure)

- dataset id `^\d{10,20}$` (empty allowed = off); TikTok pixel `^[A-Z0-9]{16,24}$`
  (empty allowed); conversion id `^AW-\d{6,15}$`; label `^[A-Za-z0-9_-]{10,40}$`;
  `api_version` `^v\d{2}\.\d$`; `test_event_code` `^TEST[A-Z0-9]{3,12}$` or empty.
- `browser` is `off | ads_only | all`.
- hosts: lowercase hostnames `^[a-z0-9.-]{1,100}$`, no port, at most 5 each; a
  host may not be in both lists.
- email syntax; hours 0-24 with `from < to`; `no_purchase_hours` 1-12;
  `repeat_hours` 1-48; `poll_seconds` 10-60; `daily_order_target` 1-100000;
  `shrink_guard_pct` 5-50; `consent_text` at most 600 chars; case type lists are
  slugs `^[a-z0-9-]{1,40}$`; `image_mode` is `jpeg_copies | cf_transform`;
  `base_url`/`image_base_url` are `https://` URLs without a trailing slash.
- `enabled`, `live_armed`, `aam_off_confirmed.test|live`, `spa_off_confirmed`,
  the status event toggles, `alerts.enabled` and `catalog.enabled` are booleans.
- Changing `consent_text` increments `privacy.consent_version`. Changing
  `consent_text` while share is ON is allowed only with a non-empty text.
- `privacy.share_contact_hashes = true` is REJECTED unless `consent_text` is
  non-empty AND the Privacy page is published. The route reads
  `select published from privacy_setting where id = 'privacyset_default' and
  deleted_at is null` with knex; a missing table or row counts as unpublished.
  (C7, I20.) As built: the gate applies when share goes from OFF to ON; a save
  that leaves share ON is not refused if the page was unpublished later, so
  an emergency edit (disarming, a token) still saves (19.3, WP01).
- Tokens: strings up to 512 chars, no whitespace; blank keeps; `"__remove__"`
  clears.

### 3.3 Secret writes (I16)

`POST /admin/tracking/settings` writes the four token columns and
`catalog_feed_token` straight through the module service
(`updateTrackingSettings`), as `api/admin/courier/settings/route.ts` does.
As built: the POST never accepts `catalog_feed_token`; only
`ensureFeedToken()` and `rotateFeedToken()` write it, and the tokens go through
the `saveTrackingTokens()` helper, which calls the service directly (medusa
lint flags a service mutation inside a route). Only
the non-secret `config` goes through `updateTrackingSettingsWorkflow`, which
queues `content:tracking` revalidation like `update-checkout-settings.ts` and
calls `invalidateTrackingSettings()`. Reason: workflow-engine-redis can
checkpoint workflow input to Redis and `workflow_execution`.

### 3.4 Host roles and the destination rule

Implemented identically in the backend (`hostRole`, `destinationFor` in
`lib/tracking/settings.ts`) and the storefront (`hostRole`, `pixelsFor` in
`lib/tracking/server/config.ts`), tested against the same vectors (Appendix C).

- `normHost(h)`: lowercase, strip `:port`.
- `hostRole(config, host)`: `"test"` if host in `test_hosts`; `"live"` if host in
  `live_hosts` and `live_armed`; `"test"` if host in `live_hosts` and not armed;
  otherwise `null` (unknown host: tracking off, no cookies).
- `destinationFor(config, host, platform)`:
  - Meta/TikTok: `role = hostRole(...)`; null role or `!enabled` gives null;
    `id = role === "live" ? live_id : test_id`; empty id gives null; else
    `{ env: role, id }`.
  - Google: only `enabled && role === "live"` gives
    `{ env: "live", id: conversion_id, label: purchase_label }`; else null.
    As built: also null when `conversion_id` or `purchase_label` is empty.
- The storefront's browser load decision additionally requires (section 4.2):
  not staff, not optout, `browser !== "off"`, Meta `aam_off_confirmed[env]`, TikTok
  `spa_off_confirmed`, and for `ads_only` the platform's click cookie.

### 3.5 Admin screens

| Route (file) | Owner | Contents |
|---|---|---|
| Tracking `src/admin/routes/tracking/page.tsx` (sidebar, `defineRouteConfig({ label: "Tracking", icon })`) | WP01 | Host banner ("new.florayn.com -> TEST", "florayn.com -> LIVE, armed/disarmed"); "Allow live sending" (`live_armed`) with a confirm dialog; test/live host lists. Meta: enable, test dataset id, test token, test event code, live dataset id, live token, API version, browser loading, two AAM checkboxes ("Automatic Advanced Matching is OFF on the TEST dataset" / "... on the live dataset") with the warning "Turn it OFF in Events Manager before ticking; the browser pixel stays off for that dataset until you do", COD events. TikTok: enable, ids, tokens, browser loading, "SPA page views and automatic events are OFF in both pixels" checkbox (as built, 19.10: "SPA page views, automatic events and automatic advanced matching are OFF in both pixels"; same `spa_off_confirmed` key, wider meaning). Google: enable, conversion id, purchase label, loading (note: "only on live hosts"). Privacy: consent text with a "Use suggested wording" button (Appendix B text), "Share hashed contact details" switch (disabled with a link to Admin > Privacy until the page is published and text is set). Alerts: email, active hours, no-purchase window, repeat hours, "Send test alert" (POST `/admin/tracking/test-alert`, friendly message on 404). Dashboard: target, poll seconds. Links to Health, Catalog, Live. `email_configured` warning. |
| Tracking > Health `src/admin/routes/tracking/health/page.tsx` (no config export) | WP03 | Per platform/env: pending, retry, blocked, failed, expired, skipped, sent (24 h); last success; last error (class + fbtrace_id/request_id); job states; counters (24 h sums of `tracking_counter`); variant index state; "Retry blocked/failed" and "Send skipped from the last 6 days" buttons; "Send test event"; "Send test alert". Polls every 30 s while visible. |
| Tracking > Catalog `src/admin/routes/tracking/catalog/page.tsx` (no config export) | WP08 | Enable, base URL, image base URL, image mode, guard %, include/exclude case types (saved through `POST /admin/tracking/settings`); feed URLs with copy buttons; last build (items, warnings, status); last Meta/TikTok fetch; held build with "Publish anyway"; "Rebuild now"; "Convert images" with progress and the sharp status; "Rotate token". |
| Live `src/admin/routes/live/page.tsx` (sidebar, `label: "Live"`) | WP07 | Section 9, plus "Exclude this browser" staff links. |
| Privacy `src/admin/routes/privacy/page.tsx` (sidebar, `label: "Privacy"`) | WP09 | Title, body (plain paragraphs), published switch, last updated, "Start from the suggested draft" (Appendix A) and the note "This is a legal document; Florayn must check and approve the wording." |

Admin pages use plain `fetch("/admin/...", { credentials: "include" })` like
`admin/routes/checkout/page.tsx`, Medusa UI components, and an icon that exists
in `@medusajs/icons` (check the package's exports). Sub-pages export no config.
`medusa build` runs `medusa lint`; lint errors fail the deploy.

### 3.6 Foundation library APIs (WP01; later waves import exactly these)

`apps/backend/src/lib/tracking/settings.ts`:
```ts
export const TRACKING_SETTINGS_ID = "trackset_default"
export type Platform = "meta" | "tiktok" | "google"
export type Env = "test" | "live"
export type TrackingConfig = { /* exactly the JSON of 3.1 */ }
export type TrackingSettingsView = { config: TrackingConfig;
  tokenSet: { meta: Record<Env, boolean>; tiktok: Record<Env, boolean> }; feedToken: string | null }
export const DEFAULT_CONFIG: TrackingConfig
export const SUGGESTED_CONSENT_TEXT: string                          // Appendix B
export function parseTrackingConfig(raw: unknown): TrackingConfig    // merges defaults, tolerates junk
export function parseTrackingPatch(body: unknown, ctx: { current: TrackingConfig; privacyPublished: boolean }):
  { ok: true; config: TrackingConfig; tokens: Partial<Record<TokenColumn, string | null>> } | { ok: false; errors: string[] }
export function present(row: unknown): PresentedTrackingSettings    // *_masked / *_set, never raw tokens
export function normHost(host: string): string
export function hostRole(config: TrackingConfig, host: string): Env | null
export function destinationFor(config: TrackingConfig, host: string, platform: Platform): { env: Env; id: string; label?: string } | null
export function publicConfig(config: TrackingConfig): PublicTrackingConfig
export async function loadTrackingSettings(container: any): Promise<TrackingSettingsView>   // 10 s in-process cache
export async function loadTrackingToken(container: any, platform: "meta" | "tiktok", env: Env): Promise<string | null> // outbox + test-event only
export function invalidateTrackingSettings(): void
export async function ensureFeedToken(container: any): Promise<string>
export function tokenFingerprint(token: string): string              // first 8 hex of sha256
```

`apps/backend/src/lib/tracking/db.ts` (knex from `ContainerRegistrationKeys.PG_CONNECTION`):
```ts
export type OutboxStatus = "pending" | "sending" | "sent" | "retry" | "blocked" | "failed" | "expired" | "dry_run" | "skipped"
export type OutboxInsert = { platform: "meta" | "tiktok"; env: Env; destination: string; event_name: string; event_id: string;
  event_time: Date; source: "browser" | "checkout" | "reconcile" | "status" | "test"; order_id?: string | null;
  payload: unknown | null; status?: "pending" | "blocked" | "skipped"; last_error?: string | null }
export type HitInsert = { event_name: string; event_id: string; origin: "b" | "s"; visitor_id?: string | null; session_id?: string | null;
  source?: string | null; campaign?: string | null; device_class?: string | null; audience?: string | null; host: string;
  path?: string | null; handle?: string | null; variant_id?: string | null; device?: string | null; case_type?: string | null;
  value?: number | null; items?: number | null; country?: string | null; flags?: number }
export type OrderContextRow = { order_id: string; display_id: number; cart_id: string | null; host: string; env: Env | null;
  context: CheckoutTrackingContext; trusted: boolean; staff: boolean; optout: boolean; purchase_time: Date }
export const HIT_FLAGS = { PRIMARY: 1, VARIANT_SWITCH: 2, INTERNAL: 8, NEW_VISITOR: 16, FIRST_PAGEVIEW: 32, UNKNOWN_VARIANT: 64 }
export function trackingDb(container: any): Knex
export async function withTransaction<T>(container: any, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T>
export async function insertOutbox(db: Knex | Knex.Transaction, rows: OutboxInsert[]): Promise<number>   // ON CONFLICT DO NOTHING
export async function insertHits(db: Knex | Knex.Transaction, rows: HitInsert[]): Promise<number>        // ON CONFLICT DO NOTHING
export async function getState<T>(db: Knex | Knex.Transaction, key: string): Promise<T | null>
export async function setState(db: Knex | Knex.Transaction, key: string, value: unknown): Promise<void>
export async function bumpCounters(db: Knex | Knex.Transaction, deltas: Record<string, number>, at?: Date): Promise<void>
```
`CheckoutTrackingContext` (the 4.4 JSON) and the event validators live in
`apps/backend/src/lib/tracking/contract.ts`; `secret.ts` exports `ingestSecret()`,
`hmacHex(secret, message)`, `derivedIngestKey(secret)`, `verifyIngestKey(header)`
(current or previous secret, timing-safe, fails closed), `staffLinkToken()`;
`jobs.ts` is section 6.4.

---

## 4. Contracts

### 4.1 Shared vocabulary and the vector fixture

Storefront modules (owned by WP14):
- `apps/storefront/src/lib/tracking/paths.ts` (client-safe, tiny, lands in the
  layout chunk): `PRIVATE_SEGMENTS = ["order", "review", "account"]`,
  `isPrivatePath(pathname)` (strip query/hash; strip one leading `/men` segment;
  private when the first segment is exactly one of those),
  `PATH_PARAMS = ["case", "device", "variant"]`,
  `LANDING_PARAMS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid",
  "utm_source", "utm_medium", "utm_campaign"]`, `safePath(pathname, search)`
  (keeps PATH_PARAMS in that order, values at most 80 chars, serialised with
  `URLSearchParams`; result at most 300 chars, else `pathname.slice(0, 300)`),
  `landingParams(search)` (LANDING_PARAMS only, values at most 1000 chars).
  As built (budget trim, 19.3): `paths.ts` holds only `PRIVATE_SEGMENTS`,
  `pathnameOf` and `isPrivatePath`, the part the layout needs.
  `PATH_PARAMS`, `CLICK_KEYS`, `LANDING_PARAMS`, `safePath` and `landingParams`
  live in `contract.ts`, which still re-exports `paths.ts`. Over-cap values
  are dropped, never cut.
- `apps/storefront/src/lib/tracking/contract.ts`: all shared types (below), the
  constants `BROWSER_EVENTS`, `EVENT_LIMITS`, and the pure validators
  `validateEvent(raw)` (shape only; time windows are checked by the endpoints), `isBrowserEventId(name, id)`,
  `isVariantId(id)`, `isPurchaseBlock(value)`. It re-exports `paths.ts`.
  Client code that lands in the layout (queue, stub) imports only TYPES from
  `contract.ts`; the validators are for server routes, the lazy runtime and
  checkout.
- `apps/storefront/tests/fixtures/tracking-vectors.json` = Appendix C verbatim.

Backend modules:
- `apps/backend/src/lib/tracking/contract.ts` (WP01): the same validators
  (`isPrivatePath`, `safePath`, `validateEvent`, `isBrowserEventId`,
  `isVariantId`, `BROWSER_EVENTS`) for ingest, tested against
  `apps/backend/tests/fixtures/tracking-vectors.json` (the same Appendix C
  JSON). WP13 adds a test that the two fixture copies are byte-identical.

Ids and limits:
- Browser event ids: uuid v4 lowercase
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` for
  PageView, ViewContent, AddToCart; `^ic-[0-9a-f]{24}$` for InitiateCheckout
  (and only for it).
- Server ids: Purchase `fl-<display_id>`; `oc-fl-<n>`, `dl-fl-<n>`, `rt-fl-<n>`.
- Variant id `^variant_[A-Za-z0-9]{10,40}$`.
- Per event: `items` 1-50 for VC/ATC/IC (PageView has none), each
  `{ id: variant id, q: 1-99, price: 0-1e6 }`; `value` 0-1e6; `currency` must be
  `"BDT"`; strings in `d` at most 120 chars; unknown `d` keys are dropped, not
  fatal. `p` must start with `/`, be at most 300 chars, not be private, and equal
  `safePath` of itself.

Types (in `contract.ts`; the backend copies the ones it needs):

```ts
export type BrowserEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout"
export type EventItem = { id: string; q: number; price: number }
export type BrowserEvent = { n: BrowserEventName; id: string; t: number; p: string; d?: Record<string, unknown> }
export type EventBatch = { v: 1; rv?: string; sent_at: number; events: BrowserEvent[] }

export type LandingSnapshot = { q: Record<string, string>; ref: string | null; path: string }
export type IdRequest = { v: 1; landing: LandingSnapshot | null }
export type ClickKey = "fbclid" | "ttclid" | "gclid" | "gbraid" | "wbraid"
export type IdResponse = {
  v: 1
  on: boolean                       // false: tracking inert for this browser (no edge, unknown host, optout)
  env: "test" | "live" | null
  ext: string | null                // sha256 hex of _fl_vid (external_id)
  sid: string | null
  src: string | null                // session source class (section 6.7)
  staff: boolean
  optout: boolean
  share: boolean                    // privacy.share_contact_hashes
  consent_version: number
  landing: { url: string | null; click: ClickKey | null; src: string | null } | null
  meta: { id: string; load: boolean } | null
  tiktok: { id: string; load: boolean } | null
  google: { id: string; label: string; load: boolean } | null
}

export type PurchaseBlock = {
  event_id: string                  // fl-<display_id>
  value: number                     // order total incl. delivery, BDT major units
  currency: "BDT"
  num_items: number
  contents: { id: string; quantity: number; item_price: number }[]
  platforms: { meta: boolean; tiktok: boolean; google: boolean }
  match: {
    meta?: Record<string, string>   // share OFF: { external_id } only
    tiktok?: Record<string, string> // share OFF: { external_id } only
    google?: { sha256_phone_number?: string; sha256_email_address?: string;
               address?: { sha256_first_name?: string; sha256_last_name?: string; country: "BD" } }
  }
}
```

### 4.2 Storefront same-site endpoints (WP11)

`trailingSlash: true` 308-redirects slashless paths: ALWAYS call with the slash
(`/api/t/id/`, `/api/t/e/`), including `sendBeacon`. Every handler exports
`dynamic = "force-dynamic"`, answers `Cache-Control: private, no-store`, and
never runs on document requests. There is no `middleware.ts`, and
`next.config.ts` only adds the private pages' `Referrer-Policy` header (19.10).

Request reading (`lib/tracking/server/request-context.ts`, `readRequest(req)`):
- `host` = `normHost(Host header)`. Never `X-Forwarded-Host`; never
  `NEXT_PUBLIC_SITE_URL` (unset).
- `edgeOk` = `x-florayn-edge` equals `TRACKING_EDGE_SECRET` (at least 32 chars),
  timing-safe with a length check. Dev escape: true when
  `process.env.NODE_ENV !== "production"` and `TRACKING_DEV_TRUST_EDGE === "1"`
  (never in `next start`).
- `trustedIp` = `edgeOk ? cf-connecting-ip (valid IPv4/IPv6 syntax) : null`.
  Never read `X-Forwarded-For` or `X-Real-Ip`.
- `country` = `edgeOk ? cf-ipcountry` when `^[A-Z]{2}$` and not `XX`/`T1`, else
  null.
- `originOk` for POST: `Origin === "https://" + host`, or
  `sec-fetch-site === "same-origin"`; with the dev escape also `http://`.
- `ua` (at most 400 chars), `isBot(ua)` with
  `/bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|Bytespider|HeadlessChrome|Lighthouse|PageSpeed|GTmetrix|florayn-warm|curl|wget|python-requests|node-fetch|axios|Go-http-client/i`.
- `deviceClass` from UA: `/iPad|Tablet/i` tablet, `/Mobi|Android|iPhone/i`
  mobile, else desktop. `audience` from `fl_audience` cookie or the event path
  (`audienceFromPath`).

**POST `/api/t/id/`** (body at most 2 KB; `application/json` or `text/plain`):
1. `!originOk` gives 403, no cookies. Bot UA gives 204, no cookies.
2. `config = await getTrackingConfig()`; `role = hostRole(config, host)`.
3. If `!edgeOk` (counter `sf.untrusted`), `role === null` (counter
   `sf.unknown_host`), or the secret is unset: 200 with
   `{ v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false,
   optout: false, share: false, consent_version, landing: null, meta: null,
   tiktok: null, google: null }` and NO cookies.
4. `_fl_optout` present: 200 `{ on: false, optout: true, ... }`, no cookies.
5. Otherwise: create or keep `_fl_vid`; rotate or slide the session; classify
   the source on a new session (6.7); set vendor cookies only for vendors that
   have a destination on this host; answer with the full `IdResponse`.

**POST `/api/t/e/`** (body at most 64 KB; `EventBatch`):
1. 403 on `!originOk`; silent 204 (no forward) on bot, `!edgeOk`, unknown host,
   optout, missing `_fl_vid`, or rate limit.
2. Rate limit (`rate-limit.ts`, in-memory token buckets, LRU capped at 50k keys):
   per visitor id 120 events/min with burst 60, and per trusted IP 1,200
   events/min. Over the limit: dropped, counter `sf.rate_dropped` (I14).
   As built (19.10): the IP bucket is per IP source, `ipSource()`: an IPv4
   address, an IPv6 address's /64 (one phone or home can use any address in
   it), an IPv4-mapped IPv6 address as its IPv4 address. The ingest `ctx.ip`
   keeps the full address.
3. At most 25 events; each validated with `validateEvent`; invalid ones dropped
   individually (counter `sf.invalid`).
4. Clock fix (I1): `age = sent_at - t`; drop if `age < -60_000` or
   `age > 600_000`; else `t = Date.now() - max(0, age)`.
5. Slide `_fl_sid` / `_fl_src` (a new session with source `direct` if the
   session cookie expired).
6. Respond 204 at once; `after(() => forwardEvents(host, ctx, events))`.

Cookies (all `Path=/; Secure; SameSite=Lax`; host-only, except on a host in
`live_hosts` where `Domain` = the host without a leading `www.`):

| cookie | value | life | HttpOnly | set when |
|---|---|---|---|---|
| `_fl_vid` | `v1.<unix>.<16 hex>` | 400 d | yes | trusted, known host, not optout |
| `_fl_sid` | `s1.<unix>.<8 hex>`; new after 30 min idle, or on a new click id or `utm_campaign` | 30 min sliding | yes | same |
| `_fl_src` | base64url(JSON `{ s: source, c: campaign <= 80, k: first 8 hex of sha256(click id) or "" }`) | 30 min sliding | yes | same |
| `_fbp`, `_fbc` | from `ParamBuilder` (below); `_fbc` only when fbclid is new or differs | 90 d | no | Meta has a destination here |
| `ttclid` | ttclid verbatim, never truncated (up to 1000 chars) | 90 d | no | TikTok has a destination and the landing has ttclid |
| `_fl_gclid` | base64url(JSON `{ k: "gclid"\|"gbraid"\|"wbraid", v, t: unix }`) | 90 d | yes | Google has a destination (live only) and the landing has one |
| `_gcl_aw` | `GCL.<unix>.<gclid>` | 90 d | no | same, gclid only (QA at cutover confirms gtag reads it; remove if not) |
| `_fl_staff` | `HMAC(secret, "staff-cookie-v1")` hex | 400 d | yes | staff link |
| `_fl_optout` | `1` | 400 d | no | opt-out link |

ParamBuilder use (`server/cookies.ts` only): `new ParamBuilder([cookieDomain])`
where `cookieDomain` is the Domain value above or the exact host;
`processRequestFromContext(new PlainDataObject(host, queryObj, cookieObj,
referer, trustedIp, null, "https", path))` with `queryObj` from the landing
snapshot. From the returned `CookieSettings[]` take ONLY `_fbp` and `_fbc` and
set them with our own attributes (ignore `_fbi` and anything else). `getFbp()` /
`getFbc()` values go to the backend context for Meta CAPI only.

Browser load decisions in the `IdResponse` (all false when staff or optout):
- `meta.load` = Meta destination && `browser !== "off"` && `aam_off_confirmed[env]`
  && (`browser === "all"` || `_fbc` present or set now).
- `tiktok.load` = TikTok destination && `browser !== "off"` &&
  `spa_off_confirmed` && (`all` || `ttclid` present or set now).
- `google.load` = Google destination (live only) && `browser !== "off"` &&
  (`all` || `_fl_gclid` present or set now).
- `landing` = `{ url: "https://" + host + path + "?" + LANDING_PARAMS only (or
  null for a private or missing landing), click: the first click key present,
  src }`.

`getTrackingConfig()` (`server/config.ts`): `fetch(${MEDUSA_BACKEND_URL}/store/tracking-config,
{ headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY }, next: { revalidate: 300,
tags: ["content", "content:tracking"] } })` (the `lib/checkout.ts` pattern); on
any error it returns the all-off defaults. `content:tracking` is accepted by
`lib/revalidation.ts`.

**GET `/api/t/staff/?t=<hex>&on=1|0`**: host must be known; `t` must equal
`HMAC(secret, "staff-link-v1")` (timing-safe) else 404. Sets or clears
`_fl_staff`. **GET `/api/t/optout/?on=1|0`**: sets or clears `_fl_optout`;
turning it on also expires `_fl_vid`, `_fl_sid`, `_fl_src`, `_fbp`, `_fbc`,
`ttclid`, `_fl_gclid`, `_gcl_aw` (host-only and Domain variants). Both return a
tiny no-store HTML page with a link home.

As built (19.3, WP11): a missing or empty User-Agent counts as a bot.
`/api/t/e/` checks the edge header before reading the settings (a flood
straight to the origin costs nothing); both endpoints answer 415 for other
content types and 400 for malformed JSON. Events past the first 25 and
events dropped by the clock fix count as `sf.invalid`. Staff browsers get no
vendor cookies (`on: true`, every `load` false). `_fl_vid` is never refreshed
(400 days from the first visit). `_fbp` is set only when the browser has no
usable one. Opt-out also expires `_fbp`/`_fbc` under the parent domain, which
at cutover clears the WordPress pixel's cookies in that browser. The staff
and opt-out pages send `Referrer-Policy: no-referrer` and `noindex`.
`next.config.ts` `headers()` sends `Referrer-Policy: no-referrer` for
`/order/:path*`, `/review/:path*` and `/account/:path*` (the bare, slash and
nested forms, no other route; `app/men` has no private route, and
`tests/private-referrer.test.cjs` fails if one appears without the header).
`/review/[token]` also sets metadata `referrer: "no-referrer"`, like
`/order/[id]`, for a soft navigation into it (19.10).

### 4.3 Storefront to backend ingest (WP11 sends, WP04 receives)

`POST ${NEXT_PUBLIC_MEDUSA_BACKEND_URL}/tracking/ingest` with header
`x-florayn-ingest-key: <derived ingest key>` (4.7). File
`apps/backend/src/api/tracking/ingest/route.ts` (public non-/store route like
`webhooks/steadfast`; no Medusa auth, no CORS).

```json
{ "v": 1,
  "stats": { "sf.untrusted": 3, "sf.rate_dropped": 0 },
  "batches": [
    { "host": "new.florayn.com",
      "ctx": { "ip": "103.4.145.2", "ua": "Mozilla/5.0 ...", "vid": "v1....", "sid": "s1....",
               "src": "meta_paid", "camp": "sept-sale", "fbp": "fb.1....", "fbc": "fb.1....",
               "ttp": null, "ttclid": null, "gclid": null, "gbraid": null, "wbraid": null,
               "country": "BD", "device": "mobile", "audience": "women",
               "new": true, "staff": false },
      "events": [ { "n": "ViewContent", "id": "<uuid>", "t": 1790467200456, "p": "/product/x/?case=signature",
                    "d": { "items": [{ "id": "variant_01...", "q": 1, "price": 1400 }], "value": 1400,
                           "currency": "BDT", "handle": "zebra-stark", "device": "iPhone 17 Pro Max",
                           "case_type": "Signature", "primary": true } } ] } ] }
```
- Forwarder (`server/forward.ts`): coalesces in-process for 250 ms or 100
  events, groups by `(host, ctx)`, splits so each request has at most 200 events
  and 256 KB; fetch keep-alive, 3 s timeout, one retry; never throws. Global cap
  3,000 events per 10 s window; excess dropped (counter `sf.cap_dropped`).
  As built (19.10): the cap is shared fairly per IP source. When the window
  that just ended was offered more than 2,700 events (cap less
  `FAIR_SHARE.reserveEvents` 300), each source may forward at most its max-min
  (water-filling) share of 2,700 in the next window, never under 25
  (`minEvents`, one batch). No share after a gap of 20 s or more; the first
  window of a flood is still first come. Sources past 10,000 in a window
  (`maxSources`) share one allowance. Share and cap drops both count as
  `sf.cap_dropped`.
  Accumulated counters ride in `stats`; when counters are non-zero and nothing
  was forwarded for 60 s, it sends a stats-only envelope (`batches: []`).
  Optout traffic is never forwarded; staff traffic is forwarded with
  `staff: true`.
- Backend: 401 on a bad key (timing-safe; an unset secret fails closed); 413
  above 512 KB (middleware entry, B6); 400 on envelope errors; otherwise 202
  `{ accepted: n }`. Batches whose host is not allowlisted are dropped. Events
  are re-validated with the backend `contract.ts`; `t` must be within
  `[now - 15 min, now + 1 min]`.
- In ONE transaction with `SET LOCAL statement_timeout = '5s'`: insert hits
  (`ON CONFLICT DO NOTHING`), insert outbox rows (6.1), bump counters; commit;
  then `scheduleFlush()` and `kickStaleJobs()`.

### 4.4 `/store/checkout` tracking header and response block (WP12 sends, WP05 receives)

Headers on `placeOrder` only when a context exists:
- `x-florayn-ingest-key: <derived ingest key>`
- `x-florayn-tracking: base64url(JSON)`, at most 4 KB, JSON:
  `{ v: 1, host, page_url: "https://<host>/checkout/", edge, ip, ua, vid, sid,
  src, camp, fbp, fbc, ttp, ttclid, gclid, gbraid, wbraid, country, device,
  audience, new, staff, optout, consent_version }`.

Length caps (both sides): host 100, page_url 200, ip 45, ua 400, vid 40, sid 40,
src 40, camp 80, fbp 120, fbc 600, ttp 100, ttclid 1000, gclid/gbraid/wbraid
300, country 2, device `mobile|tablet|desktop`, audience `women|men|null`.
Unknown keys are dropped.

Storefront (`lib/tracking/server/checkout-context.ts`, WP11):
`checkoutTrackingHeaders()` reads ONLY `headers()` and `cookies()` from
`next/headers` (never Server Action arguments) and returns the two headers, or
null only when `TRACKING_INGEST_SECRET` is unset. Staff, optout and edge-less
requests still send a context with their flags (the backend decides).
As built (19.10): `consent_version` is the version of the consent line shown
under Place order (`checkoutConsent(config)?.version`), or null when no line
rendered (share OFF, or ON with a blank sentence).

Backend (`lib/tracking/checkout-context.ts`, WP05): `decodeTrackingHeader(headers)`
returns `{ ctx: CheckoutTrackingContext | null, rejected: boolean }`; it never
reads `req.body` or cart metadata and never throws. `rejected` (header present,
key wrong) bumps `checkout.header_rejected`. As built (19.10): only once the
order was placed (status 200 with an order id), so a bare POST with a forged
header cannot raise the alert; `checkout.untrusted` is still counted on every
request with a verified context.

Response: the existing body, plus `tracking: PurchaseBlock` (4.1) only when the
order was placed (status 200 with `order.id`) and a context was stored for it.
`platforms.<p>` is true only when the context is trusted, not staff, not optout
and the platform has a destination on the context host. `match` follows the
share rule (4.1); with share ON:
- `meta`: `{ ph, fn, ln, ct, country, external_id, em? }` (flat hex strings for
  `fbq('init')`)
- `tiktok`: `{ phone_number, email?, external_id }`
- `google`: `{ sha256_phone_number, sha256_email_address?, address:
  { sha256_first_name, sha256_last_name?, country: "BD" } }`

### 4.5 `GET /store/tracking-config` (WP01)

Returns `{ config: publicConfig(config) }` with `Cache-Control: public,
max-age=60`: `test_hosts`, `live_hosts`, `live_armed`; `meta { enabled,
test_id, live_id, browser, aam_off_confirmed: { test, live } }`; `tiktok { enabled, test_id,
live_id, browser, spa_off_confirmed }`; `google { enabled, conversion_id,
purchase_label, browser }`; `privacy { share, consent_version, consent_text
(only while share is ON, else "") }`. Never tokens, alert email, catalog settings
or the feed token. A test greps the JSON for `token` and `email`. As built: a
database error answers 503 with `Cache-Control: no-store`, so nothing wrong is
cached and the storefront falls back to all-off.

### 4.6 Backend admin routes (all `/admin/*` are authenticated by Medusa)

| Route | Owner | Contract |
|---|---|---|
| GET/POST `/admin/tracking/settings` | WP01 | GET `{ settings: present(row), email_configured, privacy_published, suggested_consent_text }`. POST: partial config patch + token strings (3.2, 3.3); returns the same shape. `Cache-Control: private, no-store`. Never logs bodies. |
| GET `/admin/tracking/health` | WP03 | `outboxHealth()` + jobs + counters (24 h) + variant index + `email_configured` |
| POST `/admin/tracking/retry` | WP03 | `{ platform?, env?, statuses: ("blocked"\|"failed"\|"skipped")[] }`: rows with `event_time` within 6 days go to `retry`, `next_attempt_at = now()` |
| POST `/admin/tracking/test-alert` | WP03 | Sends a test email to `alerts.email`; `{ ok, error? }` |
| POST `/admin/tracking/test-event` | WP03 | `{ platform }`: Meta sends one PageView, TikTok one ViewContent (I21), to the TEST destination only (Meta with `test_event_code`), synchronously; returns the result class. 409 when there is no TEST destination or token. |
| GET `/admin/tracking/live?host=` | WP07 | Section 9 payload; one result shared for 10 s |
| GET `/admin/tracking/report?range=7d\|30d` | WP07 | Daily series and dimension tables; cached 5 min |
| GET `/admin/tracking/staff-link` | WP07 | `{ links: [{ host, url: "https://<host>/api/t/staff/?t=<hmac>&on=1" }] }` for every test and live host |
| GET/POST `/admin/tracking/catalog` | WP08 | GET status; POST `{ action: "rebuild"\|"publish_anyway"\|"rotate_token"\|"convert_images" }` (settings are saved through `/admin/tracking/settings`) |
| GET/POST `/admin/privacy-settings`, GET `/store/privacy-settings` | WP09 | Like contact-settings; the store route returns `{ settings: { title, body, published, updated_at } }` with `body: ""` while unpublished |
| GET `/feeds/:token/:file` | WP08 | Section 8.4 |

### 4.7 Keys and secrets (C8, I18)

| Env | App | Purpose |
|---|---|---|
| `TRACKING_INGEST_SECRET` | both, same value, at least 32 chars, server-only (never `NEXT_PUBLIC`) | root of the derived keys below |
| `TRACKING_INGEST_SECRET_PREVIOUS` | backend only, optional | accepted for ingest/checkout verification during rotation |
| `TRACKING_EDGE_SECRET` | storefront only, at least 32 chars | compared with the `x-florayn-edge` header Cloudflare adds |
| `TRACKING_DEV_TRUST_EDGE` | storefront only, dev | `1` trusts requests without the edge header when `NODE_ENV !== "production"` |
| `TRACKING_DRY_RUN` | backend only, optional | `1` marks outbox rows `dry_run` with no network call (CI, local) |

Derived values, `hmac(m) = HMAC-SHA256(TRACKING_INGEST_SECRET, m)` lowercase hex:
- ingest key header: `hmac("ingest-v1")`
- staff link token: `hmac("staff-link-v1")`; staff cookie value:
  `hmac("staff-cookie-v1")`
- InitiateCheckout id: `"ic-" + hmac("ic-v1:" + cart.id).slice(0, 24)`

Backend `lib/tracking/secret.ts` (WP01) and storefront
`lib/tracking/server/keys.ts` (WP11) implement these and are tested with the
secret `0123456789abcdef0123456789abcdef` against Appendix C `keys`.
Verification is timing-safe with a length check and fails closed when the secret
is missing or shorter than 32 chars. Rotating the secret invalidates staff
cookies and links; staff click the new link.

### 4.8 Server-only guard (storefront)

`server-only` is not installed. Every module under
`apps/storefront/src/lib/tracking/server/` starts with
`import { assertServer } from "./guard"` and calls `assertServer()` at module
top level; `guard.ts` throws when `typeof window !== "undefined"`. A test scans
every `"use client"` file and every file they import under `src/` and fails if
any imports `lib/tracking/server/`.

---

## 5. Events and the browser runtime

### 5.1 The stub (layout chunk, WP10) and the client queue (WP14)

**As built (the budget trim, 19.3).** The layout set came out at +1,724 B
against its +1,200 B budget, so the eager code was cut to recording only and
the rest moved into a second lazy chunk. The spec text after this box is the
original; where it differs, this box is what the code does.

```ts
// lib/tracking/queue.ts (layout chunk; imports only ./paths and types from ./contract)
export type QueueItem = { n: BrowserEventName | "Purchase"; id?: string; t: number; p: string;
                          d?: Record<string, unknown>; s?: 1 }  // id and p are raw until batch.ts prepare()
export type RawLanding = { search: string; ref: string; path: string }  // unparsed; boot.ts cuts it
export type FlState = { q: QueueItem[]; landing: RawLanding | null; cfg: IdResponse | null;
                        cfgPromise?: Promise<IdResponse>; wake?: () => void }
export function fl(): FlState      // a throwaway state without a window
export function track(name: BrowserEventName, data?: Record<string, unknown>, id?: string): void
                                   // records p = pathname + search as they are, t = Date.now()
export function trackPurchase(block: PurchaseBlock): void  // s: 1 from birth, then wake() in a try

// lib/tracking/batch.ts (lazy chunks only)
export function newEventId(): string
export function prepare(item: QueueItem): ReadyItem  // in place, idempotent: uuid v4 id, p cut to safePath
export function takeUnsent(max?: number): ReadyItem[] // prepared, marked s = 1, never a Purchase
export function restoreUnsent(items: QueueItem[]): void
```

- `tracker-stub.tsx` only records: one PageView per public pathname (with
  `first`), and on the first one the raw landing `{ search, ref, path }` from
  the address bar. On each public pathname until the id call has gone it
  schedules, at `requestIdleCallback` (2 s timeout, `setTimeout` fallback),
  `retryImport(() => import("@/lib/tracking/boot"), false)`, then
  `identify()`.
- `lib/tracking/boot.ts` (lazy, about 1.6 KB gzip) makes the id call once per
  document (skipped while the page is private, then retried on the next public
  pathname), with the landing cut to `landingParams` and the referrer's origin;
  it stores the inert answer on any failure, registers the `pagehide` /
  hidden beacon (sent only when something is unsent) and schedules the
  runtime with the timing below, again through `retryImport(..., false)`.
- The runtime prepares every queued item at `start()`, before the scrub and
  before any vendor script, and each new item as it is pushed, so no raw
  address outlives the start of the runtime. Until then the raw address
  exists only in the tab's memory.
- On the first visit after a deploy the id call waits for one extra
  (edge-cached) chunk fetch. No event is lost to that: the beacon always
  waited for the id answer anyway.

Original spec:

`apps/storefront/src/lib/tracking/queue.ts` (WP14) is the only tracking API
client components import. It must stay tiny: no imports except `./paths` and
`import type` from `./contract`; no `window` access at module top level.

```ts
export type QueueItem = { n: BrowserEventName | "Purchase"; id: string; t: number; p: string;
                          d?: Record<string, unknown>; s?: 1 }        // s: server copy handed off
export type FlState = { q: QueueItem[]; landing: LandingSnapshot | null;
                        cfg: IdResponse | null; cfgPromise?: Promise<IdResponse>; wake?: () => void }
export function fl(): FlState                              // (window.__fl ||= { q: [], landing: null, cfg: null })
export function newEventId(): string                       // crypto.randomUUID, else a v4 from getRandomValues, else Math.random
export function track(name: BrowserEventName, data?: Record<string, unknown>, id?: string): void
export function trackPurchase(block: PurchaseBlock): void  // pushes { n: "Purchase", id: block.event_id, d: block, s: 1 }, then fl().wake?.() synchronously
export function takeUnsent(max?: number): QueueItem[]      // non-Purchase items without s; marks them s = 1
export function restoreUnsent(items: QueueItem[]): void    // clears s when a send failed
```
`track()` does nothing on the server or when `isPrivatePath(location.pathname)`;
it records `p = safePath(location.pathname, location.search)` and
`t = Date.now()` at call time.

`apps/storefront/src/components/tracking/tracker-stub.tsx` (WP10), `"use client"`,
renders `null`, mounted in `app/layout.tsx` right after `<PerformanceAuditLoader />`
(outside `CartProvider`, so its effects run before page effects). Nothing else in
the layout changes.
- Module-level `lastPath` guard (StrictMode double effects send once).
- Effect on `usePathname()`: if the pathname equals `lastPath`, return. Call
  `fl().wake?.()` (the runtime re-checks vendors). If the path is private,
  remember it and return. Otherwise: on the first public path of the document
  snapshot `fl().landing = { q: landingParams(location.search), ref: referrer
  origin only (or null), path: pathname }`; push `track("PageView", { first })`
  where `first` is true only for the document's first PageView; and on that
  first public path start the id call.
- Id call: at `requestIdleCallback` (timeout 2 s; `setTimeout(0)` fallback),
  `fetch("/api/t/id/", { method: "POST", credentials: "same-origin", keepalive: true,
  body: JSON.stringify({ v: 1, landing }) })`; store the promise in
  `fl().cfgPromise` and the result in `fl().cfg`; on any error store an
  `{ on: false }` response.
- Beacon: on `pagehide` and on `visibilitychange` to hidden, if `fl().cfg?.on`,
  `navigator.sendBeacon("/api/t/e/", new Blob([JSON.stringify({ v: 1, sent_at:
  Date.now(), events: takeUnsent(25) })], { type: "text/plain" }))`; if it
  returns false, `restoreUnsent`. This covers bounces and BuildWatcher reloads
  without any vendor code (I7).
- Runtime load, only after the id response says `on && !optout`, and never
  when `navigator.connection.saveData`:
  - landing has a click key (`landing.click`): at `load` (no wait, no idle)
  - path is `/checkout/`: at `load` + `requestIdleCallback` (no 3 s, I19)
  - otherwise: `load` + 3 s + `requestIdleCallback` (the `header-dialogs.tsx`
    pattern)
  - `retryImport(() => import("@/lib/tracking/runtime"), false).then((m) =>
    m.start()).catch(() => {})` (`components/header/load-on-intent.tsx`).
    Never `next/dynamic`, `<Script>` or `useSearchParams`.

### 5.2 The runtime (lazy chunk, WP10)

`apps/storefront/src/lib/tracking/runtime.ts` exports `start()` and contains
the marker constant `RUNTIME_VERSION = "fl-runtime-v1"`, sent as `rv` in every
`/api/t/e/` batch (the budget script finds the chunk by this string).
`start()`:
1. `cfg = fl().cfg ?? await fl().cfgPromise`; stop unless `cfg.on && !cfg.optout`.
2. Scrub `review` and `r` from the address bar with
   `history.replaceState(history.state, "", cleaned)` before any vendor script.
3. Server batching: every 2 s, or at once when 10 unsent items wait, POST
   `takeUnsent(25)` to `/api/t/e/` (`fetch`, `keepalive`, JSON, `rv`); on failure
   `restoreUnsent`. Purchase items are never sent (they are `s: 1` from birth).
4. Vendors: for each of `meta`, `tiktok`, `google` with `load: true` and
   `!cfg.staff`, inject its script only while `location.pathname` is public
   (otherwise wait: the stub calls `fl().wake` on every pathname change). A
   vendor is "ready" only after its script's `onload`.
5. `fl().wake = drain`; `drain()` now.

`drain()`: each ready vendor keeps a cursor into `fl().q`. For each item from
the cursor on, the vendor call happens only if, at that moment,
`!isPrivatePath(location.pathname)` and `location.pathname` equals the item's
pathname; otherwise that vendor's copy is dropped (the server copy still goes).
Then the cursor advances. As built (19.10): also only while the address bar
carries no `review` or `r` (`carriesReview()`). A client navigation to a
`?review=` link wakes `drain()` before the product page has read and dropped
the token, so those browser copies are dropped; `drain()` never scrubs
(scrubbing stays in `start()` and the injection).
- Meta: `PageView` with `d.first` gives `fbq("track", "PageView", {}, { eventID })`;
  route-change PageViews get no Meta browser copy. VC/ATC/IC give
  `fbq("track", name, customData, { eventID })`. Purchase (only if
  `block.platforms.meta`): `fbq("init", id, cfg.share ? match.meta :
  { external_id: match.meta.external_id })` then `fbq("track", "Purchase", data,
  { eventID })`.
- TikTok: every allowed PageView gives `ttq.page()`; VC/ATC/IC give
  `ttq.track(name, props, { event_id })`; Purchase (if `platforms.tiktok`):
  `ttq.identify(cfg.share ? match.tiktok : { external_id })` then track.
- Google: Purchase only (if `platforms.google`): when `cfg.share &&
  match.google`, `gtag("set", "user_data", match.google)`; then
  `gtag("event", "conversion", { send_to: id + "/" + label, value, currency:
  "BDT", transaction_id: event_id, page_location: "https://" + location.host +
  "/checkout/" })`.
- Purchase double-fire guard: `sessionStorage` key `fl_p_<event_id>` read and
  written in try/catch around the Purchase vendor calls.
- `trackPurchase()` calls `wake()` synchronously, so Purchase browser copies
  fire before `router.push`. A vendor that is not ready then never fires the
  Purchase (the pathname has changed by the time it is ready).

Nothing tracking-related is stored in localStorage or sessionStorage except the
Purchase guard key, and never PII.

As built (19.3, WP10): TikTok is ready only after `onload` AND `ttq.ready()`
(events.js is a loader; before `ready()` ttq is still the stub that would
replay later). New queue items are noticed by wrapping `push` on the queue
array (drain and batch check in a microtask; the 2 s timer starts with the
first unsent item, no always-on interval). Script injection waits one
`setTimeout(0)` after the wake, then re-checks the path and scrubs again. A
failed batch is restored only on a network error or a 5xx. The guard value
lists the vendors that already fired (`"meta,tiktok"`), so each vendor fires
once per tab. With no match data the Purchase re-init/identify is skipped.

### 5.3 Event catalogue

Item ids are Medusa variant ids, `content_type: "product"`, currency `"BDT"`
(upper case; Medusa uses `bdt`), amounts in BDT major units (`lib/money.ts`).

| Event | Fired by | event_id | Browser copies | Server copies | Dashboard |
|---|---|---|---|---|---|
| PageView (first of document) | stub, first public pathname, `d.first = true` | uuid v4 | Meta (eventID), TikTok `ttq.page()` | Meta CAPI (same id) | hit, flag 32 |
| PageView (client route change) | stub, pathname change only (query-only changes do not count) | uuid v4 | TikTok `ttq.page()` only | Meta CAPI only | hit |
| ViewContent | `ProductView` post-hydration effect after `pickFromQuery` settles, `primary: true`; optional variant switch, debounced 1.5 s, max 3 per mount, `primary: false` | uuid v4 | Meta, TikTok | Meta, TikTok | hit (product views count primary only) |
| AddToCart | `CartProvider.add()` after `await addToCartAction` resolves and BEFORE the seq check; `addMany()` after `await addManyToCartAction`. Never in catch | uuid v4 | Meta, TikTok | Meta, TikTok | hit |
| InitiateCheckout | `CheckoutForm` mount effect with a ref guard, only when the page passed an id | `ic-` + 24 hex (4.7) | Meta, TikTok | Meta, TikTok | hit |
| Purchase | backend step `record-purchase-tracking`; browser copy from `CheckoutForm` inside `if (result.ok)` BEFORE `router.push` | `fl-<display_id>` | Meta, TikTok, Google (per `platforms`) | Meta, TikTok | hit (origin s) |
| OrderConfirmed | `lib/order-status.ts`, a move INTO confirmed/shipped/delivered | `oc-fl-<n>` | none | Meta custom, `system_generated` | order_op counts |
| Delivered | same, `to = delivered` | `dl-fl-<n>` | none | Meta custom | same |
| Returned | same, `to = returned` (Steadfast cancelled* maps to returned) | `rt-fl-<n>` | none | Meta custom | same |

### 5.4 Fields per event and the component changes (WP12)

- **ViewContent** (`components/product-view.tsx`, the once-after-hydration
  effect): compute `pick = pickFromQuery(...)`, `ct = pick?.caseType ??
  caseType`, `dev = pick?.device ?? device`, `vid =
  matrix.variantIdByPair[pairKey(ct, dev)]`, `v = vid && variantById.get(vid)`.
  If `v` has `calculated_price.calculated_amount` and a per-mount ref
  (`useRef(false)`, I9) is unset: `track("ViewContent", { items: [{ id: vid, q:
  1, price }], value: price, currency: "BDT", handle: productHandle, device: dev,
  case_type: ct, primary: true })`. Keep the existing `setCaseType`/`setDevice`
  logic unchanged. The optional variant-switch event is a separate debounced
  effect on `selectedId` that skips runs until the primary event has fired.
- **AddToCart** (`components/cart-provider.tsx`): `add()` records
  `items: [{ id: variantId, q: quantity /* the requested argument, not
  added.quantity */, price: added?.unitPrice ?? optimistic.unitPrice }]`,
  `value = price * quantity`. `addMany()` records ids and quantities from the
  `items` argument, each price from `serverItems` by variant id (0 if missing;
  the server replaces prices anyway), and `value = optimistic.unitPrice` (the
  pack total). Currency `(serverSummary.currencyCode || "bdt").toUpperCase()`;
  skip the event unless it is `"BDT"`. Buy-it-now with nothing to add fires
  nothing.
- **InitiateCheckout** (`components/checkout-form.tsx`): `CheckoutLine` gains
  `variant_id?: string | null` (I25), set in `checkoutLines()` from
  `item.variant?.id ?? null` (`lib/checkout-form-data.ts`). Items are the
  initial lines with a variant id; `value = subtotal - bundleDiscount`;
  `num_items` = total quantity; event id = the `trackingEventId` prop from
  `app/checkout/page.tsx` (`icEventId(cart.id)`, never the raw cart id). The
  form is empty at mount, so no PII exists.
- **Purchase**: `lib/checkout.ts` `placeOrder(input, customerToken?,
  trackingHeaders?)` adds the two headers when given; its success type becomes
  `{ ok: true; order: PlacedOrder; tracking?: PurchaseBlock }` using
  `isPurchaseBlock` from `contract.ts` (a malformed block is ignored).
  `lib/cart.ts` `submitOrder` gets headers from `checkoutTrackingHeaders()`
  (WP11) and passes them; no new export from that `"use server"` file.
  `checkout-form.tsx` calls `if (result.tracking) trackPurchase(result.tracking)`
  as the FIRST statement inside `if (result.ok)`, before `applySummary` and
  `router.push`.
- **Consent line**: `app/checkout/page.tsx` passes `consent =
  checkoutConsent(await getTrackingConfig())` (`{ text, version } | null`, only
  non-null while share is ON). `checkout-form.tsx` renders
  `{consent ? <p className="checkout-terms">{consent.text} <Link
  href="/privacy/">Privacy policy</Link></p> : null}` right after the existing
  `checkout-terms` paragraph, which stays.
- As built (19.3, WP12): InitiateCheckout is skipped when the currency is not
  BDT or `icEventId` returns null (secret unset); its value is
  `max(0, subtotal - bundleDiscount)`, `num_items` counts every initial line
  and `items` lists only lines with a variant id. `addMany` sends only lines
  with a variant id, nothing when none is left. `trackAdd` wraps `track()` in
  a try. `submitOrder` reads the headers with the customer token in one
  `Promise.all`, `.catch(() => null)`; `placeOrder` spreads the tracking
  headers first and checks the block inside a try. Simple products send
  `d.device` as `''` (the backend takes device and case type from the
  variant index).

Server copy fields:
- Meta `custom_data`: VC/ATC `{ content_type, content_ids, contents: [{ id,
  quantity, item_price }], value, currency }`; IC adds `num_items`; Purchase adds
  `num_items`, `order_id: "fl-N"`, `delivery_category: "home_delivery"`.
- TikTok `properties`: `{ content_type: "product", contents: [{ content_id,
  quantity, price }], value, currency }`; Purchase adds `order_id`, `num_items`.
- Purchase is built from the saved order: `items[].variant_id`, `unit_price`,
  `quantity`, `order.total` (includes delivery, decision 7), `display_id`.
  `event_time` = `order.created_at`. `event_source_url` / `page.url` =
  `https://<host>/checkout/`, never `/order/`.
- COD events (Meta only): `action_source: "system_generated"`, `event_time` =
  the transition time; `custom_data { currency, value: order.total, order_id:
  "fl-N", content_type, content_ids }`; `original_event_data { event_name:
  "Purchase", event_time: <purchase unix>, order_id: "fl-N", event_id: "fl-N" }`;
  `user_data`: external_id, fbp, fbc, country, plus contact hashes when share is
  ON.

### 5.5 Vendor loading rules (WP10 `pixels/*.ts`)

- **Meta** (`pixels/meta.ts`): build the standard `fbq` stub, set
  `fbq.disablePushState = true` on it BEFORE the script is appended, queue only
  `fbq("set", "autoConfig", false, id)` and `fbq("init", id)` (no user data;
  these two config calls are the only calls allowed before `onload`), then
  append `https://connect.facebook.net/en_US/fbevents.js` (async) with `onload`
  marking Meta ready. Nothing else may call `init` with data except the Purchase
  re-init (fbevents.js ignores a second init once explicit user data exists).
  Loads only when `cfg.meta.load` (which requires `aam_off_confirmed[env]`).
- **TikTok** (`pixels/tiktok.ts`): build the standard `ttq` stub WITHOUT the
  snippet's automatic `ttq.page()`; inject the loader
  (`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=<id>&lib=ttq`)
  ourselves so `onload` can be observed; if TikTok documents a load option that
  turns off automatic SPA page views, pass it and record in a code comment what
  was verified and where. The owner also switches off SPA page views and
  automatic events in both pixels (owner step C), which the `spa_off_confirmed`
  gate requires. As built (19.10): and Automatic advanced matching, which
  reads the checkout's phone and email; the same checkbox confirms it.
- **Google** (`pixels/google.ts`): `dataLayer`/`gtag` stub; when `!cfg.share`,
  `gtag("consent", "default", { ad_user_data: "denied" })` first; then
  `gtag("js", new Date())` and `gtag("config", id, { send_page_view: false })`,
  adding `page_location: cfg.landing.url` only when `cfg.landing.click` is a
  Google key and the current URL no longer carries it; append
  `https://www.googletagmanager.com/gtag/js?id=<id>` with `onload`. Only the
  Purchase conversion is ever sent. Google exists only on live hosts.
- fbevents (about 111 KB gz + 61 KB config) and gtag (about 162 KB gz) are never
  preloaded, bundled or requested before the page is usable (section 11).

---

## 6. Backend pipeline

### 6.1 Server copies and skip rules

- Meta: PageView (both kinds), ViewContent, AddToCart, InitiateCheckout,
  Purchase, and the COD events enabled in `meta.status_events`.
- TikTok: ViewContent, AddToCart, InitiateCheckout, Purchase. No PageView, no COD
  events.

Funnel events (ingest, WP04). For each event and platform, enqueue a `pending`
row only when all hold; otherwise no row:
- the batch host has a destination for the platform (3.4);
- the token for (platform, env) is set (else counter `ingest.no_token_dropped`);
- `ctx.staff` is false (staff: hit flagged 8, no rows);
- for VC/ATC/IC, every item's variant id exists in the variant index with a
  price (else hit flag 64, counter `ingest.unknown_variant`, no rows for that
  event);
- Meta needs `ctx.ua`.

Prices (B5): each item's `price` is replaced by the variant index price;
`value = min(client value, sum(index price * q))`, at least 0. Hits store the
replaced value.

Purchase and COD rows (WP05, WP06), per platform, via `buildOrderEventRows()`:

| Context / platform state | Row |
|---|---|
| context untrusted (`trusted = false`), staff or optout; host not allowlisted | none (reconcile skips these too) |
| platform disabled, COD toggle off, or no destination id | `skipped`; payload kept when a destination existed, else payload null and destination `''` |
| token missing for (platform, env) | `blocked`, `last_error = "no token"`, payload kept (the token-fingerprint requeue recovers it within 6 days) |
| otherwise | `pending` |

A `skipped` row means "deliberately not sent". Only the admin "Send skipped"
action (Retry with `skipped`) sends them (I3).

As built (19.3, WP04/WP05): a variant is known when it is in the index with a
finite price above 0 (`sellable` is not required, so Alcantara events still
go to Meta); the value is clamped to the index prices of the known items, and
the hit takes handle, device and case type from the index. `ingest.no_destination`
counts only an ENABLED platform without an id. Order rows take their
destination from the context's STORED env, so COD events go to the same
dataset as their Purchase. A Meta Purchase whose context has no user agent is
`skipped` ("skipped: no user agent"). Skipped rows carry a short reason
("skipped: Meta is off"); blocked rows use exactly "no token".

### 6.2 Payload builders and hashes (pure, WP02)

`apps/backend/src/lib/tracking/adapters/common.ts` owns the server event
vocabulary (`ServerPlatform = "meta" | "tiktok"`, `ServerEventName`,
`AdapterConfig`, `SendResult`), so WP02 imports nothing from WP01. Allowed
imports: `node:crypto` and `../contact` (`bdMobile`, `realEmail`).

**Meta** `POST https://graph.facebook.com/{api_version}/{dataset}/events`, JSON
body `{ data: [...], access_token, test_event_code? }` (the token in the body,
never the URL). `test_event_code` only when `env === "test"` and a code is set.
Per event: `event_name`, `event_time` (unix s, UTC), `event_id`,
`action_source` (`website` for funnel + Purchase), `event_source_url`
(`https://host` + allowlisted path), `user_data`, `custom_data`, `opt_out:
false`.
- Browser-origin `user_data`: `{ client_ip_address, client_user_agent, fbp?,
  fbc?, external_id: [sha256(vid)], country: [sha256("bd")] when ctx.country is
  "BD" }`.
- Purchase adds, only with share ON: `ph` (sha256 of `metaPhone`), `fn`, `ln`
  (`metaName`), `ct` (`normCity` of the district), `em` (only `realEmail()`).
- Never hash ip, ua, fbp or fbc. Never accept a Parameter Builder suffixed hash:
  every hashed field must match `^[0-9a-f]{64}$`.
- At most 500 events per request.

**TikTok** `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`,
header `Access-Token`, body `{ event_source: "web", event_source_id: pixel,
data: [...] }`. Per event: `event` (exact case), `event_time`, `event_id`,
`user { external_id, phone (sha256 of e164), email, ttclid, ttp, ip (no suffix),
user_agent }`, `properties`, `page { url }`. At most 500 per request.

Hash helpers (`lib/tracking/hash.ts`):
- `sha256Hex(s)`
- `metaPhone(v) = bdMobile(v)` ("8801XXXXXXXXX", no plus); `e164Phone(v) = "+" +
  bdMobile(v)`
- `metaName(v)`: NFC, lowercase, remove Unicode punctuation/symbols and ALL
  whitespace (I23); `plainName(v)`: NFC, lowercase, trim, collapse spaces,
  remove punctuation (Google, TikTok)
- `normCity(v)`: lowercase, remove whitespace and punctuation ("Cox's Bazar" to
  "coxsbazar")
- `normEmail(v) = realEmail(v)` trimmed and lowercased, or null
- `googleEmail(v)`: `normEmail`, then remove dots in the local part for
  `gmail.com` / `googlemail.com`

Names come from the stored `shipping_address.first_name` / `last_name` (already
split at checkout: last word = last name; a single word gives only `fn`). Phone
from `shipping_address.phone`, falling back to `metadata.customer_phone`. City
from `shipping_address.province`, falling back to `metadata.district`.

`match-keys.ts`: `buildMatchKeys({ order, visitorId, share })` returns
`{ metaCapi, metaPixel, tiktokApi, tiktokPixel, google }`; empty fields are
omitted; share OFF keeps only external_id (and Meta country).

As built (19.10): `share` is decided per order (`order-events.ts`
`sharesContact`): `privacy.share_contact_hashes === true` AND the stored
`tracking_order_context.context.consent_version != null`, i.e. that shopper
was shown the consent line. It covers the Purchase server rows, the COD
status rows, reconcile and the browser Purchase block's match data (Meta and
TikTok pixel keys, Google `user_data`). Turning sharing ON never adds hashes
to an order placed before it.

`event-ids.ts`: `purchaseEventId(displayId)`, `statusEventId(kind, displayId)`,
`isBrowserEventId(name, id)`.

Error classes (`classifyMeta`, `classifyTikTok`):

| Vendor response | Class | Action |
|---|---|---|
| network error, timeout, HTTP 5xx; Meta code 1, 2, 4, 17, 341, 368; TikTok 40100 (arrives as HTTP 401) | transient | retry with backoff |
| Meta OAuthException / 102 / 190, 10, 200-299; TikTok 40001, 40104, any other 401 | blocked | `blocked` + alert `token`; requeued automatically when the token fingerprint changes |
| Meta 100, TikTok 40002 (zero-based index parsed from the message) | payload | split the batch and retry at once; a single bad row becomes `failed` (log fbtrace_id / request_id + message) |
| Meta event_time older than 7 days | expired | `expired`, no retry |

`sendMetaBatch(fetch, cfg, events)` / `sendTikTokBatch(fetch, cfg, events)` use
the injected fetch and an 8 s `AbortSignal.timeout`, and never put the token in
a thrown error or a returned message.

### 6.3 Outbox (WP03, `lib/tracking/outbox.ts`)

- `enqueue(trxOrContainer, rows)`: `INSERT ... ON CONFLICT (platform,
  event_name, event_id) DO NOTHING` (via WP01 `insertOutbox`).
- `scheduleFlush(container)`: module-level debounce 2 s, max wait 5 s, never
  awaited, never inside a subscriber.
- `runOutboxSweep(container, { timeBudgetMs = 40000 })`, in order:
  1. reclaim: `update tracking_event set status = 'retry', next_attempt_at =
     now() where status = 'sending' and locked_until < now()` (I4)
  2. expire: rows `pending`/`retry` with `event_time < now() - interval '6.5
     days'` become `expired`, payload NULL (never mixed into a request)
  3. token requeue: for each (platform, env), if sha256(token).slice(0, 8)
     differs from `token_fp:<platform>:<env>`, rows `blocked` within 6 days go to
     `retry` with `attempts = 0`; store the new fingerprint
  4. flush up to 20 batches inside the time budget
- `flush(container, { maxBatches = 10 })`: claim with
  `UPDATE tracking_event SET status = 'sending', locked_until = now() + interval
  '2 min', attempts = attempts + 1 WHERE id IN (SELECT id FROM tracking_event
  WHERE status IN ('pending','retry') AND next_attempt_at <= now() AND
  event_time >= now() - interval '6.5 days' ORDER BY id LIMIT 500 FOR UPDATE
  SKIP LOCKED) RETURNING ...`; group by (platform, env, destination); load the
  token (10 s settings cache); `TRACKING_DRY_RUN=1` marks `dry_run` with zero
  fetch calls; otherwise send and mark: sent gives `status = 'sent', sent_at =
  now(), payload = NULL`; transient gives `retry` with backoff by attempt 1 m,
  2 m, 5 m, 15 m, 1 h, 3 h, 6 h, 12 h, then `failed`; token missing at send
  time gives `blocked` "no token".
- `pruneRetention(container)` (hourly branch of the job, 10k-row batches): sent
  and dry_run older than 8 d; failed, expired, blocked, skipped older than 14 d;
  hits 7 d; cart contexts 14 d; order contexts 90 d; minutes 35 d; sessions
  90 d; counters 35 d; feed fetches 30 d.
- `lib/tracking/health.ts` exports `outboxHealth(container)` (counts per
  platform/env/status, sent in 24 h, last sent_at, last error) used by BOTH the
  Health route and the Live page (one implementation).
- `last_error` is at most 500 chars: class, vendor code, message, trace id.
  Never a token, payload or PII.
- As built (19.3, WP03): at SEND time rows whose platform is now off, or whose
  env is live while `live_armed` is off, become `skipped` (payload kept). All
  eight backoff delays are used, so a row is `failed` after its 9th failed
  send. `dry_run` rows keep their payload until retention. Rows not at fault
  in a split batch (TikTok 40002 with an index, Meta 7-day) are resent in the
  same run.

### 6.4 Jobs and the jobs registry

`apps/backend/src/lib/tracking/jobs.ts` (WP01):
```ts
export type TrackingJobName = "outbox" | "rollup" | "reconcile" | "catalog"
export function registerTrackingJob(name: TrackingJobName, spec: { staleAfterMs: number; run: (container: any) => Promise<void> }): void
export async function runTrackingJob(container: any, name: TrackingJobName, run: (container: any) => Promise<void>): Promise<void>
export function kickStaleJobs(container: any): void
export async function jobStates(container: any): Promise<Record<TrackingJobName, JobState | null>>
```
- `runTrackingJob` writes `job:<name>.last_run_at` first, then `last_ok_at` or
  `last_error` (at most 300 chars); an in-process `running` flag per job skips
  overlapping runs; it never throws.
- `kickStaleJobs` is fire-and-forget: it reads `job:*` states (cached 30 s) and
  runs, in-process, any registered job whose `last_run_at` is older than its
  `staleAfterMs`, at most once per minute per job per process. Called by
  ingest, the checkout record step, and the admin settings, health and live GET
  routes. This survives Redis evicting BullMQ repeat keys (invariant 2).
- Each job file registers itself at module top level and its default export
  calls `runTrackingJob`:

| Job file | Owner | Schedule | staleAfterMs | Runs |
|---|---|---|---|---|
| `jobs/tracking-outbox.ts` | WP03 | `"* * * * *"` | 180000 | `runOutboxSweep`, `checkAlerts`, hourly `pruneRetention` |
| `jobs/tracking-rollup.ts` | WP07 | `"* * * * *"` | 180000 | `runRollup` |
| `jobs/tracking-reconcile.ts` | WP05 | `"*/5 * * * *"` | 900000 | `reconcilePurchases` |
| `jobs/catalog-feed.ts` | WP08 | `{ interval: 900000 }` | 2700000 | variant index, image conversion, feed build/publish |

### 6.5 Purchase capture at checkout (WP05)

`apps/backend/src/workflows/checkout.ts`: `checkoutWorkflow` and its input type
stay byte-identical (the quote route and the isolated script use it). Add in the
same file:

```ts
type TrackedInput = Input & { tracking?: CheckoutTrackingContext | null }
const stashCheckoutTrackingStep = createStep("stash-checkout-tracking", ...)   // returns new StepResponse(null)
const recordPurchaseTrackingStep = createStep("record-purchase-tracking", ...) // returns new StepResponse(block | null)
export const checkoutWithTrackingWorkflow = createWorkflow("checkout-with-tracking", (input: TrackedInput) => {
  stashCheckoutTrackingStep(input)
  const result = prepareCheckoutStep(input)
  const tracking = recordPurchaseTrackingStep({ input, result })
  return new WorkflowResponse(transform({ result, tracking }, ({ result, tracking }) =>
    tracking ? { ...result, body: { ...result.body, tracking } } : result))
})
```
- Stash: when `input.complete && input.tracking` and `body.cart_id` matches
  `^cart_[A-Za-z0-9]+$`, upsert `tracking_cart_context`. Never throws.
- Record: only when `result.status === 200 && result.body.order?.id`
  (covers the first success and both recovery paths inside `runCheckout`).
  Calls `recordPurchase()`, catches everything, logs one short line (never a
  body), returns the block or null. Order placement never fails because of
  tracking.
- `api/store/checkout/route.ts`: `decodeTrackingHeader(req.headers)`, run
  `checkoutWithTrackingWorkflow` with `tracking: ctx`, bump
  `checkout.header_rejected` when rejected, then
  `res.status(result.status).json(result.body)` exactly as today. The quote
  route is untouched.

`recordPurchase(container, { orderId, cartId, ctx?, source })` in
`lib/tracking/purchase.ts`:
1. Context = the given one, else `tracking_cart_context` by cart id; none gives
   null.
2. Load the order (`loadOrdersForEvents`); skip drafts and imported orders.
3. ONE knex transaction: insert `tracking_order_context` (ON CONFLICT DO
   NOTHING) and read the stored row back (first write wins, so every retry uses
   the same context); insert the Purchase hit (origin `s`, value = order total,
   items = sum of quantities, path `/checkout/`, visitor/session null when
   optout, flag 8 when staff) ON CONFLICT DO NOTHING; insert
   `buildOrderEventRows({ kind: "Purchase", ... })` ON CONFLICT DO NOTHING;
   commit.
4. `scheduleFlush()`, `kickStaleJobs()`.
5. Return `buildPurchaseBlock(order, storedContext, settings)` (same `event_id`
   on every retry).

As built (19.3, WP05): the stash waits at most 1 s and the record at most 3 s
(then the work finishes in the background and returns null to the response);
the record transaction sets `statement_timeout` 5 s. `buildPurchaseBlock`
returns null for an unusable display id. For an opted-out shopper the stored
contexts keep no ip, ua, ids or click ids. The Purchase hit also sets flag 16
for a new visitor. `scheduleFlush` runs only when rows were inserted.

`apps/backend/src/lib/tracking/order-events.ts` (WP05; WP06 reuses it and must
not re-implement any of it):
```ts
export type OrderEventKind = "Purchase" | "OrderConfirmed" | "Delivered" | "Returned"
export type OrderForEvents = { id; display_id; created_at; total; currency_code; email; is_draft_order;
  items: { variant_id; quantity; unit_price; title }[];
  shipping_address: { first_name; last_name; phone; province } | null; metadata }
export async function loadOrdersForEvents(container, orderIds: string[]): Promise<Map<string, OrderForEvents>>
export async function importedOrderIds(container, orderIds: string[]): Promise<Set<string>>
export async function loadOrderContexts(knexOrTrx, orderIds: string[]): Promise<Map<string, OrderContextRow>>
export function buildOrderEventRows(input: { kind: OrderEventKind; order: OrderForEvents; ctx: OrderContextRow;
  settings: TrackingSettingsView; at: Date; source: "checkout" | "reconcile" | "status" }): OutboxInsert[]  // pure, table in 6.1
export function buildPurchaseBlock(order: OrderForEvents, ctx: OrderContextRow, settings: TrackingSettingsView): PurchaseBlock  // pure
export async function insertOrderEvents(trx, rows: OutboxInsert[]): Promise<number>
```

### 6.6 Reconciliation (WP05, every 5 min)

`reconcilePurchases(container)`:
- (a) cart contexts updated in the last 6 days whose cart has an order
  (`query.graph({ entity: "order_cart", fields: ["order_id", "cart_id"],
  filters: { cart_id: [...] } })`, the pattern in `checkout-service.ts`) and no
  `tracking_order_context`: `recordPurchase(..., source: "reconcile")`.
- (b) orders created in the last 48 h with no `order_op` row: `ensureOps()`
  (imported from `lib/order-ops.ts`, which WP05 never edits), because
  `order.placed` can be lost.
- (c) trusted, non-staff, non-optout order contexts from the last 6 days that
  have NO `tracking_event (platform, 'Purchase', 'fl-N')` row for a platform:
  insert that platform's row with `buildOrderEventRows` (an off platform gets its
  `skipped` row, so this never becomes a silent backfill).
- Skips imported orders (`order_op.source`) and drafts.
- As built: (a) skips cart contexts touched in the last minute (an in-flight
  checkout) and (a) and (c) take at most 500 rows per run; (c) also needs
  `purchase_time` within 6 days.

### 6.7 Session source classification (WP11, `server/source.ts`, pure)

On a new session, first match wins:
1. `ttclid` gives `tiktok_paid`.
2. `gclid`, `gbraid` or `wbraid` gives `google_paid`.
3. `utm_medium` (lowercased) in (`paid`, `cpc`, `ads`, `ppc`, `paidsocial`)
   gives `<source>_paid`, where `utm_source` (lowercased) facebook, fb,
   instagram, ig, meta give `meta`; tiktok gives `tiktok`; google gives
   `google`; any other value is reduced to `[a-z0-9_-]` and cut to 30 chars;
   empty gives `unknown`.
4. `fbclid`, a referrer host matching `/(^|\.)(facebook|instagram)\.com$/`, or
   a UA matching `/FBAN|FBAV|Instagram/` gives `meta` (fbclid alone is not proof
   of paid).
5. A UA matching `/musical_ly|BytedanceWebview/` or a referrer host matching
   `/(^|\.)tiktok\.com$/` gives `tiktok`.
6. A referrer host matching `/(^|\.)google\.[a-z.]+$/` gives `google_organic`.
7. A referrer host matching `/whatsapp|wa\.me|messenger\.com/` or a UA matching
   `/WhatsApp/` gives `messaging`.
8. Any other referrer host gives `referral`; our own host or no referrer gives
   `direct`.
Campaign = `utm_campaign` (at most 80 chars), else null. Only the referrer's
origin is ever read or sent. Test vectors: Appendix C `source`.

---

## 7. COD status transitions (WP06)

New `apps/backend/src/lib/order-status.ts`:
```ts
export type TransitionSource = "staff" | "courier-send" | "courier-sync" | "steadfast-webhook"
export type StatusChange = { op: OrderOpRow; to: WorkflowStatus; extra?: Record<string, unknown>; at?: Date; via: TransitionSource }
export async function applyStatusChanges(container: any, changes: StatusChange[]): Promise<{ updated: number; changed: number }>
export async function moveOrdersToStatus(container: any, orderIds: string[], status: WorkflowStatus): Promise<void> // replaces setWorkflowStatus
```
- One `updateOrderOps` call: `{ id, ...extra, ...(to !== op.workflow_status ?
  { workflow_status: to, status_changed_at: at } : {}) }`.
- Then, for rows whose status actually changed and whose `op.source` is empty,
  `enqueueStatusEvents(container, [{ orderId, from, to, at }])`
  (`lib/tracking/status-events.ts`): fast DB work only, every error caught and
  logged, never thrown into the caller.
- `setWorkflowStatus` is removed from `lib/order-ops.ts` (its only caller is the
  status route). No import may be added to `lib/order-ops.ts`
  (`tests/florayn-import.test.cjs` loads it with a stub that returns utils for
  every import); `order-status.ts` imports from `order-ops.ts`, never the
  reverse.

Writers to replace:

| Writer | Today | Change |
|---|---|---|
| Manual staff status | `api/admin/order-ops/status/route.ts` -> `setWorkflowStatus` | calls `moveOrdersToStatus` |
| Courier booking | `api/admin/courier/send/route.ts` (the `workflow_status: "shipped"` update) | builds `StatusChange { to: "shipped", extra: steadfast fields, via: "courier-send" }`, one `applyStatusChanges` |
| Courier sync | `api/admin/courier/sync/route.ts` | same; keeps "advance only off shipped"; non-advancing rows update the steadfast fields via `extra` with `to = op.workflow_status` |
| Steadfast webhook | `api/webhooks/steadfast/route.ts` | same; keeps courier_meta merging and "advance only off shipped"; idempotent on retries |
| florayn.com import | `lib/florayn-import.ts` | untouched (history; source set) |

`statusEventsFor(from, to)` (pure; nothing when `from === to`), I2:
- `to` in {confirmed, shipped, delivered} gives OrderConfirmed (once per order
  by the outbox key, so moves like processing -> cancelled -> confirmed still
  count, and courier-send straight from processing counts). As built: only
  when `from` is NOT already confirmed, shipped, delivered or returned. The
  outbox key holds only while its row exists (sent rows are pruned after 8
  days), so a delivery more than 8 days after confirmation would otherwise
  send `oc-fl-N` again. Every example above still holds; confirmed ->
  shipped now gives nothing (19.3, WP06).
- `to === "delivered"` also gives Delivered.
- `to === "returned"` gives Returned.
- refunded, cancelled and processing give nothing.

`enqueueStatusEvents`: load contexts (`loadOrderContexts`) and orders
(`loadOrdersForEvents`); skip orders without a context, untrusted, staff,
optout, imported; for each event build rows with `buildOrderEventRows({ kind,
..., at, source: "status" })` (Meta only; a toggle that is off gives `skipped`)
and insert them in one transaction; then `scheduleFlush()`. The destination
comes from the context's host/env.

A static test scans `apps/backend/src` and fails if `workflow_status` is written
by `updateOrderOps`/`createOrderOps` anywhere except `lib/order-status.ts`,
`lib/order-ops.ts` (initial rows in ensureOps/backfillOps) and
`lib/florayn-import.ts`.

As built (19.3, WP06): the caller waits at most 2 s (`ENQUEUE_BUDGET_MS`) for
the enqueue; past that it finishes in the background with one log line. Log
lines carry only the order count, the transition source and the error
name/code, never order ids or messages. A change with nothing to write is
left out, and duplicate order ids are merged. `extra` can never carry `id`,
`workflow_status` or `status_changed_at`. Courier send no longer resets
`status_changed_at` for an order staff had already moved to shipped (only the
review-request timer notices). The event time is when the backend learns of
the move, not Steadfast's own timestamp.

---

## 8. Catalog feed (Meta + TikTok) and the variant index (WP08)

Facts: 376 products = 183 designs across forms (phone 181, AirPods 171, watch
11, wallet 11) + 2 regular products; 13,041 sellable variants, at most 102 per
product. The old catalog `1643298616640045` (WooCommerce ids, 2.56% match) is
replaced, not migrated.

### 8.1 Variant index (`lib/tracking/variant-index.ts`)

- `rebuildVariantIndex(container)`: reads products in 25-product batches with
  the `rebuildCards` query shape (`lib/rebuild-cards.ts`), resolves each
  variant's BDT price (what checkout charges), case type, device, sku and stock
  (through `lib/stock-availability.ts`), upserts `tracking_variant`, deletes ids
  no longer present, sets `sellable` (published product, active device and case
  type, BDT price present), and writes `tracking_state variant_index`.
- `lookupVariants(container, ids)`: returns a `Map<id, { price, sellable,
  handle, case_type, device }>` from an in-process copy of the whole index,
  refreshed when `variant_index.built_at` changes (checked at most every 60 s).
- Rebuilt by the catalog job when the index is empty, when `catalog:stale` is
  newer than the last index build, or once every 24 h, whether or not the
  catalog is enabled. Until the first build every VC/ATC/IC counts as unknown and
  sends nothing to ad platforms (fail safe). As built (19.10): stock-only event
  batches no longer set `catalog:stale` (8.5), so the index follows a pure
  stock change at its 24 h rebuild, or sooner with any product change.

### 8.2 Items and columns

- One item per sellable variant; `id` = variant id; `item_group_id` = product
  id. Out-of-stock variants stay with `availability: out of stock`.
- Case types in `catalog.exclude_case_types` (default `alcantara`, decision 9)
  are left out; a non-empty `include_case_types` limits to those.
- Availability per blank (case type x device) exactly as `/store/stock`; regular
  products use the per-variant branch. Extract both branches of
  `api/store/stock/route.ts` into `lib/stock-availability.ts`
  (`blankAvailability`, `variantAvailability`); the route calls them with an
  identical response. Never use `card.inStock`.
- Columns (Meta): `id`; `title` = `<Design> - <Device> <Case type> Case` (Band
  for watch, Wallet for wallet; aim for 65 chars, max 200); `description` =
  plain text, design copy + case type description (NOT the device-page SEO
  template, which renders "case in our  finish"); `availability`; `condition
  new`; `price` = `1400.00 BDT` (the variant price); `link`; `image_link`,
  `additional_image_link` (2nd and 3rd JPEG); `brand Florayn`; `item_group_id`;
  `google_product_category`; `product_type` (`Phone Case > Signature`); `gender`
  from `metadata.audience` (women female, men male, both unisex);
  `internal_label sku:<sku>`; `custom_label_0` case type slug; `custom_label_1`
  device series; `custom_label_2` collection; `custom_label_3` audience;
  `custom_label_4` performance tier from `tracking_day_dim` (top-sellers-30d,
  trending-7d, new-30d) when data exists.
- TikTok uses the same rows with a column map (`sku_id` = id, etc.).
- Links (I10): case variants `<base>/product/<handle>-<deviceSlug>/?case=<caseTypeSlug>`,
  ALWAYS the root path (men's `/men/product/...` pages canonicalise to the
  root); regular products `<base>/product/<handle>/?variant=<id>`. Device slugs
  come from the device catalog exactly as the storefront builds them
  (`apps/storefront/src/lib/sitemap-urls.ts`, `lib/device-page.ts`); a fixture
  test asserts equality. `base` = `catalog.base_url`.
- Price guard: every case variant is cross-checked against the case-type price
  map; a mismatch adds a warning and excludes the item.

### 8.3 Images

Meta needs JPEG/PNG; renders are WebP on the rate-limited r2.dev host.
- `image_mode: "jpeg_copies"` (default): `lib/tracking/catalog-images.ts`
  `convertPending(container, { limit, concurrency: 2 })` loads `sharp` lazily
  (section 0.2; as built sharp is installed, and if it ever fails to load the
  job records "sharp is not installed" in `catalog:images` and returns). Each needed source becomes a 1200 px JPEG
  (`resize(1200, 1200, { fit: "inside" }).jpeg({ quality: 82, mozjpeg: true })`),
  uploaded with `r2Client()`/`r2Bucket()` (`lib/r2.ts`) to
  `feed-jpg/<sha1(source_url)>.jpg` with `Cache-Control: public,
  max-age=31536000, immutable`, recorded in `catalog_image`. `image_link` =
  `catalog.image_base_url` + `/` + key (`https://img.florayn.com/feed-jpg/...`).
  Paced at 150 per 15-min run by day and 600 at night (01:00-07:00 Dhaka).
  As built (19.10): `sharp.concurrency(1)` is set once per process and
  `convertPending` converts one image at a time (the `concurrency` option is
  accepted and ignored; the job and the Catalog route still pass 2). The JPEG
  is plain `.jpeg({ quality: 82 })`, no mozjpeg. Each run also has a budget,
  `imageRunBudget(now)`: by day 20 s inside sharp and 120 s wall time, 01:00-07:00
  Dhaka 120 s and 600 s; whichever of the count and the budget comes first. A
  run stopped by the budget writes `budget_hit: true` to `catalog:images`, and
  the next run carries on.
- `image_mode: "cf_transform"` (needs owner OK to enable Cloudflare Image
  Transformations): `image_link` =
  `https://img.florayn.com/cdn-cgi/image/format=jpeg,width=1200,quality=82/<source key>`;
  no conversion.
- Items without a ready image are left out and counted.

### 8.4 Feed route

`GET /feeds/:token/:file` (`api/feeds/[token]/[file]/route.ts`), `file` in
`meta.tsv`, `meta.tsv.gz`, `tiktok.tsv`, `tiktok.tsv.gz`. Token compared
timing-safe with `catalog_feed_token`; a bad token or file gives 404 and is NOT
logged (I24). Serves the stored published bytes (in-memory copy by etag) with
`ETag` / `If-None-Match` (304), `Content-Type: text/tab-separated-values;
charset=utf-8`; `.gz` serves the gzip bytes raw; `.tsv` serves gzip with
`Content-Encoding: gzip` when `Accept-Encoding` allows, else the inflated body.
Each valid fetch is logged to `catalog_feed_fetch`. Never builds on request.
As built: `.gz` files are sent as `Content-Type: application/gzip` (the raw
stored bytes, no Content-Encoding); `.tsv` adds `Cache-Control: private,
no-cache` and `Vary: Accept-Encoding`. A valid-token fetch before anything is
published answers 404 and is logged with status 404.

### 8.5 Build and publish

- `lib/storefront-events.ts` calls `markCatalogStale(container)` (sets
  `catalog:stale`) after a processed product/variant/option/stock batch: one
  import and one call, never throwing into the batch. As built (19.10): only
  for a batch with a product, variant, option or collection/category change.
  Stock-only batches (reservation and inventory-level events, which every order
  fires) no longer set it; the feed's availability after a pure stock change
  refreshes at the daily 03:30 Dhaka rebuild.
- The job rebuilds the feed when stale or at the daily forced rebuild (03:30
  Dhaka), only while `catalog.enabled`. It builds rows, serialises TSV and
  computes a `content_hash` of the rows; an unchanged hash marks the candidate
  `unchanged` and publishes nothing (I11: reservations flip stock often).
- Otherwise it writes the candidate, then publishes (copies to `published`)
  unless the item count dropped more than `shrink_guard_pct` against the last
  published build; then the candidate is `held` and the job writes
  `catalog:alert = { kind: "feed_guard", ... }`. A build exception writes
  `{ kind: "feed_error" }`. WP03's `checkAlerts` sends the emails (one path).
- Meta setup: Replace daily at 04:00 Dhaka + Update hourly. About 12 MB raw,
  0.4 MB gzip.

---

## 9. Live dashboard (Admin > Live, WP07)

Rollup (`lib/tracking/rollup.ts runRollup()`), under
`pg_try_advisory_xact_lock(hashtext('florayn-tracking-rollup'))`, one
transaction:
1. read `rollup:watermark.done_through`;
2. window `[done_through, date_trunc('minute', now() - interval '20 seconds'))`
   (hits use `clock_timestamp()` and ingest's statement timeout is 5 s, so no
   row lands in a closed window, I15);
3. aggregate `tracking_hit` into `tracking_minute`, recomputed and SET (reruns
   identical);
4. upsert `tracking_session` (least/greatest, bit-or flags, pageviews += n;
   source, campaign, landing path, device class, audience and new-visitor from
   the session's first hit) and `tracking_day_dim` (+= n) for dims product
   (handle), device, case_type, source, audience, device_class, landing;
5. advance the watermark; commit.

As built (19.3, WP07): primary ViewContent hits also give a derived
`ProductView` row in `tracking_minute` and `tracking_day_dim`; staff hits
(flag 8) are left out of both; hits without a source count under `unknown`;
the landing dim is the pathname of the session's first PageView; Purchase
rows for the product, device and case type dims come from the order's items
(so the catalog's top-sellers label works); a run covers at most 6 hours with
`statement_timeout` 120 s.

`GET /admin/tracking/live` ("today" = Asia/Dhaka midnight to now; the `host`
filter defaults to all hosts before cutover and to the live hosts once armed):
```json
{ "now": { "visitors_5m": 42, "visitors_30m": 180, "by_source": [{ "source": "meta_paid", "visitors": 20 }],
           "top_pages": [{ "path": "/product/x/", "visitors": 6 }] },
  "today": { "visitors": 5200, "sessions": 6100, "page_views": 21000, "product_views": 8000, "add_to_cart": 900,
             "initiate_checkout": 350, "web_purchases": 120, "revenue_web": 190000,
             "orders_all": 131, "orders_cancelled": 4, "revenue_all": 205000, "aov": 1565,
             "target": 300, "pace_projection": 290 },
  "yesterday_same_time": { "...": "same keys" },
  "funnel": { "vc_rate": 0.62, "atc_rate": 0.14, "ic_rate": 0.41, "purchase_rate": 0.38, "conversion": 0.02 },
  "spark": [{ "t": "2026-09-27T10:05:00+06:00", "pv": 120, "vc": 40, "atc": 6, "ic": 2, "p": 1 }],
  "tables": { "sources": [], "products": [], "devices": [], "case_types": [] },
  "recent": [{ "event": "AddToCart", "label": "Zebra Stark - iPhone 13 - Signature", "source": "meta_paid", "ago_s": 120 }],
  "health": { "outbox": {}, "jobs": {}, "rollup_lag_s": 30, "feed": {}, "variant_index": {}, "unknown_content_ids_today": 0 } }
```
As built (19.3, WP07): `health.outbox` is `outboxHealth()`'s array (one row per
platform/env/destination) and `health` adds `watermark`. The payload adds
`generated_at`, `day`, `filter`, `poll_seconds`, `errors[]` and labels.
`?host=` takes `''`, `all`, `test`, `live` or a listed host (else 400); orders
are store-wide. `aov` = revenue / non-cancelled orders.

Definitions:
- Live visitors: distinct `visitor_id` over non-internal browser hits in the
  last 5 / 30 min, from raw `tracking_hit`. No heartbeats.
- Today: closed-minute rollups plus the raw tail since the watermark (exact even
  if a job is lost); a lag over 2 min triggers `kickStaleJobs`.
- Orders (I8): today's orders via `query.graph({ entity: "order", fields: ["id",
  "total", "created_at", "canceled_at", "is_draft_order"], filters: { created_at:
  { $gte: dhakaMidnight } } })` (about 300 rows, inside the 10 s shared result),
  excluding drafts and imported orders (`order_op.source`); cancelled =
  `canceled_at` set or op status `cancelled`; revenue excludes cancelled.
  `web_purchases` = Purchase hits without the internal flag.
  As built (19.10): not `query.graph` with `total` (it hydrated every line,
  tax line and adjustment and re-totalled on the event loop that serves
  checkout). One SQL read of `"order"` left join `order_op`, drafts and deleted
  orders excluded, with the total = `order_summary.totals.current_order_total`
  of the latest summary version at or below `order.version` (null or not a
  number gives 0). The 7-day history is read once per Dhaka day; every 5
  minutes only its cancellations are re-read by id (`canceled_at` or op status
  `cancelled`, so an undone cancellation shows too).
- Pace: today's orders divided by the share of the last 7 days' orders placed by
  this time of day. Target = `dashboard.daily_order_target` (300).
- Product names resolved for the top 10 rows only. Unknown content ids = today's
  hits with flag 64.
- The health block uses WP03 `outboxHealth()` and WP01 `jobStates()`.

The page polls every `poll_seconds` only while visible (setInterval +
`visibilitychange`, the `florayn-import-drawer.tsx` pattern); the server shares
one result for 10 s (as built, 19.10: for `max(10 s, poll_seconds)`, so every
poll no longer misses it; Live reads the outbox counts through
`outboxHealth(container, { maxAgeMs: 60_000 })`, and today's unknown content
ids are cached 60 s per host filter). The spark chart is inline SVG, no chart library. The page
labels its definitions ("counts JS-running, non-bot visitors; ad-blocked
visitors appear only through the server Purchase"). 7d/30d tabs read
`tracking_day_dim` + `tracking_session`, cached 5 min. The page shows the staff
links from `/admin/tracking/staff-link` under "Exclude this browser".

---

## 10. Alerts (WP03, `lib/tracking/alerts.ts checkAlerts()`)

Sent with `sendEmail()` (`lib/send-email.ts`; needs `EMAILIT_API_KEY` and
`EMAIL_FROM` with a verified domain) to `alerts.email` (default
floraynweb@gmail.com), only when `alerts.enabled`. Each kind is throttled by
`alerts.repeat_hours` through `tracking_state alert:<kind> { last_sent_at, open
}`, and sends one recovery email when it clears. (As built: per-platform keys
and a richer state shape, 2.4 and 19.5.) Subjects are short and factual
("Florayn tracking: Meta token rejected (live)"); bodies carry counts and the
admin URL (`<MEDUSA_BACKEND_URL>/app/tracking/health`), never tokens or
customer data. `emailConfigured() === false` is a health warning, never a crash.
Other packages never email: they write state that `checkAlerts` reads.

| kind | Trigger |
|---|---|
| `token` | a row became `blocked` in the last hour (auth/permission class, or "no token" for an enabled platform) |
| `payload` | at least 10 `failed` rows in 1 h for a platform |
| `send_failures` | at least 50 `retry` rows older than 30 min for a platform |
| `checkout_without_tracking` (B10) | a platform is enabled and, in the last 60 min, a storefront order (`metadata.checkout_quote_version` set, `is_draft_order = false`, no `order_op.source`) older than 5 min has no `tracking_order_context`, or `checkout.header_rejected > 0` (as built, 19.10: counted only for a placed order) |
| `purchase_not_enqueued` (B10) | a trusted, non-staff, non-optout order context from the last 3 h, older than 10 min, has no Purchase row for an enabled platform (as built, 19.10: the lookup pins `platform in (<enabled>)`, so it is index-only probes on `tracking_event_key`, not a scan of the outbox every minute) |
| `edge_missing` | a platform is enabled and in the last hour `sf.untrusted >= 50` or `checkout.untrusted >= 1` (the Cloudflare header rule is missing or the secret differs) |
| `no_purchase` (I5) | only while `live_armed`; only between `active_from_hour` and `active_to_hour` Dhaka (10-24); zero Purchase hits from live hosts in the last `no_purchase_hours`; and the average for the same window over the last 14 days is at least 4.6 (so zero has under 1% chance) |
| `sweep_stale` | any job's `last_run_at` older than max(10 min, 3 x its `staleAfterMs`) |
| `rollup_lag` | watermark more than 10 min behind |
| `live_disarmed` | hits from a `live_hosts` host in the last hour while `live_armed` is off |
| `unknown_variants` | in the last hour at least 50 VC/ATC/IC hits and more than 20% flagged 64 (variant index stale or broken) |
| `feed_guard` / `feed_error` | `tracking_state catalog:alert` newer than the last alert of that kind |
| `feed_not_fetched` | catalog enabled, a feed published, no valid Meta fetch for 36 h |

---

## 11. Performance budget (WP00 gate, every storefront package)

Baseline measured live 2026-09-27: "First Load JS shared by all" = rootMainFiles
102,999 B gz (webpack 1,881 + 4bd1b696 54,359 + 1255 46,535 + main-app 224).
Root layout chunk 15,964 B gz plus a layout chunk group of about 15.4 kB. Local
build: product about 198 kB, checkout about 142 kB first load.

The gate (B7): `apps/storefront/scripts/check-client-budget.cjs --base <base .next>
--head <head .next>` compares two fixture builds made in the same CI job with the
same environment (the merge-base and the head). It reads `build-manifest.json`
(`rootMainFiles`) and `app-build-manifest.json` (`pages`), counts `.js` files
only, gzips each with zlib level 9, and unions the layout set into every page's
first-load set.

| Measure (gzip level 9, `.js` only) | Budget vs the merge-base build |
|---|---|
| framework rootMainFiles (every rootMainFile except `webpack-*.js`) | exactly +0 B |
| webpack runtime (`webpack-*.js`; its async chunk map gains one entry) | at most +64 B |
| `/layout` set (layout entry files not in rootMainFiles) | at most +1,200 B |
| `/page`, `/shop/page`, `/collection/[slug]/page` first load | at most the webpack + layout deltas + 32 B |
| `/product/[slug]/page` first load | at most the webpack + layout deltas + 300 B |
| `/checkout/page` first load | at most the webpack + layout deltas + 800 B |
| lazy runtime chunk (the chunk containing `fl-runtime-v1`) | at most 6,000 B gz, absolute |

The 32 B tolerance covers content-hash churn. Missing manifest keys are warnings,
not failures. The owner's rule "shared First Load JS must not grow" is kept as
"framework chunks +0 B"; the webpack runtime's +64 B is the unavoidable chunk-map
entry of any lazy import (the header rebuild added the same kind of entries).

Third-party scripts:
- Nothing from connect.facebook.net, analytics.tiktok.com or
  googletagmanager.com before `window.load`; normal pages wait `load` + 3 s +
  `requestIdleCallback`; `/checkout/` waits `load` + idle; a landing with a click
  id starts at `load`. `saveData` loads no runtime.
- fbevents and gtag are never preloaded or bundled.

Requests: `/api/t/id/` once per document at first idle; `/api/t/e/` batched at
2 s or 10 events, plus one `sendBeacon` on `pagehide`/hidden.

Server: `/api/t/e/` p95 under 20 ms (204 before forwarding); backend
`/tracking/ingest` p95 under 50 ms; outbox + rollup + feed CPU under 3% of one
vCPU on average.

As built (19.1): the first local measurement put the layout set at +1,724 B,
so the eager code was trimmed (5.1); the final local build is within every
limit. The id call and the beacon moved into a second lazy chunk (`boot.ts`,
1,609 B gzip), which adds a second chunk-map entry to the webpack runtime
(+38 B in total).

Must stay true: no hydration mismatch (the stub renders null; no module-top-level
`window`); `npm run perf:check -- --enforce` passes after deploy; Lighthouse
mobile product page LCP and TBT within noise (+-10%) of the pre-change run;
checkout INP measured before and after (I19); purge + warm after deploy, never
judge cold.

---

## 12. Privacy and consent

Collected: first-party visitor/session ids; IP (edge-trusted only) and UA; click
ids (fbclid via `_fbc`, ttclid, gclid/gbraid/wbraid); pages and product events;
at Purchase, hashes of phone, names, district and email (when given), computed
from the order, sent only while share is ON.

Goes to: Meta and TikTok (and Google on live hosts), and our Postgres (section 2
retention).

Rules:
- Dashboard tables never store IP, UA or contact data.
- Order context stores IP, UA and click ids for 90 days, only in module tables
  that no Store API returns.
- Outbox payloads are nulled on send and deleted after 8 days (14 for failed,
  blocked, skipped).
- Hashed contact details go to ad platforms, and hashed PII to the browser
  pixels, ONLY while `share_contact_hashes` is ON, which the server allows only
  with a non-empty consent text AND a published Privacy page (C7). Until then
  Purchase carries only external_id, ip, ua, fbp, fbc, country; expect Purchase
  EMQ below the 8.6 baseline in that state. As built (19.10): per order, only
  when that shopper was shown the consent line (the stored context carries a
  `consent_version`), so turning share ON adds nothing to older orders' COD
  events or reconciled Purchases.
- Meta Automatic Advanced Matching is OFF on the TEST dataset before the TEST
  pixel loads, and OFF on the live dataset before `live_armed` (decision 10,
  per-environment gate in 3.4).
- The consent line (Appendix B) renders under Place order next to
  `checkout-terms` only while share is ON, and links to `/privacy/`.
- Opt-out: `/api/t/optout/?on=1`, linked from the Privacy page ("Turn off ad
  measurement on this browser"). The browser then gets no pixels, `/api/t/e/`
  drops events, and a Purchase sends nothing to ad platforms (the dashboard
  counts it without ids).
- Google consent: Bangladesh is outside Google's EU consent policy. While share
  is OFF, `gtag("consent", "default", { ad_user_data: "denied" })` precedes
  config, so enhanced conversions stay off.
- The review token and private URLs never reach vendors (invariant 4).
  `/order/` never appears in `event_source_url`, `dl`, `page.url` or
  `page_location`. As built (19.10): nor as `document.referrer` (the private
  pages send `Referrer-Policy: no-referrer`), nor through a vendor call while
  `review` or `r` is in the address bar.
- As built (19.10): TikTok's Automatic advanced matching reads the checkout's
  phone and email fields like Meta's AAM, so the TikTok pixel waits for
  `spa_off_confirmed`, which now also confirms it is OFF in both pixels.

Doc changes (WP13, done 2026-09-27):
- CHECKOUT.md gains a "Tracking" section (header contract, the Purchase step
  never fails an order, `fl-<display_id>`, no `/order/` to vendors, consent line
  source). Its lines about agreement statements and "no customer details to
  analytics" are reworded ONLY after the owner approves the Privacy text and turns
  share ON; before that the new section states that share stays off.
- PERFORMANCE.md: the budget gate and the tracker loading rules; the "First Load
  JS shared by all must not grow" line is reworded to section 11's definition.
- DEPLOY.md: tracking migrations, env secrets, Cloudflare rules, deploy order,
  the stale Redis note fixed, backup exclusions.
- AGENTS.md: one line "Read TRACKING.md before changing ad tracking, `/api/t/*`,
  the tracking module, the Live dashboard, the Privacy page or the catalog feed."

---

## 13. Work packages, waves and file ownership

A package edits only the files listed for it (tests it creates included). Every
other file is read-only for it. "Stub map only" means the package may only
extend the `require` stub map in that test so the file it changed still loads.

| Wave | Package | Depends on | Summary |
|---|---|---|---|
| 1 | WP00 | none | Client JS budget gate + CI (budget job, scoped migration steps) |
| 1 | WP01 | none | Backend foundation: module, migration, settings, secrets, contract, jobs registry, settings admin, public config |
| 1 | WP02 | none | Backend pure libs: hashes, match keys, event ids, Meta/TikTok adapters |
| 1 | WP09 | none | Privacy page: content model, admin screen, store route, storefront page, draft text |
| 1 | WP14 | none | Storefront contract, paths, client queue, vector fixture |
| 2 | WP03 | WP01, WP02 | Outbox sender, alerts, health, outbox job, Health admin |
| 2 | WP08 | WP01 | Variant index, catalog feed, images, feed route, catalog job, Catalog admin |
| 2 | WP10 | WP00, WP14 | Storefront tracker stub, lazy runtime, pixel loaders, layout mount |
| 2 | WP11 | WP14 | Storefront `/api/t/*` endpoints and server helpers, checkout context headers |
| 3 | WP04 | WP01, WP02, WP03, WP08 | Backend ingest route + body-size middleware entry |
| 3 | WP05 | WP01, WP02, WP03 | Purchase capture workflow, order-events, reconcile job, isolated CI |
| 3 | WP07 | WP01, WP03 | Live dashboard: rollup, live/report/staff-link routes, Live admin |
| 3 | WP12 | WP10, WP11, WP14 | Storefront commerce events, Purchase hand-off, consent line |
| 4 | WP06 | WP05 | One status transition function + COD events |
| 5 | WP13 | all | Docs, as-built notes, final verification, QA runbook |

File ownership (paths from the repo root):

- **WP00**: `apps/storefront/scripts/check-client-budget.cjs`,
  `apps/storefront/tests/client-budget.test.cjs`,
  `.github/workflows/performance.yml`.
- **WP01**: `apps/backend/src/modules/tracking/index.ts`,
  `apps/backend/src/modules/tracking/service.ts`,
  `apps/backend/src/modules/tracking/models/tracking-settings.ts`,
  `apps/backend/src/modules/tracking/migrations/Migration20260928090000.ts`,
  `apps/backend/src/lib/tracking/settings.ts`,
  `apps/backend/src/lib/tracking/db.ts`,
  `apps/backend/src/lib/tracking/secret.ts`,
  `apps/backend/src/lib/tracking/contract.ts`,
  `apps/backend/src/lib/tracking/jobs.ts`,
  `apps/backend/src/workflows/update-tracking-settings.ts`,
  `apps/backend/src/api/admin/tracking/settings/route.ts`,
  `apps/backend/src/api/store/tracking-config/route.ts`,
  `apps/backend/src/admin/routes/tracking/page.tsx`,
  `apps/backend/src/scripts/migrate-tracking.ts`,
  `apps/backend/medusa-config.ts`, `apps/backend/.env.template`,
  `apps/backend/tests/tracking-settings.test.cjs`,
  `apps/backend/tests/tracking-db.test.cjs`,
  `apps/backend/tests/tracking-contract.test.cjs`,
  `apps/backend/tests/tracking-jobs.test.cjs`,
  `apps/backend/tests/fixtures/tracking-vectors.json`.
- **WP02**: `apps/backend/src/lib/tracking/hash.ts`,
  `apps/backend/src/lib/tracking/match-keys.ts`,
  `apps/backend/src/lib/tracking/event-ids.ts`,
  `apps/backend/src/lib/tracking/adapters/common.ts`,
  `apps/backend/src/lib/tracking/adapters/meta.ts`,
  `apps/backend/src/lib/tracking/adapters/tiktok.ts`,
  `apps/backend/tests/tracking-hash.test.cjs`,
  `apps/backend/tests/tracking-adapters.test.cjs`.
- **WP09**: `apps/backend/src/modules/content/models/privacy-setting.ts`,
  `apps/backend/src/modules/content/service.ts`,
  `apps/backend/src/modules/content/privacy-settings.ts`,
  `apps/backend/src/modules/content/privacy-draft.ts`,
  `apps/backend/src/modules/content/migrations/Migration20260928091000.ts`,
  `apps/backend/src/workflows/update-privacy-settings.ts`,
  `apps/backend/src/api/admin/privacy-settings/route.ts`,
  `apps/backend/src/api/store/privacy-settings/route.ts`,
  `apps/backend/src/admin/routes/privacy/page.tsx`,
  `apps/backend/src/scripts/migrate-privacy-settings.ts`,
  `apps/backend/tests/privacy-settings.test.cjs`,
  `apps/storefront/src/app/privacy/page.tsx`,
  `apps/storefront/src/lib/privacy.ts`,
  `apps/storefront/tests/privacy-page.test.cjs`.
- **WP14**: `apps/storefront/src/lib/tracking/paths.ts`,
  `apps/storefront/src/lib/tracking/contract.ts`,
  `apps/storefront/src/lib/tracking/queue.ts`,
  `apps/storefront/tests/fixtures/tracking-vectors.json`,
  `apps/storefront/tests/tracking-contract.test.cjs`,
  `apps/storefront/tests/tracking-queue.test.cjs`.
- **WP03**: `apps/backend/src/lib/tracking/outbox.ts`,
  `apps/backend/src/lib/tracking/alerts.ts`,
  `apps/backend/src/lib/tracking/health.ts`,
  `apps/backend/src/jobs/tracking-outbox.ts`,
  `apps/backend/src/api/admin/tracking/health/route.ts`,
  `apps/backend/src/api/admin/tracking/retry/route.ts`,
  `apps/backend/src/api/admin/tracking/test-alert/route.ts`,
  `apps/backend/src/api/admin/tracking/test-event/route.ts`,
  `apps/backend/src/admin/routes/tracking/health/page.tsx`,
  `apps/backend/tests/tracking-outbox.test.cjs`,
  `apps/backend/tests/tracking-alerts.test.cjs`.
- **WP08**: `apps/backend/src/lib/tracking/variant-index.ts`,
  `apps/backend/src/lib/tracking/catalog-feed.ts`,
  `apps/backend/src/lib/tracking/catalog-images.ts`,
  `apps/backend/src/lib/stock-availability.ts`,
  `apps/backend/src/api/store/stock/route.ts`,
  `apps/backend/src/jobs/catalog-feed.ts`,
  `apps/backend/src/api/feeds/[token]/[file]/route.ts`,
  `apps/backend/src/api/admin/tracking/catalog/route.ts`,
  `apps/backend/src/admin/routes/tracking/catalog/page.tsx`,
  `apps/backend/src/lib/storefront-events.ts`,
  `apps/backend/tests/storefront-events.test.cjs` (stub map only),
  `apps/backend/tests/product-manager.test.cjs` (stub map only),
  `apps/backend/tests/catalog-feed.test.cjs`,
  `apps/backend/tests/variant-index.test.cjs`.
- **WP10**: `apps/storefront/src/components/tracking/tracker-stub.tsx`,
  `apps/storefront/src/lib/tracking/runtime.ts`,
  `apps/storefront/src/lib/tracking/pixels/meta.ts`,
  `apps/storefront/src/lib/tracking/pixels/tiktok.ts`,
  `apps/storefront/src/lib/tracking/pixels/google.ts`,
  `apps/storefront/src/app/layout.tsx`,
  `apps/storefront/tests/tracking-stub.test.cjs`,
  `apps/storefront/tests/tracking-runtime.test.cjs`.
- **WP11**: `apps/storefront/src/app/api/t/id/route.ts`,
  `apps/storefront/src/app/api/t/e/route.ts`,
  `apps/storefront/src/app/api/t/staff/route.ts`,
  `apps/storefront/src/app/api/t/optout/route.ts`,
  `apps/storefront/src/lib/tracking/server/guard.ts`,
  `apps/storefront/src/lib/tracking/server/keys.ts`,
  `apps/storefront/src/lib/tracking/server/request-context.ts`,
  `apps/storefront/src/lib/tracking/server/cookies.ts`,
  `apps/storefront/src/lib/tracking/server/rate-limit.ts`,
  `apps/storefront/src/lib/tracking/server/forward.ts`,
  `apps/storefront/src/lib/tracking/server/config.ts`,
  `apps/storefront/src/lib/tracking/server/source.ts`,
  `apps/storefront/src/lib/tracking/server/bots.ts`,
  `apps/storefront/src/lib/tracking/server/checkout-context.ts`,
  `apps/storefront/.env.template`,
  `apps/storefront/tests/tracking-endpoints.test.cjs`,
  `apps/storefront/tests/tracking-server.test.cjs`,
  `apps/storefront/tests/tracking-source.test.cjs`.
- **WP04**: `apps/backend/src/api/tracking/ingest/route.ts`,
  `apps/backend/src/lib/tracking/ingest.ts`,
  `apps/backend/src/api/middlewares.ts` (one new route entry only),
  `apps/backend/tests/tracking-ingest.test.cjs`.
- **WP05**: `apps/backend/src/api/store/checkout/route.ts`,
  `apps/backend/src/workflows/checkout.ts`,
  `apps/backend/src/lib/tracking/checkout-context.ts`,
  `apps/backend/src/lib/tracking/order-events.ts`,
  `apps/backend/src/lib/tracking/purchase.ts`,
  `apps/backend/src/jobs/tracking-reconcile.ts`,
  `apps/backend/src/scripts/verify-checkout-isolated.ts`,
  `apps/backend/tests/tracking-purchase.test.cjs`,
  `apps/backend/tests/checkout.test.cjs` (stub map only).
- **WP07**: `apps/backend/src/lib/tracking/rollup.ts`,
  `apps/backend/src/lib/tracking/live.ts`,
  `apps/backend/src/jobs/tracking-rollup.ts`,
  `apps/backend/src/api/admin/tracking/live/route.ts`,
  `apps/backend/src/api/admin/tracking/report/route.ts`,
  `apps/backend/src/api/admin/tracking/staff-link/route.ts`,
  `apps/backend/src/admin/routes/live/page.tsx`,
  `apps/backend/src/admin/components/tracking/live-spark.tsx`,
  `apps/backend/src/admin/components/tracking/live-tables.tsx`,
  `apps/backend/tests/tracking-rollup.test.cjs`,
  `apps/backend/tests/tracking-live.test.cjs`.
- **WP12**: `apps/storefront/src/components/product-view.tsx`,
  `apps/storefront/src/components/cart-provider.tsx`,
  `apps/storefront/src/components/checkout-form.tsx`,
  `apps/storefront/src/lib/checkout-form-data.ts`,
  `apps/storefront/src/app/checkout/page.tsx`,
  `apps/storefront/src/lib/cart.ts`, `apps/storefront/src/lib/checkout.ts`,
  `apps/storefront/tests/checkout-data.test.cjs`,
  `apps/storefront/tests/product-data.test.cjs` (stub map only),
  `apps/storefront/tests/product-view-case-param.test.cjs` (stub map only),
  `apps/storefront/tests/tracking-commerce-events.test.cjs`.
- **WP06**: `apps/backend/src/lib/order-status.ts`,
  `apps/backend/src/lib/order-ops.ts` (remove `setWorkflowStatus` only),
  `apps/backend/src/lib/tracking/status-events.ts`,
  `apps/backend/src/api/admin/order-ops/status/route.ts`,
  `apps/backend/src/api/admin/courier/send/route.ts`,
  `apps/backend/src/api/admin/courier/sync/route.ts`,
  `apps/backend/src/api/webhooks/steadfast/route.ts`,
  `apps/backend/tests/order-status.test.cjs`,
  `apps/backend/tests/tracking-status-events.test.cjs`.
- **WP13**: `TRACKING.md`, `AGENTS.md`, `CHECKOUT.md`, `PERFORMANCE.md`,
  `DEPLOY.md`, `apps/backend/tests/tracking-vectors-sync.test.cjs`.

Nobody edits `package.json`, a lockfile, `next.config.ts`, a `middleware.ts`,
`lib/revalidation.ts`, `lib/storefront-write-domains.ts`, `lib/florayn-import.ts`,
`workflows/checkout-service.ts` or `api/store/checkout/quote/route.ts`.

---

## 14. Test plan

Backend (`cd apps/backend && node --test tests/<file>.cjs`; each test
transpiles one source file with `typescript.transpileModule` and runs it in a
`vm` sandbox with a stub map, like `tests/steadfast.test.cjs`):
- WP01 `tracking-settings.test.cjs` (defaults = 3.1, every validation rule,
  share gate incl. unpublished privacy, `present()` never returns a token, blank
  keeps / `__remove__` clears, `hostRole` + `destinationFor` against the vector
  fixture, `publicConfig` has no `token`/`email`); `tracking-db.test.cjs` (fake
  knex: ON CONFLICT shapes, counter upsert, state upsert);
  `tracking-contract.test.cjs` (vector fixture: private paths, safe paths,
  event ids, events, keys incl. derived keys and fail-closed verification);
  `tracking-jobs.test.cjs` (runTrackingJob state writes, never throws,
  overlapping run skipped, kickStaleJobs runs only stale registered jobs, at most
  once per minute). `migration-names.test.cjs` still passes.
- WP02 `tracking-hash.test.cjs` (Appendix C hashes), `tracking-adapters.test.cjs`
  (payload snapshots for every event; test_event_code only for test; no
  `/order/` anywhere; Purchase URL is `/checkout/`; COD `system_generated` +
  `original_event_data`; TikTok never gets PageView or COD; IP suffix stripped for
  TikTok; suffixed hashes rejected; classification table row by row; the token
  never appears in an error or message).
- WP03 `tracking-outbox.test.cjs` (claim SQL shape, reclaim of stale sending,
  expiry at 6.5 d, grouping, backoff schedule, split on payload error, dry run
  with zero fetches, token-fingerprint requeue, debounce coalescing, retention
  statements), `tracking-alerts.test.cjs` (each kind: trigger, throttle,
  recovery, disabled, email not configured).
- WP04 `tracking-ingest.test.cjs` (401 bad/unset key, previous key accepted, 400
  envelope, 413 via the middleware entry, unknown host dropped, Purchase and
  private paths rejected, price replacement and value clamp, unknown variant
  flag 64 + counter + no rows, staff hits flagged and no rows, rows per 6.1, one
  transaction, 202 before any vendor call, a 64 KB batch accepted end to end,
  resend creates no duplicates).
- WP05 `tracking-purchase.test.cjs` (decodeTrackingHeader limits and never
  reading the body; steps return StepResponse and never throw; record only on
  200 with an order; same `fl-N` block on retries; one transaction with a
  failure injected between inserts leaves nothing half-written and reconcile (a)
  recovers it; untrusted/staff/optout give no ad rows; disabled platform gives a
  `skipped` row; missing token gives `blocked`; share OFF gives external_id only;
  `checkoutWorkflow` shape unchanged and the quote route untouched; reconcile
  a/b/c; imported and draft orders skipped).
- WP06 `order-status.test.cjs` (one `updateOrderOps`, `status_changed_at` only on
  change, events only for changed non-imported rows, an enqueue error never fails
  the update, the static writer scan), `tracking-status-events.test.cjs`
  (`statusEventsFor` table, skips, once-only by key, Meta payload shape).
- WP07 `tracking-rollup.test.cjs`, `tracking-live.test.cjs` (window math, Dhaka
  boundaries, SET idempotence, raw-tail merge without double counting, pace,
  orders exclude drafts/imported, 10 s shared cache, staff-link HMAC = vectors).
- WP08 `catalog-feed.test.cjs`, `variant-index.test.cjs` (rows from fixture
  products, root links, slugs equal the storefront helpers, availability equals
  `/store/stock`, Alcantara excluded by default, price-mismatch exclusion, image
  skip, TSV escaping, content-hash skip, shrink guard writes `catalog:alert`,
  TikTok column map, feed route 404/ETag/304/gzip and valid-only fetch logging,
  sharp missing reported not thrown).
- WP09 `privacy-settings.test.cjs`.
- WP13 `tracking-vectors-sync.test.cjs` (the two fixture copies are identical).
- CI isolated job (`verify-checkout-isolated.ts`, extended by WP05): TEST dataset
  id + fake token for `new.florayn.com`, `TRACKING_DRY_RUN=1` set inside the
  script, two simultaneous submits plus a retry with a trusted context; exactly
  one order, one `tracking_order_context`, one Purchase hit, one Meta Purchase
  row (`pending`) and one TikTok Purchase row (`skipped`, TikTok is off), the same `tracking.event_id` in every 200 response, a flush marks it
  `dry_run`; the pre-existing assertions stay untouched.

Storefront (`cd apps/storefront && node --test tests/<file>.cjs`):
- WP00 `client-budget.test.cjs` (fake manifests: framework/webpack/layout/page
  math, `.js` only, union, marker chunk detection, failure messages).
- WP14 `tracking-contract.test.cjs`, `tracking-queue.test.cjs` (SSR-safe import,
  private path no-op, `p` recorded at call time, uuid fallback shape, Purchase
  pushed with `s: 1` and `wake` called synchronously, `takeUnsent` /
  `restoreUnsent`, queue imports only types from contract).
- WP10 `tracking-stub.test.cjs` (renders null; PageView per pathname with
  `first`; StrictMode once; private path nothing; id call at idle with the
  landing snapshot; beacon on pagehide as `text/plain`; runtime import timing per
  5.1 and never when `on` is false or `saveData`; `import()` via `retryImport`,
  no `next/dynamic`, `<Script>`, `useSearchParams`; layout has no
  `next/headers`), `tracking-runtime.test.cjs` (fake window/document: scrub
  before any script, `disablePushState` before insertion, autoConfig false, init
  without data, no vendor call before `onload`, pathname-equality rule, private
  path blocks injection, Purchase re-init only then, `share` controls match
  data, gtag consent default and `page_location`, batching 2 s / 10 with `rv`,
  optout/staff load nothing, sessionStorage guard in try/catch).
- WP11 `tracking-endpoints.test.cjs`, `tracking-server.test.cjs`,
  `tracking-source.test.cjs` (route handlers with stubbed `next/server`,
  `next/headers`, `capi-param-builder-nodejs`: 403 origin, 204 bot, 413 sizes,
  inert without edge (no Set-Cookie), unknown host inert, cookie table
  attributes host-only vs live Domain, ParamBuilder fed a `PlainDataObject` and
  only `_fbp`/`_fbc` taken, rate limits, clock fix, forward envelope and
  splitting, cap counter, 204 before forward, staff/optout routes, keys against
  vectors, `hostRole`/`pixelsFor` against vectors, source vectors,
  `checkoutTrackingHeaders` from headers/cookies only, no client component
  imports `lib/tracking/server/`).
- WP12 `tracking-commerce-events.test.cjs` + updated `checkout-data.test.cjs`
  and stub maps.
- WP09 `privacy-page.test.cjs`. `header-markup.test.cjs` must still pass.

Type-check: `npx tsc --noEmit -p apps/backend` and `-p apps/storefront`.
Build gates (CI only; agents never run builds): `npm --prefix apps/backend run
build` (medusa lint), the storefront fixture build, the client-budget job.

---

## 15. QA plan (new.florayn.com, TEST destinations only)

Preconditions: migrations applied; env secrets set; Cloudflare rules of section
16 live for new.florayn.com; Meta TEST token pasted, test event code set, Meta
enabled, TEST AAM OFF in Events Manager and ticked in admin; variant index built;
Meta Test Events tab open; DevTools Network filtered to
`facebook.com/tr|connect.facebook|analytics.tiktok|googleadservices|googletagmanager|/api/t/`.
Five TEST ORDERs are approved (decision 4): name "TEST ORDER", cancelled
afterwards.

1. Inert without edge: `curl --resolve new.florayn.com:443:157.245.202.205` with
   a browser user agent (I22) and a forged `cf-connecting-ip` to `/api/t/id/`
   gives `on: false` and no `Set-Cookie`; `/api/t/e/` forwards nothing.
2. Fresh profile, land on `/product/<x>/?case=signature&fbclid=TEST123`:
   `/api/t/id/` at first idle sets `_fl_vid`, `_fl_sid`, `_fl_src`, `_fbp`,
   `_fbc` host-only; fbevents requested only after load + 3 s + idle; PageView
   and ViewContent show browser + server "Deduplicated"; the ViewContent
   content_id is the `?case` variant.
3. Client-navigate to another product: one server PageView, no browser PageView.
4. Add to cart (single, pack, quick-add): AddToCart ids, quantities, values
   (server-replaced prices).
5. Checkout: InitiateCheckout once; reload: same `ic-` id, still one. (As
   built, 19.10: reopening it in a later session sends the same `ic-` id to the
   platforms, and the dashboard records that session's IC too.)
6. TEST ORDER 1: the browser Purchase fires before the URL changes; no request
   contains `/order/`; the server Purchase `fl-<n>` shows deduplicated; with
   share OFF the only `ud[` parameter on a `facebook.com/tr` request from
   `/checkout/` is `ud[external_id]` (the SHA-256 of `_fl_vid`, never a contact
   hash) (B4); Admin > Live shows it.
7. TEST ORDER 2 (B3): DevTools Slow 3G, fresh load of `/checkout/` with a bag,
   submit within 2 s of load: no request anywhere contains `/order/`; the
   Purchase arrives server-only.
8. TEST ORDER 3: kill the network during submit, then retry: one order, one
   Purchase in Test Events and `tracking_event`.
9. `/review/<token>` on a product with reviews disabled: the token leaves the
   address bar before any vendor script; no vendor request contains `review=`.
10. Ad blocker on: no browser copies; server copies still arrive; the dashboard
    still counts.
11. TEST ORDER 4: Admin > Live > Exclude this browser, then order: no ad rows,
    dashboard marks it internal, no pixels load.
12. Order Manager with TEST ORDER 1: processing -> confirmed -> shipped ->
    delivered gives OrderConfirmed and Delivered once each (custom,
    system_generated); back and forth gives no repeats; cancelled sends nothing.
13. Catalog (after sharp or cf_transform): Admin > Tracking > Catalog shows items,
    warnings, image progress; Commerce Manager test catalog fetches the URL;
    diagnostics show no price/image errors; the Events tab match rate is at least
    90% after 24 h.
14. Speed: CI client-budget job green; `npm run perf:check -- --enforce`;
    Lighthouse mobile product page before/after; checkout INP before/after;
    DevTools shows no third-party request before `load`.
15. Alerts: "Send test alert" arrives at floraynweb@gmail.com; a wrong TEST token
    gives blocked rows + a `token` email; the right token requeues within 2 min.
16. TEST ORDER 5, only after the owner approves Appendix A/B, publishes Privacy
    and turns share ON: Purchase carries ph/fn/ln/ct/em hashes (server) and the
    consent line shows; then every TEST ORDER is set to cancelled.
17. TikTok (later, once a TikTok test pixel and token exist): repeat 2-8 for
    TikTok with `ads_only` via `?ttclid=TEST`; confirm no `analytics.tiktok.com`
    request contains `/order/` before ticking `spa_off_confirmed` for real use.
    As built (19.10): also confirm, with share OFF, that no TikTok request from
    `/checkout/` carries a hashed email or phone (Automatic advanced matching
    OFF in both pixels, owner step C).
18. As built (19.10): after TEST ORDER 1, open its review link, tap a product:
    no vendor request and no `Referer` carries `review=` or `/review/`.
    `/order/`, `/review/` and `/account/` answer `Referrer-Policy: no-referrer`.

---

## 16. Deploy order and infra steps (each needs the owner's OK)

Code is safe with none of these done: tracking stays inert (invariant 8).
1. Env on Coolify (never in chat or git): backend `TRACKING_INGEST_SECRET`
   (and `TRACKING_INGEST_SECRET_PREVIOUS` only while rotating); storefront
   `TRACKING_INGEST_SECRET` (same value) and `TRACKING_EDGE_SECRET`.
2. Cloudflare, host `new.florayn.com` (later also `florayn.com`, `www`):
   (a) cache rule: URI path starts with `/api/t/` gives Bypass cache;
   (b) Transform Rule (modify request header): set `x-florayn-edge` to
   `TRACKING_EDGE_SECRET` on all requests to that host;
   (c) no bot challenge on `/api/t/`;
   (d) optional free rate-limit rule on `/api/t/` above 60 requests per 10 s per
   IP. Confirm the existing click-id cache-key Transform Rule leaves the browser
   URL intact. As built (19.10): (d) is REQUIRED and saved before (b) switches
   tracking on. Free plan: expression
   `(starts_with(http.request.uri.path, "/api/t/"))` (Path only, no Host, one
   rule per zone), characteristics IP, 60 requests per 10 s, Block for 10 s.
   DEPLOY.md "Ad tracking runbook" step 2 has the clicks and step 7 the check.
3. Origin firewall (443 to Cloudflare ranges only): NOTE `api.new.florayn.com`
   is not proxied and shares the origin's 443, so this needs that host proxied
   first (or an allowlist for the storefront's own egress and admin users).
   Until then the edge header alone protects ad sends.
4. `sharp`: operator runs `cd apps/backend && npm install sharp`, commits the
   root lockfile change (only needed for `image_mode: "jpeg_copies"`). As
   built: DONE (`sharp@0.34.5`, commit f65dd96); the image mode is the
   owner's choice in Admin > Tracking > Catalog.
5. Migrations over the SSH tunnel, BEFORE the backend deploy:
   `npx medusa exec ./src/scripts/migrate-tracking.ts` (preflight) then
   `... apply Migration20260928090000`; `migrate-privacy-settings.ts` then
   `... apply Migration20260928091000`.
6. Commit and push, deploy the backend, then the storefront (Coolify builds the
   pushed commit), then purge + warm (storefront speed rules).
7. Verify with a browser user agent: `/api/t/id/` 200 `private, no-store` and
   `on: true` only through Cloudflare; `/store/tracking-config`;
   `/feeds/<token>/meta.tsv` 200 then 304; admin Tracking, Health, Catalog, Live
   and Privacy pages load; jobs show fresh runs. As built (19.10): the
   rate-limit check of DEPLOY.md step 7 answers 429 after about 60 calls.
8. Backups: `pg_dump --exclude-table-data=tracking_hit
   --exclude-table-data=tracking_event`.

---

## 17. Owner steps (plain language)

Never paste a token in chat. Paste it only into Admin > Tracking.

**A. Meta TEST dataset (2247389409441720), now**
1. Events Manager > the TEST dataset > Settings > Conversions API > "Generate
   access token" (needs developer access). Paste it into Admin > Tracking > Meta
   > "Test token". Save.
2. Settings: turn Automatic advanced matching OFF. Traffic permissions: allow
   `new.florayn.com`. Never use this dataset in a campaign.
3. Test events tab: copy the test code (TEST...) into "Test event code".
4. In Admin > Tracking tick "Automatic Advanced Matching is OFF on the TEST
   dataset", turn Meta on, save.

**B. Meta live dataset (650439547920083)**
1. Generate its Conversions API token the same way and paste it into "Live
   token". It is unused until florayn.com points at the new shop and "Allow live
   sending" is on.
2. On cutover day, before "Allow live sending": turn its Automatic advanced
   matching OFF and tick the live checkbox.

**C. TikTok (later)**
1. Tools > Events > Web events > create a Manual pixel named `Florayn TEST`;
   paste its id into "Test pixel ID"; Settings > Events API > Generate Access
   Token > "Test token". Do the same token step for the live pixel
   `D9ODDBJC77U97D5Q7MQG` ("Live token").
2. In both pixels: First-party cookies ON; automatic events OFF; single-page app
   (history) page views OFF. Then tick "SPA page views and automatic events are
   OFF" and turn TikTok on. As built (19.10): also turn Automatic advanced
   matching OFF in both pixels (it reads the checkout's phone and email); the
   checkbox now reads "SPA page views, automatic events and automatic advanced
   matching are OFF in both pixels".

**D. Google Ads (at cutover)**
Goals > Conversions > Settings: Enhanced conversions for web ON (Google tag),
accept the customer data terms; the purchase action (label
0p0wCKu2w70cEMvvms1D) uses "different values" and Count "Every"; auto-tagging
ON. Google stays off on new.florayn.com by design.

**E. Catalog**
1. Approve either installing `sharp` (JPEG copies on img.florayn.com) or turning
   on Cloudflare Image Transformations, then set the image mode in Admin >
   Tracking > Catalog, enable the catalog and wait for images to be ready.
   (As built: `sharp` is installed, so JPEG copies, the default, need no
   further approval; Image Transformations remain the alternative.)
2. Commerce Manager > Add catalog > E-commerce > name `Florayn Shop` > Data
   sources > Data feed > "Use a URL": paste the Meta feed URL; currency BDT;
   Replace daily at 04:00 Dhaka plus an hourly Update.
3. Connect the catalog to the TEST dataset only, for now. Build product sets
   from the custom labels.

**F. Privacy and consent**
Admin > Privacy: start from the suggested draft (Appendix A), correct it,
Publish. Then Admin > Tracking > Privacy: use or edit the suggested sentence
(Appendix B), save, and turn "Share hashed contact details" ON. Only orders
placed after that (whose shoppers saw the sentence) get hashed contact
details; see 19.10 for one caution about orders placed before these fixes.

**G. Ad URLs**
- Meta URL parameters: `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}`
- TikTok: `utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__`
- Google final URL suffix: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`

**H. Staff browsers**
On every phone or PC staff use to order on the website: Admin > Live > "Exclude
this browser", once per host (new.florayn.com now, florayn.com after cutover).

**I. Infra approvals** (section 16): env secrets, the Cloudflare rules, the
origin firewall plan, `sharp` or Image Transformations.

---

## 18. Cutover checklist

Baseline to protect: Meta Purchase EMQ 8.6, other events about 6.1; 62-69
Purchases a week; browser:server Purchase about 1:1.

T-7 days (TEST destinations):
- [ ] Test Events shows every event browser+server deduplicated; Purchase EMQ at
      least 8.0 with share ON, others at least 6.0.
- [ ] TEST catalog match rate at least 90%.
- [ ] Alerts arrive; the CI budget job is green.

T-1 day:
- [ ] Live tokens pasted (Meta; TikTok when ready); `live_hosts` = florayn.com,
      www.florayn.com; Google enabled.
- [ ] Owner confirms the WordPress plan: PixelFly, the Woo pixel and
      GTM-M5LBZFGL go off at the moment of cutover (owner does it; we never write
      there).
- [ ] Cloudflare rules of section 16 prepared for florayn.com and www
      (including the edge header).

Cutover:
- [ ] DNS/proxy switches florayn.com to the new storefront.
- [ ] Live dataset AAM OFF in Events Manager, then tick the live checkbox.
- [ ] Turn "Allow live sending" (`live_armed`) ON.
- [ ] `/api/t/id/` on florayn.com returns `env: "live"`, cookies carry
      `Domain=florayn.com`, existing PixelFly `_fbp`/`_fbc` are kept.
- [ ] Temporary test code on the LIVE dataset shows PageView/VC/ATC, then remove
      it; one real test order (then cancelled) confirms Purchase; Google Ads
      conversion diagnostics see it; `_gcl_aw` is read by gtag (else remove
      that cookie).
- [ ] Catalog base URL = https://florayn.com, Rebuild; connect Florayn Shop to
      650439547920083; disconnect the old catalog 1643298616640045 and any
      pixel-based catalog updates.
- [ ] If the backend moves to `api.florayn.com`, update the feed URLs.
- [ ] Staff exclude their browsers on florayn.com.
- [ ] Purge and warm.

72 hours after: every 24 h compare Events Manager Purchases with storefront
orders (+-5%), the server:browser Purchase ratio (0.8-1.2), EMQ and
Diagnostics; "unknown content ids" near 0. Rollback lever: switch a platform
off in Admin > Tracking (effective within 10 s of the settings cache; later
Purchases become `skipped`, and sending them later is an explicit Retry).

---

## 19. As-built notes

Recorded by WP13 on 2026-09-27, branch `product-shop-ui-merge`. Waves 1-3 are
commits f65dd96, c4a7d21 and da59005. WP06, the budget trim and WP13 were in
the working tree, not yet committed, when this was written. Nothing ran
against production: no deploy, no migration, no QA order.

### 19.1 Verification (2026-09-27)

| Check | Result |
|---|---|
| `cd apps/backend && npm test` | 503 tests, 503 pass, 0 fail (9.5 s); 500 before WP13, plus the 3 in `tracking-vectors-sync.test.cjs` |
| `cd apps/storefront && npm test` | 487 tests, 487 pass, 0 fail (7.9 s) |
| `npx tsc --noEmit -p apps/backend` | exit 0, no errors |
| `npx tsc --noEmit -p apps/storefront` | exit 0, no errors |
| `npx eslint apps/backend/src` (repo root) | exit 0: 0 errors, 188 warnings; no `@medusajs` error |
| `cd apps/backend && npx medusa build` | exit 0, run twice (the second after the last admin edit, 42 s): types generated, `medusa lint` 0 errors and 188 warnings, backend and admin compiled (all five tracking admin pages) |
| Storefront production build | exit 0, fixture API on `http://127.0.0.1:9931` (the budget trim's build at 14:36; no storefront source changed after it) |
| `node apps/storefront/scripts/check-client-budget.cjs --base <build of df87006> --head apps/storefront/.next` | exit 0, "Within budget." (table below) |
| `cd apps/backend && node --test tests/tracking-vectors-sync.test.cjs` | 3 of 3 pass: both fixture copies byte-identical and equal to the last json block of this file |

The 188 lint warnings are the same count as the last build before tracking
(2026-09-25). None is in a file tracking created; the only one in a file it
touched is the older `throw new Error` at `lib/storefront-events.ts:111`.

Client JS budget, local (gzip level 9, `.js` only; base = a build of df87006,
the commit before tracking; head = the final working tree):

| measure | base | head | delta | limit |
|---|---|---|---|---|
| framework (rootMainFiles) | 100,883 | 100,883 | 0 | = 0 |
| webpack runtime | 1,918 | 1,956 | +38 | <= 64 |
| `/layout` set | 31,404 | 32,114 | +710 | <= 1,200 |
| `/page` | 139,421 | 140,169 | +748 | <= 780 |
| `/shop/page` | 186,465 | 187,213 | +748 | <= 780 |
| `/collection/[slug]/page` | 136,198 | 136,946 | +748 | <= 780 |
| `/product/[slug]/page` | 202,805 | 203,776 | +971 | <= 1,048 |
| `/checkout/page` | 144,988 | 146,376 | +1,388 | <= 1,548 |
| lazy runtime chunk (`fl-runtime-v1`, chunk 706) | - | 2,679 | - | <= 6,000 |

The lazy `boot.ts` chunk is 1,609 B gzip and is in no first-load set. Before
the trim the same build measured `/layout` +1,724 (over) and `/checkout/page`
+2,857 (over its 2,543 limit).

Static audits (2026-09-27), all pass:
- No `"use client"` module, or anything it imports, reaches
  `lib/tracking/server/` (storefront test "no "use client" module, or anything
  it imports, reaches lib/tracking/server/", plus a direct grep). `lib/cart.ts`
  is a `"use server"` module: the client gets only action references from it,
  so the scanner does not follow its imports.
- The eager path (the stub, `cart-provider`, `checkout-form`, `product-view`)
  reaches only `lib/tracking/queue.ts` and `paths.ts`; `fl-runtime-v1` exists
  only in `runtime.ts`.
- No `NEXT_PUBLIC_` variable holds a tracking value: the secrets are read only
  in `lib/tracking/server/keys.ts` (storefront) and `lib/tracking/secret.ts`
  (backend), and both `.env.template` files name them as server-only.
- `apps/storefront/src/app/layout.tsx` has no `next/headers`, `cookies(` or
  `searchParams`.
- No tracking file logs a request body, a header value or a token. The only
  log lines are the ingest route (`[tracking] ingest failed: <pg code or error
  name>`), `purchase.ts` and `order-status.ts` (a short reason made of the
  error name and code only). Adapter messages pass through `redact()`.
- Every sidebar admin page imports an icon that exists in `@medusajs/icons`:
  Tracking `Target`, Live `ChartActivity`, Privacy `ShieldCheck`; Health and
  Catalog export no config.
- Every path listed in section 13 exists (161 paths). The files section 13
  says nobody edits (`next.config.ts`, `lib/revalidation.ts`,
  `lib/storefront-write-domains.ts`, `lib/florayn-import.ts`,
  `workflows/checkout-service.ts`, `api/store/checkout/quote/route.ts`) have no
  diff against df87006, and there is no `middleware.ts`. (Later, 19.10:
  `next.config.ts` gained `headers()` for the private pages' `Referrer-Policy`;
  everything else in it is unchanged and pinned by a test.)
- No `package.json` or lockfile differs from HEAD. Across the tracking commits
  the only manifest changes are the two approved dependencies (19.4).
- `workflow_status` is written only by `lib/order-status.ts`, the initial
  rows in `lib/order-ops.ts` and the florayn.com import (backend test "no file
  writes workflow_status except ...").

### 19.2 Final file list against section 13

- New, not in section 13 (budget trim): `apps/storefront/src/lib/tracking/batch.ts`
  and `apps/storefront/src/lib/tracking/boot.ts`.
- Dependency step before wave 1 (approved): `apps/backend/package.json` and
  the root `package-lock.json` (`sharp`), `apps/storefront/package.json` and its
  lockfile (`capi-param-builder-nodejs`).
- `apps/backend/src/admin/routes/tracking/health/page.tsx` (WP03's file): WP13
  added labels for the two counters WP04 introduced.
- Test stub maps only, as section 13 allows: `tests/checkout.test.cjs`,
  `storefront-events.test.cjs`, `product-manager.test.cjs` (backend);
  `product-data.test.cjs`, `product-view-case-param.test.cjs` (storefront).
- Everything else matches section 13, file for file.
- Not tracking code: the untracked Node compile-cache folder under
  `apps/backend/` (from 2026-09-14) and `.claude/`. Keep both out of commits.

### 19.3 Deviations by package, with reasons

Each item is what the code does where the spec was silent or said otherwise.

**WP00 (budget gate, CI).**
- For a push the base build is the previous branch tip (`github.event.before`,
  else `HEAD~1`); only a pull request uses a true merge-base. Why: a push has
  no base branch to merge against.
- The framework rule is exactly 0 in both directions (a shrink fails). A
  Next.js or React upgrade needs a deliberate override.
- Event values reach the CI shell through env vars, not inline `${{ }}`, to
  keep them out of the script text. `--help`, exit 2 for bad arguments or
  manifests; rows carry `rule`, `skipped` and `note` display fields.
- The checkout-integration job keeps `timeout-minutes: 20` (existing lines
  must not change) although the scoped-migration steps add one to two
  minutes.

**WP01 (backend foundation).**
- `tracking_settings.config` is `jsonb` (the DML json type).
- The share gate applies only when share goes OFF to ON, so an emergency
  save while share is ON (disarming, a token) is never refused because the
  Privacy page was unpublished later.
- The POST never accepts `catalog_feed_token`; `ensureFeedToken()` creates it
  and `rotateFeedToken()` replaces it. Tokens go through `saveTrackingTokens()`
  (the service, never a workflow, I16) because medusa lint flags a service
  mutation in a route.
- POST body: config sections and the four token columns at the top level;
  unknown keys at any level give 400; `privacy.consent_version` is read-only.
  The Tracking page never sends catalog settings; the Catalog page posts
  `{ catalog }` only.
- `destinationFor(..., "google")` is also null with an empty conversion id or
  label. `GET /store/tracking-config` answers 503 `no-store` on a database
  error.
- Over-cap values are dropped, never cut (paths, landing params, every 4.4
  context string); an IP with any character outside hex, `:` and `.` is
  nulled, so a suffixed IP never reaches Meta.
- `job:<name>` adds `last_error_at` (`last_error` survives a later success).
  More exports than 3.6 (all additive).

**WP02 (hashes, match keys, adapters).**
- `purchaseEventId`/`statusEventId` and `buildMetaEvent`/`buildTikTokEvent`
  return null instead of throwing, so the steps that must never throw stay
  safe.
- Meta Purchase `event_source_url` is always forced to `<origin>/checkout/`;
  any private or `/order/` URL is dropped. COD events carry no IP or user
  agent.
- TikTok also gets `num_items` on InitiateCheckout, and no `test_event_code`
  (v1.3 has none; the TEST pixel is the TEST destination).
- `classifyMeta` checks codes before the error type (Graph labels code 100 as
  OAuthException); unknown errors are transient; "expired" is recognised from
  the message text. The TikTok 40002 index parser and Meta's expiry wording
  are not verified against real responses.
- A batch over 500 throws `TrackingAdapterError` (not a generic Error, for the
  lint rule). Every returned message passes through `redact()`.

**WP09 (Privacy page).**
- `readPrivacySettings` takes a container; the model writes its defaults as
  literals to avoid an import cycle (a test compares them).
- The Contact plain-text rule applies to the body; a published page cannot be
  emptied. POST answers `{ settings, suggested }`.
- The storefront page now has `revalidate = 60` (it was fully static); its
  `<title>` stays "Privacy policy" even if the admin title changes.
- The content module's `.snapshot-content.json` was not updated (like the
  other hand-written content migrations), so `medusa db:generate content`
  would try to create `privacy_setting` again: review its output first.

**WP14 (storefront contract, queue).**
- `validateEvent` is stricter than 4.1 on both sides: it also rejects a path
  starting with `//` or holding `#`, a backslash or non-printable characters,
  drops optional `d` keys sent as null, and rejects the event for a known key
  of the wrong type. No vector changes.
- `isPurchaseBlock` requires finite, non-negative `value` and `num_items`.
- `fl()` without a window returns a throwaway state; no `globalThis` (Safari
  12.0). The budget trim later reshaped this package's files (below).

**WP03 (outbox, alerts, health).**
- Send-time lever: rows whose platform was switched off, or whose env is live
  while disarmed, become `skipped` at send time (payload kept), so the
  rollback lever also covers rows already queued.
- All eight backoff delays are used; `failed` after the 9th failed send.
  `dry_run` rows keep their payload until retention.
- Innocent rows of a split batch are resent in the same run, not backed off.
- Alert state is per platform where the kind is, with the shape
  `{ open, title, since, last_sent_at, last_try_at }`; extra counters and state
  keys (19.5) because `tracking_event` has no status-change time.
- Counter windows read the current and the previous hourly bucket. An alert
  never emailed closes silently; a failed email is retried after 15 min;
  `no_purchase` gives no verdict outside active hours; the test alert is sent
  even while alerts are off. Feed alerts also clear on a later catalog build
  that was not held.
- `outboxHealth()` returns an array and is shared for 10 s per process
  (`?fresh=1` on the Health route bypasses it). Live reads it with
  `maxAgeMs: 60_000` (19.10).

**WP08 (variant index, catalog feed).**
- `.gz` is served as `application/gzip` (raw bytes); `.tsv` adds
  `private, no-cache` and `Vary: Accept-Encoding`. A valid-token fetch before
  anything is published is a logged 404; bad tokens are never logged.
- Include/exclude case types narrow case products only; regular products are
  always in scope. Sellable also needs a price above 0.
- `custom_label_4`: top-sellers-30d = the 20 handles with most Purchases in
  30 Dhaka days (at least 2), trending-7d = the next 20 by AddToCart in 7 days
  (at least 3), new-30d once the table has more than 30 days. Blank while the
  table is empty.
- The job also rebuilds on a settings-fingerprint change or after converting
  images. An empty first build is held without an alert.
- Source images are read from R2 by key (not the rate-limited r2.dev host);
  uploads use `PutObject` directly for the `immutable` cache header.
- State keys `catalog:images` (conversion progress, `sharp_missing`) and
  `catalog:build`.

**WP10 (stub, runtime, pixels).**
- TikTok is ready only after `onload` and `ttq.ready()`: events.js is a
  loader, and the stub it leaves would replay calls later, possibly on
  `/order/`. No documented load option turns TikTok SPA page views off, so the
  owner's pixel setting and `spa_off_confirmed` stay required.
- New queue items are noticed by wrapping `push` on the queue array; the 2 s
  timer starts with the first unsent item.
- The Purchase guard value lists the vendors that fired it. Injection waits
  one `setTimeout(0)`, then re-checks the path and scrubs again. A failed batch
  is restored only on a network error or a 5xx.
- `addScript()` lives in `pixels/meta.ts` (no helper file was allowed).

**WP11 (storefront endpoints).**
- A missing or empty User-Agent is a bot. `/api/t/e/` checks the edge header
  before reading settings; 415 for other content types, 400 for bad JSON;
  events past 25 and clock-dropped events count as `sf.invalid`.
- Staff browsers get no vendor cookies. `_fbp` only when none is usable;
  `_fl_vid` is never refreshed. Opt-out also expires the parent-domain
  `_fbp`/`_fbc` (fbevents writes them on `.florayn.com`), which clears the
  WordPress pixel's copies in that browser at cutover.
- `checkoutTrackingHeaders()` also returns null when `headers()`/`cookies()`
  throw, so checkout can never fail on it (the `checkout_without_tracking`
  alert reports it).
- The per-IP bucket has a burst of 1,200 (per IP source, an IPv6 /64, since
  19.10). The forwarder retries once only on a network error, timeout, 5xx,
  408 or 429.
- Response helpers live in `server/request-context.ts`; the staff and opt-out
  pages send `no-referrer` and `noindex`.

**WP04 (ingest).**
- Extra counters `ingest.invalid` and `ingest.unknown_host`.
  `ingest.no_destination` counts only an enabled platform without an id.
  Envelope stats are accepted only for `sf.*` keys, so the storefront cannot
  write the counters that drive the checkout and outbox alerts.
- Known variant = in the index with a price above 0 (`sellable` not needed).
  The value is clamped to the known items' index prices; the hit takes handle,
  device and case type from the index.
- Duplicate events inside one batch are recorded once. A failure answers 503
  and logs only the error code (knex messages quote bound values).
  `scheduleFlush` only when rows were inserted.

**WP05 (Purchase at checkout, reconcile).**
- Time budgets not in the spec: stash 1 s, record 3 s, statement timeout 5 s;
  reconcile covers what a budget cuts off.
- A Meta Purchase without a user agent is `skipped` (Meta refuses website
  events without one). Skipped rows carry a short reason; blocked rows say
  exactly "no token".
- Order rows use the context's stored env, even for a disabled platform, so
  "Send skipped" works and COD events follow their Purchase's dataset.
- An opted-out shopper's stored contexts keep no ip, ua, ids or click ids; the
  context and hit still exist for the `checkout_without_tracking` alert.
- `buildPurchaseBlock` can return null; reconcile (a) waits a minute after a
  cart context changes; (a) and (c) take 500 rows per run.
- The isolated CI check accepts `pending` or `dry_run` before its explicit
  flush, because the checkout's own debounced flush can win the race.

**WP07 (Live dashboard, rollup).**
- `health.outbox` is the `outboxHealth()` array, plus `watermark`.
- Derived `ProductView` rows (primary ViewContent) in the minute and day
  tables; staff hits are left out of both, so `no_purchase` history also
  ignores staff purchases.
- Fixed a cross-package gap: a Purchase hit has no handle, so Purchase rows
  for the product, device and case type dims come from the order's items
  (through the order context), in a savepoint. This is what fills the
  catalog's top-sellers label.
- `unknown` source key; landing = the session's first PageView pathname; 6 h
  window cap; `aov` over non-cancelled orders; `?host` values; the staff-link
  answer adds `list` and `off_url`; the page polls only while visible and on
  Today.

**WP12 (commerce events).**
- InitiateCheckout also skips a non-BDT currency; `items` only lines with a
  variant id; value `max(0, subtotal - bundleDiscount)`.
- `trackAdd` wraps `track()` in a try (the add's catch would otherwise undo a
  successful add). `addMany` sends only lines with a variant id.
- `submitOrder` reads headers and the customer token in one `Promise.all`;
  `placeOrder` spreads tracking headers first; the block check sits in a try.
- The client-import scanner in `tracking-server.test.cjs` skips the imports of
  `"use server"` modules: the checkout's Server Action must import
  `checkoutTrackingHeaders`, and the browser only ever gets action references
  from such a module.

**WP06 (status transitions, COD events).**
- OrderConfirmed only from a status before confirmation (section 7), because
  the outbox key lasts only while its row exists (sent rows are pruned after
  8 days). Cost: an OrderConfirmed whose enqueue failed at confirmation is not
  retried when the order ships.
- A 2 s wait budget around the enqueue, so the Steadfast webhook still answers
  fast; log lines hold only the count, the source and the error name/code.
- A change with nothing to write is left out (no more no-op
  `workflow_status` writes), duplicate ids merged, and `extra` can never set
  the status fields. Courier send keeps `status_changed_at` for an order
  already moved to shipped by hand.
- `status-events.ts` skips the order lookup when no moved order has a sendable
  context; `buildOrderEventRows` still decides.

**Budget trim (after wave 3).**
- Why: the first local build put the layout set at +1,724 B (limit 1,200) and
  checkout at +2,857 B (limit 2,543).
- The stub now only records (5.1). `boot.ts`, a new lazy chunk, makes the id
  call, the beacon and the runtime schedule; `batch.ts` holds `newEventId`,
  `prepare`, `takeUnsent` and `restoreUnsent`; `queue.ts` exports only `fl`,
  `track` and `trackPurchase`; `paths.ts` holds only the private-path check and
  the URL allowlists moved to `contract.ts`.
- `FlState.landing` is the raw `{ search, ref, path }`. Queue items keep the
  raw address and no id until `prepare()`; the runtime prepares everything at
  `start()`, before any vendor script.
- The webpack runtime grows +38 B (two lazy chunk-map entries) instead of
  +19 B; the limit is 64.

**WP13 (this section).** Docs updated (AGENTS.md pointer, CHECKOUT.md
Tracking, PERFORMANCE.md gate and loading rules, DEPLOY.md Redis note and
tracking runbook), `tests/tracking-vectors-sync.test.cjs` added, and two
Health counter labels added (19.2).

### 19.4 Dependencies

- `sharp@0.34.5` (backend, root lockfile, commit f65dd96): installed with the
  owner's approval. It is still loaded lazily through a non-literal
  specifier, and the backend image installs it with the server's production
  dependencies. JPEG catalog copies need nothing more.
- `capi-param-builder-nodejs@1.3.2` (storefront, owner decision 12): used only
  in `server/cookies.ts`. `lib/cart.ts` (every cart Server Action) and the
  checkout page now import it indirectly, so a bundling failure would break
  add-to-cart as well as checkout; the local production build bundled it.
- `server-only` is still not installed; the runtime guard of 4.8 stands in.

### 19.5 Counters, alert kinds and state keys (as built)

`tracking_counter` keys (hourly buckets):

| key | written by | means |
|---|---|---|
| `sf.untrusted` | storefront (`/api/t/id/`, `/api/t/e/`) | request without a valid edge header |
| `sf.unknown_host` | storefront | host not in test or live hosts |
| `sf.rate_dropped` | storefront | events over the per-visitor or per-IP-source limit (IPv4 address or IPv6 /64) |
| `sf.cap_dropped` | storefront forwarder | events over the global 3,000 per 10 s cap, or over a source's fair share of it (19.10) |
| `sf.invalid` | storefront | invalid events, events past 25, clock-dropped events |
| `sf.forward_failed` | storefront forwarder | batches the backend did not accept (sent with the next envelope) |
| `sf.bot` | storefront | bot or missing user agent |
| `ingest.unknown_variant` | backend ingest | product event with a variant not in the index |
| `ingest.no_token_dropped` | backend ingest | funnel event dropped, no token for that platform/env |
| `ingest.no_destination` | backend ingest | platform enabled but no id for the host's env |
| `ingest.invalid` | backend ingest | event refused on re-validation or the time window |
| `ingest.unknown_host` | backend ingest | batch host not listed (storefront config cache out of step) |
| `checkout.header_rejected` | `/store/checkout` | tracking header present, key wrong, and the order was placed (19.10) |
| `checkout.untrusted` | `/store/checkout` | context present without the edge flag |
| `outbox.<status>.<platform>.<env>` | outbox sender | rows reaching each status per hour |

The backend accepts envelope stats only for `sf.*` keys. The Health page
labels every key above.

Alert kinds (`checkAlerts`, section 10): `token` (per platform and env),
`payload` and `send_failures` (per platform), `checkout_without_tracking`,
`purchase_not_enqueued`, `edge_missing`, `no_purchase`, `sweep_stale`,
`rollup_lag`, `live_disarmed`, `unknown_variants`, `feed_guard`, `feed_error`,
`feed_not_fetched`: 14 kinds. `sweep_stale` uses fixed thresholds in
`alerts.ts` (outbox and rollup 180,000 ms, reconcile 900,000, catalog
2,700,000), which the job files register with the same values.

`tracking_state` keys: `job:<name>` `{ last_run_at, last_ok_at, last_error,
last_error_at }`; `rollup:watermark` `{ done_through }`; `alert:<kind>` or the
per-platform keys of 2.4; `alerts:last`; `prune:last`;
`outbox:last_error:<platform>:<env>` `{ at, status, cls, code, trace_id,
message, destination }`; `token_fp:<platform>:<env>`; `catalog:stale`;
`catalog:alert`; `catalog:build` `{ at, status, items, content_hash,
config_fp }` (status `published`, `held`, `unchanged` or
`published_anyway`); `catalog:images` (plus `budget_hit` when a run stopped
at its time budget, 19.10); `variant_index`.

### 19.6 Deploy order and operator steps

Each step needs the owner's OK. DEPLOY.md "Ad tracking runbook" has the
Cloudflare clicks and more detail. Never paste a secret or a token in chat or
git.

0. Commit the rest of the work (WP06, the budget trim, WP13) and push the
   branch Coolify builds. Leave `.claude/` and the compile-cache folder under
   `apps/backend/` out:

   ```bash
   git add TRACKING.md AGENTS.md CHECKOUT.md PERFORMANCE.md DEPLOY.md \
     apps/backend/src apps/backend/tests apps/storefront/src apps/storefront/tests
   git status --short    # nothing staged under .claude/ or the compile cache
   ```

1. CI on the pushed commit ("Storefront performance and freshness") must be
   green: `checkout-integration` (with the scoped tracking and privacy
   migration steps and `CHECKOUT_TRACKING_PASS`), the regression suites, the
   backend build with medusa lint, and `client-budget`.

   ```bash
   gh run list --workflow performance.yml --limit 3
   gh run view <run id> --log | grep -E "CHECKOUT_TRACKING_PASS|CHECKOUT_INTEGRATION_PASS|Within budget|exceeds"
   ```

2. Migrations, BEFORE the backend deploy, over the SSH tunnel (DEPLOY.md
   step 5 shows how to open it and where the credentials come from):

   ```bash
   cd apps/backend
   export DATABASE_URL="postgres://<user>:<password>@127.0.0.1:5433/florayn_v3"
   npx medusa exec ./src/scripts/migrate-tracking.ts
   npx medusa exec ./src/scripts/migrate-tracking.ts apply Migration20260928090000
   npx medusa exec ./src/scripts/migrate-privacy-settings.ts
   npx medusa exec ./src/scripts/migrate-privacy-settings.ts apply Migration20260928091000
   unset DATABASE_URL
   ```

3. Env secrets in Coolify (runtime variables, then redeploy): backend
   `TRACKING_INGEST_SECRET`; storefront `TRACKING_INGEST_SECRET` (the same
   value) and `TRACKING_EDGE_SECRET`. Make each with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Cloudflare, host `new.florayn.com` only: the `/api/t/` cache bypass rule
   (last), the Transform Rule that sets `x-florayn-edge` to
   `TRACKING_EDGE_SECRET`, no bot challenge on `/api/t/`, and the rate-limit
   rule on `/api/t/` (REQUIRED since 19.10, saved before the Transform Rule;
   DEPLOY.md runbook step 2 rule 4); check the click-id cache-key rule leaves
   the address bar intact. Origin firewall: not until `api.new.florayn.com` is proxied or
   moved (16.3).
5. Deploy the backend, wait for healthy, then the storefront. Purge the HTML
   by prefix and warm (DEPLOY.md step 6). Never judge speed cold.
6. Verify with a browser user agent (DEPLOY.md step 7): `/api/t/id/` through
   Cloudflare gives 200, `private, no-store`, `on: true` and the three `_fl_`
   cookies; straight to the origin it gives `on: false` and no cookie;
   `/store/tracking-config` has no token or email; the five admin pages load
   and Health shows fresh job runs; the rate-limit loop answers 429 after about
   60 calls (no 429 at all: fix the rule before turning a platform on).
7. Owner, Meta TEST (17.A): paste the TEST token, the test event code, turn
   Automatic Advanced Matching OFF in Events Manager, tick it in Admin >
   Tracking, turn Meta on. Staff exclude their browsers (17.H).
8. QA on the TEST dataset, section 15 (19.7).
9. Later, each on its own OK: catalog image mode and enabling the catalog
   (17.E), Privacy page and share (17.F, then TEST ORDER 5), TikTok (17.C,
   with Automatic advanced matching OFF in both pixels), backups with the
   table exclusions (16.8), cutover (18).

### 19.7 QA on the TEST dataset

Run section 15 on `new.florayn.com` with Meta's Test Events open. Up to five
real orders are approved (decision 4): name them "TEST ORDER", they go only to
the TEST dataset, and every one is set to cancelled in Admin > Orders when QA
ends (cancelling sends no event). Steps 6, 7, 8 and 11 use TEST ORDERs 1 to 4;
TEST ORDER 5 waits for the owner's Privacy and consent approval (step 16).
Step 12 moves TEST ORDER 1 through processing, confirmed, shipped and
delivered: expect one OrderConfirmed and one Delivered, and nothing more when
it moves back and forth.

Added by the build, check during QA:
- On a public page the boot chunk loads at first idle, followed by exactly one
  `/api/t/id/`; nothing loads and nothing is called on `/order/`, `/review/`
  or `/account/`; a bounce after the id answer sends one `sendBeacon` to
  `/api/t/e/`.
- The proxy keeps the `Host` header (the stored context's host decides the
  environment and trust): the TEST ORDER's `tracking_order_context` shows
  `new.florayn.com`, env `test`, trusted.
- Add to cart and checkout work on the deployed build (they now import the
  tracking header code).
- Slow 3G (step 7): no `facebook.com/tr` request carries `/order/` in `dl`.
- With a TikTok test pixel later: `ttq.ready()` fires after events.js loads.
- In `next dev`, StrictMode sends one PageView per pathname.

QA run 1 (2026-09-28, deployed 403c9d8, Meta on, TEST dataset, share OFF):
- Step 1 (inert without edge) and the section 16 checks: pass (DEPLOY.md step 7).
- Step 2: `fbclid=TEST123` landing loads fbevents at `load` (click id present),
  config for 2247389409441720; PageView and ViewContent carry `eid`, `fbc`,
  `fbp`; ViewContent content_ids = the `?case` variant, value 1400 BDT; no `ud[`.
- Step 3: client navigation sends a browser ViewContent only, no browser PageView.
- Step 4: AddToCart has the variant id, quantity 1, item_price 1400 and an `eid`.
- Step 5: InitiateCheckout `ic-...`, value 1400, num_items 1; a reload resends
  the same `ic-` id.
- Step 6: TEST ORDER 1 = #1109 (1460 BDT with Dhaka delivery). Browser
  Purchase `eid=fl-1109` fired from `/checkout/` (dl) before the URL changed; no
  vendor request contains `/order/`; only `ud[external_id]` (not a phone or
  name hash). Backend: `/store/checkout` 200, ingest 202, no warn/error logs.
  Meta dataset details show `server_last_fired_time` set, so CAPI arrives.
- Open: deduplication as seen in Meta Test Events (owner's screen); steps 7, 8,
  9, 10, 11 (need DevTools throttling, a network cut, a review token, an ad
  blocker or an admin session in the same browser); step 12 on #1109 by the
  owner; step 15 test alert; step 16 after the Privacy approval. #1109 is
  cancelled when QA ends.

### 19.8 Numbers only CI or a deploy can measure (TODO)

- TODO(CI): the `client-budget` table from the first CI run on the pushed
  branch, with the run id. The local table is in 19.1.
- TODO(CI): the `checkout-integration` job's duration with the added
  migration steps (its timeout is 20 min).
- TODO(deploy): `/api/t/e/` p95 (target under 20 ms) and backend
  `/tracking/ingest` p95 (under 50 ms), from the logs or a short load check.
- TODO(deploy): `GET /admin/tracking/live` response time with a Live tab open,
  and outbox + rollup + feed CPU (target under 3% of one vCPU).
- TODO(deploy): `npm run perf:check -- --enforce` after purge and warm.
- TODO(deploy): Lighthouse mobile, product page, LCP and TBT before and after
  (within about 10%).
- TODO(deploy): checkout INP before and after.
- TODO(QA): Meta Test Events deduplication per event and Purchase EMQ with
  share OFF (expected below the 8.6 baseline until share is ON).

### 19.9 Open issues and risks (not fixed here)

- No tracking SQL has run against a real Postgres or Medusa: only in-memory
  fakes. First real runs: CI `checkout-integration`, then the migrations and
  QA. Unproven: `SET LOCAL`, the ON CONFLICT read-back under concurrent
  submits, knex savepoints in the rollup, `LATERAL (VALUES ...)`,
  `count(distinct) FILTER`, the `query.graph` order fields, the 413 from
  Medusa's body parser.
- COD events have no reconcile: a failed status enqueue (logged) loses that
  event. "Once per order" holds only while the outbox row exists (8 days for
  sent rows); a fully durable guard needs a marker column, a schema change.
- The share gate checks only OFF to ON: if the owner unpublishes the Privacy
  page while share is ON, share stays ON until switched off by hand.
- `checkoutTrackingHeaders()` has no time budget; on a cold data-cache miss
  its `getTrackingConfig()` fetch adds that fetch's time to the Server Action
  (tens of ms when healthy). A small budget would bound it.
- `outboxHealth()` aggregates all of `tracking_event` (about 1M rows at
  target) at most every 10 s per process, and Live's unknown-ids count scans
  today's hits every 10 s while open. Watch both; counters could replace them.
  (19.10: from Live both now run at most once a minute; the Health page still
  reads the outbox counts with its 10 s cache and on Retry.)
- `kickStaleJobs` from an admin route restarts a job only in a process that
  loaded that job file.
- Before the first variant-index build every product event counts as unknown,
  so `unknown_variants` can fire once after a fresh deploy.
- Catalog: check `google_product_category` text paths and the `internal_label`
  form on the first Commerce Manager fetch.
- The event time of a COD event is when the backend learns of the move, not
  Steadfast's own time.
- `queue.ts` and `paths.ts` are still copied into the checkout and cart page
  chunks (about 280 B gzip), because of Next's split-chunk minimum.
- At cutover the florayn.com cache rules must exclude `/api/` too, and the
  Cloudflare rules of 16.2 must be widened to `florayn.com` and `www`.
- Postgres has no backups yet (pre-cutover audit); when they are set up, use
  the exclusions in 16.8.

### 19.10 Review fixes (2026-09-27)

An adversarial review of 3376b89 confirmed 11 findings. All 11 are fixed in
the working tree, not yet committed. No migration and no new setting: they
ship with the normal backend-then-storefront deploy. The sections above carry
"As built (19.10)" notes where the spec changed.

| # | Finding | Fix (file) |
|---|---|---|
| 1 | Contact hashes for orders whose shopper never saw the consent line, once share turns ON | The storefront sends `consent_version` only when the line rendered (`checkoutConsent(config)?.version ?? null`, `server/checkout-context.ts`). The backend hashes per order: share ON and a stored version (`sharesContact`, `order-events.ts`); covers Purchase, COD status rows, reconcile and the browser block (6.2) |
| 2 | Rate limits keyed on client-controlled values; one IPv6 /64 could take the whole forward cap | `ipSource()` keys the IP bucket per IPv4 address or IPv6 /64 (`server/rate-limit.ts`); the 3,000 per 10 s cap is shared max-min fairly per source (`FAIR_SHARE`, `fairShare`, `server/forward.ts`); the Cloudflare rule is required (DEPLOY.md). Signing `_fl_vid` was not done: the review showed it gains nothing |
| 3 | A bare POST with a forged header raised `checkout_without_tracking` | `checkout.header_rejected` counts only for a placed order (`api/store/checkout/route.ts`) |
| 4 | Review token reached TikTok/Meta on a client navigation after the pixels loaded | `drain()` skips vendor calls while `review` or `r` is in the address bar (`runtime.ts`, 5.2) |
| 5 | `/review/<token>/` leaked the token through `document.referrer` | `Referrer-Policy: no-referrer` for `/order/*`, `/review/*`, `/account/*` (`next.config.ts` `headers()`), plus metadata on `/review/[token]` (4.2) |
| 6 | No gate for TikTok's Automatic advanced matching | `spa_off_confirmed` now also confirms it (admin label and help text, validation label; same key); owner step 17.C and QA 15.17 |
| 7 | `purchase_not_enqueued` scanned the whole outbox every minute | The lookup pins `platform in (<enabled>)`, an index-only probe on `tracking_event_key` (`alerts.ts`) |
| 8 | The per-cart IC id dropped the IC hit of every later session | The hit key is `<ic id>:<session id>` (`ingest.hitEventId`); outbox rows and payloads keep the plain id (2.4) |
| 9 | Every order's stock batch rebuilt the variant index | Only product/variant/option/catalog batches call `markCatalogStale` (`storefront-events.ts`, 8.5) |
| 10 | Feed image conversion saturated both vCPUs | `sharp.concurrency(1)`, one image at a time, no mozjpeg, per-run time budget (`catalog-images.ts`, 8.3) |
| 11 | Live re-totalled orders and scanned the outbox on every poll | One SQL read with `order_summary` totals, 7-day history cached per Dhaka day, outbox counts and unknown ids at most once a minute, Live cache `max(10 s, poll_seconds)` (`live.ts`, 9) |

Tests added: consent per order (status events, purchase, reconcile, block,
checkout counting), the settings label, the storefront context version, the
runtime review-link test, `tests/private-referrer.test.cjs` (evaluates the
real `next.config.ts`, matches its sources with Next's own matcher and pins
every other key), `tests/tracking-abuse.test.cjs` (IPv6 /64 replay of the
finding, fair share) and a route-level /64 test, the alert lookup, IC hit
keys and the two-session rollup, the Live SQL and caches, the stock-only
batch and the image budget. The consent, runtime and abuse fixes were
checked by mutation: their new tests fail against the old code. The order
and alert SQL was also run on a throwaway
local Postgres 17.6: the alert lookup plans as an Index Only Scan on
`tracking_event_key`.

Verification (after all four groups):

| Check | Result |
|---|---|
| `cd apps/backend && npm test` (Node 24.12) | 515 tests, 515 pass |
| `cd apps/backend && npx -y node@22 --test tests/*.test.cjs` (22.23.3) | 515 tests, 515 pass |
| `cd apps/storefront && npm test` (Node 24.12) | 499 tests, 499 pass |
| `cd apps/storefront && npx -y node@22 --test tests/*.test.cjs` (22.23.3) | 499 tests, 499 pass |
| `npx tsc --noEmit -p apps/backend` / `-p apps/storefront` | exit 0 / exit 0 |
| `cd apps/backend && npx medusa build` | exit 0; `medusa lint` 0 errors, 188 warnings (the same count; in touched files only the older `throw new Error` in `lib/storefront-events.ts`) |
| Storefront production build, fixture API on `http://127.0.0.1:9931` | exit 0; the same 26 prerendered routes and 5 `generateStaticParams` routes as the base build |
| `check-client-budget.cjs` against the pre-tracking base | "Within budget." (below) |
| `next start` of that build, headers | `/order/x/`, `/review/x/`, `/review/order_01ABC.sig1`, `/account/`, `/account/login/` send `Referrer-Policy: no-referrer`; `/shop/`, `/men/`, `/privacy/` do not |

| measure | base | head | delta | limit |
|---|---|---|---|---|
| framework (rootMainFiles) | 100,883 | 100,883 | 0 | = 0 |
| webpack runtime | 1,918 | 1,955 | +37 | <= 64 |
| `/layout` set | 31,404 | 32,113 | +709 | <= 1,200 |
| `/page` | 139,421 | 140,167 | +746 | <= 778 |
| `/shop/page` | 186,465 | 187,211 | +746 | <= 778 |
| `/collection/[slug]/page` | 136,198 | 136,944 | +746 | <= 778 |
| `/product/[slug]/page` | 202,805 | 203,774 | +969 | <= 1,046 |
| `/checkout/page` | 144,988 | 146,374 | +1,386 | <= 1,546 |
| lazy runtime chunk (`fl-runtime-v1`) | - | 2,695 | - | <= 6,000 |

The runtime chunk grew 16 B (`carriesReview`); no first-load set grew.
A review token contains a dot, so Next serves `/review/<token>` without the
trailing slash (the slash form answers 308); both forms get the header.

Still open after the fixes (not done here):
- Contexts stored by a storefront from before this fix always carry a
  `consent_version`. If one ever placed tracked orders in production, keep
  share OFF until 90 days after this deploy (order contexts are kept 90
  days), or add a guard: store the consent version current when share turned
  ON and require a stored version at or above it (a new stored setting).
- The checkout page and its Server Action read `getTrackingConfig()`
  separately; if the config is revalidated between render and Place order,
  that one submit can carry a version for a line the shopper did not see, or
  the reverse.
- Wording only, the gate is right: `server/config.ts` (~line 172) and
  `pixels/tiktok.ts` (~line 17) still describe `spa_off_confirmed` as SPA page
  views only, and the Health label for `sf.cap_dropped` still says "global
  cap" (`admin/routes/tracking/health/page.tsx`).
- `jobs/catalog-feed.ts` and `api/admin/tracking/catalog/route.ts` still pass
  `concurrency: 2`, now ignored (`tests/catalog-feed.test.cjs` asserts it).
- Feed availability after a pure stock change lags until 03:30 Dhaka. Faster
  needs a stock-only state key the catalog job reads only while the catalog
  is enabled, refreshing `in_stock` from `blankAvailability`.
- Live's today query still scans Medusa's `"order"` (no `created_at` index),
  now at most once per poll; revisit past about 100k orders. The Health page
  still runs `OUTBOX_HEALTH_SQL` with its 10 s cache.
- `order_summary.current_order_total` matches the computed total for
  checkout orders and confirmed order edits; a direct line-item update that
  bypassed order changes would diverge (the codebase has none).
- Existing race: when the runtime started on a private page and the shopper
  then client-navigates to `/product/x/?review=<token>`, injection's
  `setTimeout(0)` scrub can run before the product page reads the token, so
  the review form loses its prefill (no leak).
- Cloudflare does not document whether its rate-limit IP characteristic
  groups IPv6 by /64; the origin's /64 keying covers that. A holder of a
  larger block (a /48) still gets one budget per /64; IPv4 stays per address
  (not /24) so carrier NAT is not penalised. The fair share reacts one window
  (10 s) late. The free plan has one rate-limiting rule per zone: if the
  florayn.com zone already uses it, the owner must choose.
- A document loaded with `no-referrer` keeps it for its life, also after
  soft navigation to public pages, so later requests from that tab carry no
  `Referer`. Same-origin fetch and beacon POSTs keep `Origin` and
  `sec-fetch-site: same-origin` (checked in Chromium), so Server Actions and
  `/api/t/*` are unaffected.
- The Live orders SQL ran on a throwaway local Postgres, not yet in CI or
  production (19.9's first bullet still applies to the rest).

---

## Appendix A. Privacy page draft (for Florayn to check and approve)

Written for the owner to correct and approve in Admin > Privacy; it is not legal
advice. WP09 stores it verbatim in `apps/backend/src/modules/content/privacy-draft.ts`
as `SUGGESTED_PRIVACY_TITLE` and `SUGGESTED_PRIVACY_BODY`. Body format: blocks
separated by a blank line; a block starting with `## ` is a heading; lines
starting with `- ` are list items; everything else is a paragraph; no HTML.

Title: `Privacy policy`

```text
Florayn sells printed cases for phones, AirPods, watches and cards, made in Dhaka, Bangladesh. This page explains what we collect when you use our website, why we collect it, who we share it with, how long we keep it and how you can stop it.

## What you give us when you order

To deliver an order we need your name, phone number, district, area and delivery address. Your email is optional. We save these with your order so we can confirm it by phone, hand the parcel to our courier (Steadfast) and handle exchanges. If you sign in to an account, we also keep your email and your order history.

## What we record while you browse

Our website sets its own cookies with a random visitor id and a session id. With them we count visits and see which pages and products are viewed, what is added to the bag and when a checkout starts. We also note how you arrived (for example from a Facebook or TikTok ad link), your browser and device type, your approximate country and, for ad measurement, your IP address. We do not record what you type into forms, except the order you place.

## Advertising partners

We advertise on Facebook and Instagram (Meta), TikTok and Google. To learn which ads lead to orders, we send these companies the events above (page views, product views, add to bag, checkout started, and orders with their value and product codes), the ad click id from the link you followed, your IP address and browser details. Their own code (the Meta Pixel, the TikTok Pixel and the Google tag) may also run in your browser and set their own cookies.

When you place an order, we may also send them a scrambled (SHA-256 hashed) copy of your phone number, name, district and email (if you gave one), so they can match the order to an ad you saw. Hashing hides the plain text, but these companies can compare it with details they already hold. They use this data under their own privacy policies.

## Cookies we use

- _fl_vid: a random visitor id, 400 days
- _fl_sid and _fl_src: your current visit and how you arrived, 30 minutes
- _fbp and _fbc: Meta browser id and ad click id, 90 days
- ttclid and _ttp: TikTok ad click id and browser id, up to 90 days
- _fl_gclid and _gcl_aw: Google ad click id, 90 days
- florayn_cart_id: your bag, 30 days
- florayn_customer_jwt: keeps you signed in to your account, 30 days
- fl_audience: whether you chose the women's or men's shop, 1 year
- _fl_optout: remembers that you turned off ad measurement, 400 days

## How long we keep it

- Orders are kept as business records.
- Detailed visit records are deleted after 7 days. After that we keep daily totals without visitor ids, and visit summaries for 90 days.
- Data waiting to be sent to an advertising partner is deleted within 14 days.
- Ad data linked to an order (click ids, IP address, browser) is deleted after 90 days.

## Your choices

- Turn off ad measurement on this browser with the link below. Our website then stops recording your visits, loads no advertising code, and does not report your orders to advertising partners.
- You can also block or delete cookies in your browser settings.
- To see, correct or delete the details we hold about you, contact us.

## Contact

Florayn, Plot #H-2 (1st Floor), Block-H, Sector-2, Avenue-10, Zahurul Islam City (Aftabnagar Eastern Housing Project), Dhaka-1212, Bangladesh. Phone +8801310007055. Email info@florayn.com.
```

The storefront shows "Last updated <date>" from `updated_at` and, below the
body, the link "Turn off ad measurement on this browser" to
`/api/t/optout/?on=1` (and "Turn it back on" to `?on=0`).

## Appendix B. Checkout consent sentence draft

Stored as `SUGGESTED_CONSENT_TEXT` in `apps/backend/src/lib/tracking/settings.ts`
(WP01) and offered by the "Use suggested wording" button; `consent_text` itself
defaults to empty. The storefront appends the "Privacy policy" link.

```text
We use these details to deliver your order. To measure our ads, we also send Meta, TikTok and Google a scrambled (hashed) copy of your phone number, name, district and email.
```

## Appendix C. Shared test vectors

`apps/storefront/tests/fixtures/tracking-vectors.json` (WP14) and
`apps/backend/tests/fixtures/tracking-vectors.json` (WP01) both contain exactly
this JSON. `destination` and `host_role` patches are deep-merged into
`DEFAULT_CONFIG` (objects merge, arrays replace). `events` are checked with
`validateEvent` (shape only). `keys` use the listed test secret. `source` is used
by the storefront only; `hashes` by the backend only. A reference implementation
checked every vector on 2026-09-27.

```json
{
  "version": 1,
  "private_paths": [
    ["/order/order_01ABC/", true],
    ["/order/", true],
    ["/order", true],
    ["/review/abc123/", true],
    ["/account/", true],
    ["/account/orders/", true],
    ["/account/login/", true],
    ["/men/account/", true],
    ["/men/order/x/", true],
    ["/men/review/x/", true],
    ["/orders/", false],
    ["/accounting/", false],
    ["/", false],
    ["/men/", false],
    ["/product/zebra-stark-iphone-17-pro-max/", false],
    ["/men/product/zebra-stark/", false],
    ["/checkout/", false],
    ["/cart/", false],
    ["/review", true],
    ["/men/men/order/", false]
  ],
  "safe_path": [
    ["/product/x/", "?case=signature&fbclid=abc&utm_source=facebook", "/product/x/?case=signature"],
    ["/product/x/", "?variant=variant_01ABCDEFGHIJ&device=iPhone%2017&case=elite-clear", "/product/x/?case=elite-clear&device=iPhone+17&variant=variant_01ABCDEFGHIJ"],
    ["/product/x/", "?review=tok123&r=1", "/product/x/"],
    ["/shop/", "", "/shop/"],
    ["/checkout/", "?gclid=abc", "/checkout/"],
    ["/product/x/", "?case=elite-clear&device=iPhone+17", "/product/x/?case=elite-clear&device=iPhone+17"]
  ],
  "landing_params": [
    ["?fbclid=AbC-123_x&utm_source=facebook&utm_medium=paid&utm_campaign=sept%20sale&case=signature&review=tok", { "fbclid": "AbC-123_x", "utm_source": "facebook", "utm_medium": "paid", "utm_campaign": "sept sale" }],
    ["?ttclid=E.C.P.abc123", { "ttclid": "E.C.P.abc123" }],
    ["?gbraid=0AAAAA&wbraid=1BBBB", { "gbraid": "0AAAAA", "wbraid": "1BBBB" }],
    ["", {}]
  ],
  "event_ids": [
    ["PageView", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["ViewContent", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["AddToCart", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", true],
    ["InitiateCheckout", "ic-0123456789abcdef01234567", true],
    ["InitiateCheckout", "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", false],
    ["ViewContent", "ic-0123456789abcdef01234567", false],
    ["PageView", "3F9C2A1E-5B7D-4C8E-9A0B-1C2D3E4F5A6B", false],
    ["PageView", "3f9c2a1e-5b7d-1c8e-9a0b-1c2d3e4f5a6b", false],
    ["Purchase", "fl-1234", false],
    ["InitiateCheckout", "ic-0123456789abcdef0123456", false]
  ],
  "events": [
    { "ok": true, "e": { "n": "PageView", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/", "d": { "first": true } } },
    { "ok": true, "e": { "n": "ViewContent", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/?case=signature", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 1, "price": 1400 }], "value": 1400, "currency": "BDT", "handle": "zebra-stark", "device": "iPhone 17 Pro Max", "case_type": "Signature", "primary": true } } },
    { "ok": true, "e": { "n": "InitiateCheckout", "id": "ic-0123456789abcdef01234567", "t": 1790467200000, "p": "/checkout/", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 2, "price": 1400 }], "value": 2800, "currency": "BDT", "num_items": 2 } } },
    { "ok": false, "why": "browser Purchase", "e": { "n": "Purchase", "id": "fl-1234", "t": 1790467200000, "p": "/checkout/", "d": {} } },
    { "ok": false, "why": "private path", "e": { "n": "AddToCart", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/order/order_01ABC/", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 1, "price": 1400 }], "value": 1400, "currency": "BDT" } } },
    { "ok": false, "why": "not a variant id", "e": { "n": "AddToCart", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/", "d": { "items": [{ "id": "prod_01ABCDEFGHIJ", "q": 1, "price": 1400 }], "value": 1400, "currency": "BDT" } } },
    { "ok": false, "why": "quantity 100", "e": { "n": "AddToCart", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 100, "price": 1400 }], "value": 1400, "currency": "BDT" } } },
    { "ok": false, "why": "price over 1e6", "e": { "n": "AddToCart", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 1, "price": 1000001 }], "value": 1400, "currency": "BDT" } } },
    { "ok": false, "why": "no items", "e": { "n": "ViewContent", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/", "d": { "items": [], "value": 0, "currency": "BDT" } } },
    { "ok": false, "why": "currency", "e": { "n": "ViewContent", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/", "d": { "items": [{ "id": "variant_01K6EXAMPLEVARIANT01", "q": 1, "price": 1400 }], "value": 1400, "currency": "bdt" } } },
    { "ok": false, "why": "path not allowlisted", "e": { "n": "PageView", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "/product/x/?review=tok123" } },
    { "ok": false, "why": "path not absolute", "e": { "n": "PageView", "id": "3f9c2a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b", "t": 1790467200000, "p": "https://evil.example/" } }
  ],
  "host_role": [
    [{}, "new.florayn.com", "test"],
    [{}, "florayn.com", "test"],
    [{ "live_armed": true }, "florayn.com", "live"],
    [{ "live_armed": true }, "www.florayn.com", "live"],
    [{ "live_armed": true }, "new.florayn.com", "test"],
    [{}, "evil.example", null],
    [{}, "NEW.florayn.com:443", "test"],
    [{}, "localhost", null],
    [{ "test_hosts": ["new.florayn.com", "localhost"] }, "localhost:8000", "test"]
  ],
  "destination": [
    { "patch": { "meta": { "enabled": true } }, "host": "new.florayn.com", "platform": "meta", "expect": { "env": "test", "id": "2247389409441720" } },
    { "patch": { "meta": { "enabled": true } }, "host": "florayn.com", "platform": "meta", "expect": { "env": "test", "id": "2247389409441720" } },
    { "patch": { "live_armed": true, "meta": { "enabled": true } }, "host": "florayn.com", "platform": "meta", "expect": { "env": "live", "id": "650439547920083" } },
    { "patch": { "live_armed": true, "meta": { "enabled": true } }, "host": "www.florayn.com", "platform": "meta", "expect": { "env": "live", "id": "650439547920083" } },
    { "patch": { "meta": { "enabled": true } }, "host": "evil.example", "platform": "meta", "expect": null },
    { "patch": {}, "host": "new.florayn.com", "platform": "meta", "expect": null },
    { "patch": { "meta": { "enabled": true, "test_id": "" } }, "host": "new.florayn.com", "platform": "meta", "expect": null },
    { "patch": { "tiktok": { "enabled": true } }, "host": "new.florayn.com", "platform": "tiktok", "expect": null },
    { "patch": { "live_armed": true, "tiktok": { "enabled": true } }, "host": "florayn.com", "platform": "tiktok", "expect": { "env": "live", "id": "D9ODDBJC77U97D5Q7MQG" } },
    { "patch": { "google": { "enabled": true } }, "host": "new.florayn.com", "platform": "google", "expect": null },
    { "patch": { "google": { "enabled": true } }, "host": "florayn.com", "platform": "google", "expect": null },
    { "patch": { "live_armed": true, "google": { "enabled": true } }, "host": "florayn.com", "platform": "google", "expect": { "env": "live", "id": "AW-18147096523", "label": "0p0wCKu2w70cEMvvms1D" } },
    { "patch": { "live_armed": true }, "host": "florayn.com", "platform": "google", "expect": null },
    { "patch": { "meta": { "enabled": true } }, "host": "NEW.florayn.com:443", "platform": "meta", "expect": { "env": "test", "id": "2247389409441720" } }
  ],
  "keys": {
    "secret": "0123456789abcdef0123456789abcdef",
    "ingest": "c70bc729095816f9495991900e6620149cb184a36ebbec9083e15097e17f2637",
    "staff_link": "e2ecb193f4e5f52ce1774c98a36085e6dc67661e7900d27f444bc328b4441da9",
    "staff_cookie": "cef910f5217312256f8363c7afc4b561bc00db9da04e53a8cc660e37fc1947be",
    "ic": { "cart_id": "cart_01TESTCART0001", "id": "ic-2bfd8138f2e0b44be97f21a5" }
  },
  "source": [
    { "q": { "ttclid": "E.C.P.abc" }, "ref": null, "ua": "Mozilla/5.0 (Linux; Android 14)", "host": "new.florayn.com", "expect": { "src": "tiktok_paid", "camp": null } },
    { "q": { "gclid": "Cj0KCQ" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "google_paid", "camp": null } },
    { "q": { "wbraid": "1BBBB" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "google_paid", "camp": null } },
    { "q": { "utm_source": "facebook", "utm_medium": "paid", "utm_campaign": "sept-sale" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "meta_paid", "camp": "sept-sale" } },
    { "q": { "utm_source": "IG", "utm_medium": "cpc" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "meta_paid", "camp": null } },
    { "q": { "utm_source": "tiktok", "utm_medium": "paid" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "tiktok_paid", "camp": null } },
    { "q": { "utm_source": "Newsletter Weekly!", "utm_medium": "ads" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "newsletterweekly_paid", "camp": null } },
    { "q": { "utm_medium": "paid" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "unknown_paid", "camp": null } },
    { "q": { "fbclid": "AbC" }, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "meta", "camp": null } },
    { "q": {}, "ref": "https://l.facebook.com", "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "meta", "camp": null } },
    { "q": {}, "ref": null, "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) [FBAN/FBIOS;FBAV/450.0]", "host": "new.florayn.com", "expect": { "src": "meta", "camp": null } },
    { "q": {}, "ref": null, "ua": "Mozilla/5.0 (Linux; Android 13) musical_ly_2023", "host": "new.florayn.com", "expect": { "src": "tiktok", "camp": null } },
    { "q": {}, "ref": "https://www.google.com", "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "google_organic", "camp": null } },
    { "q": {}, "ref": "https://web.whatsapp.com", "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "messaging", "camp": null } },
    { "q": {}, "ref": "https://example.com", "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "referral", "camp": null } },
    { "q": {}, "ref": "https://new.florayn.com", "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "direct", "camp": null } },
    { "q": {}, "ref": null, "ua": "Mozilla/5.0", "host": "new.florayn.com", "expect": { "src": "direct", "camp": null } }
  ],
  "hashes": {
    "meta_phone": [["01712345678", "8801712345678"], ["+880 1712-345678", "8801712345678"], ["8801712345678", "8801712345678"], ["12345", null]],
    "sha256": {
      "8801712345678": "c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1",
      "+8801712345678": "650037f77977759c37e1a76c2e101bc1957b7f52f9567ecaa65a35586e05c08c",
      "dhaka": "de90643718108ec9a93cc6905f2b976297505a8abeac37b747132877fb32fb8d",
      "coxsbazar": "43dea41fc4e7f595cead44b14c4bfb1033a9af49026171bfc5b03a66b290ad37",
      "bd": "5e657ff6158d3e2a6d23e2a523917a2305acee9423365e268695c4b7b8919f4c",
      "md": "21262a3cb5337627b0fad9d891c16adb40706bd3e57534416dd02bbe5917d184",
      "shamim": "7d106eadf8eb2a503f5e46747f14ea252c024f8d23c162cfc3c77b498820452e",
      "mdshamim": "73d26e9dd7f6168bf46146cb39b2c4f1a8ddce6ce2c34d101c81855fb44f0258",
      "test@example.com": "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
      "johnsmith@gmail.com": "3586de92bb3636d0885a12eff961429a32e4ebd764b96f50d85d016f9338d586",
      "v1.1790467200.0123456789abcdef": "202f3b44f612b759b9abad5e5482e957203086352986edc2cb5ddae91847fdbd"
    },
    "norm_city": [["Dhaka", "dhaka"], ["Cox's Bazar", "coxsbazar"]],
    "meta_name": [["Md Shamim", "mdshamim"], [" MD. ", "md"]],
    "norm_email": [["  Test@Example.com ", "test@example.com"], ["01712345678@no-email.florayn.local", null], ["not-an-email", null]],
    "google_email": [["John.Smith@gmail.com", "johnsmith@gmail.com"], ["John.Smith@example.com", "john.smith@example.com"]]
  }
}
```
