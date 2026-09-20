# Storefront performance checks

Keep the catalog grouped by design with compatible device and case-type
variants. A new design or model should not require duplicating products to make
pages fast. Fetch the fields the page needs, preserve actual regional pricing
where required, and share repeated browser data.

## Product payload budget

`apps/storefront/src/lib/product-view-data.ts` sends one compact related-design
catalog for More Designs, mixed-device packs, and featured picks. Shared image,
device and case-type tables replace repeated pair maps. The client restores the
existing component contracts once; all compatible models, prices and cart
variant IDs remain available without another request. Different cached versions
of a product are shared only when their projected contents match.

The regression tests cover:

- Every model/case combination, including differing per-device prices, exact
  pack and quick-add IDs, missing images, and duplicate-pair fallback order.
- The 12-card strip limit, unlimited pack references within the fetched pool,
  featured ordering, and independently cached versions of one product.
- A synthetic copy of the measured catalog dimensions: 39 models, 102 compatible
  pairs per design, 11 siblings, and four featured picks with three overlaps.
  Its related data must stay at or below **215,000 JSON bytes** and below 45% of
  the expanded section data. IDs are 34 characters and image URLs 104 characters;
  none are copied from production.
- A larger 12-design, 156-pair fixture that must stay below half the expanded
  JSON size and also improve gzip size.

During the September 2026 investigation, a saved public product response had
616,835 decoded RSC bytes and 55,880 transferred bytes. A local behavioral replay
of its three related sections preserved every value and reduced their JSON from
520,449 to 188,879 bytes; gzip changed from 42,313 to 28,811 bytes. These are
serialization comparisons, not an LCP result or a one-second page-load promise.
Re-measure real responses and browser timings after deployment.

When a feature needs extra data, first check whether it can share existing data
or load when used. Raise a budget only with a recorded before/after measurement
and tests proving selectors, image fallbacks, prices and cart choices still work.

## Browser measurements

Load a page with `#perf` at the end of its URL, for example
`/product/audit-bloom-iphone-17-pro-max/?case=signature#perf`. Reload when enabling
the diagnostic. It stays active through navigation in that document. The panel
loads only for this explicit hash, sends no data, and stores no measurements.

- `ttfbMs`: first response byte since document navigation started.
- `lcpMs`: the browser's buffered Largest Contentful Paint for the document.
  It is not reused as a client-navigation metric.
- `productReadyMs`: an **observed upper bound**, measured from document start or
  the clicked link. The matching route must be hydrated, its current hero must
  load and decode, and two animation frames must pass. The lazy diagnostic may
  mount after the product was already visible, so this value can overestimate
  readiness. It does not claim every below-the-fold image is loaded.
- `resourceKB`: transfer bytes exposed by Resource Timing since the measurement
  began. Cached and cross-origin resources may expose zero; this is not a total
  network-byte guarantee.

Route-path markers and generation checks prevent the previous product or an old
image-decode promise from completing a new navigation measurement. Products with
only image placeholders do not receive a successful decoded-hero reading.

Compare cold and warm direct document loads and client navigations separately.
Record the browser/device, network, cache status, response bytes, TTFB, and LCP
or product-ready reading. Server response timing alone cannot establish how fast
the visible page finishes on a phone.

## Repeatable HTTP benchmark

`npm run perf:check` requests six verified routes sequentially, with two document
samples and two RSC samples per route, and a 500 ms gap between requests. It
requires curl 7.83 or newer. Only `https://new.florayn.com` is allowed remotely;
redirects are never followed. An explicit loopback base and explicit route list
are required for local checks. The script does not load credentials or `.env`.

```sh
npm run perf:check -- --output performance-result.json
npm run perf:check -- --route /product/timeless-iphone-17-pro-max/ --modes rsc --enforce
npm run perf:check -- --base http://127.0.0.1:9902 --route /product/audit-bloom/ --output fixture-result.json
```

Use `--routes routes.json` for a JSON array of relative paths. Reports contain
HTTP status, curl TTFB and total response time, decoded and transferred body
bytes, content type, CF/Next cache status, and age. Bodies are counted and
discarded, and response cookies are omitted. JSON is printed to stdout and may
also be saved with `--output`; use `npm --silent run perf:check` when redirecting
stdout directly to a JSON file.

`--enforce` defaults to 1,000 ms warm TTFB, 1,500 ms warm response completion,
400,000 decoded RSC bytes, and 900,000 decoded document bytes. Override these
with the documented command flags when evaluating a different budget. Timing
enforcement uses later samples only when CF or Next reports HIT; an unverified
warm cache is reported as inconclusive and fails enforcement. Size checks apply
to every sample. HTTP and content-type errors exit nonzero even without
enforcement. These HTTP budgets do not prove a one-second visible page or LCP.

CI tests the benchmark only against a temporary local compressed-response
fixture. It never runs the default remote benchmark automatically.

## Local and CI verification

Install the root and storefront dependencies separately, then run:

```sh
npm test
npm --prefix apps/storefront run typecheck
```

`.github/workflows/performance.yml` runs the tests, verifies cache behavior with
an empty disposable Redis 7 service, starts the synthetic HTTP fixture on
`127.0.0.1:9901`, and builds the storefront against it. The fixture never forwards
requests and uses only inline test images. The CI font hook returns local-font
CSS, so the build does not need Google Fonts. Dependency installation still uses
the normal package registries. Production credentials and production catalog
data are not required.

For a local fixture server:

```sh
node apps/storefront/tests/fixtures/mock-store-api.cjs
```

Set `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://127.0.0.1:9901` and
`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_local_fixture_only` before building. For an
offline fixture build, set `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` to the absolute
path of `apps/storefront/tests/fixtures/google-fonts.cjs`. **Do not set that font
test hook in a deployment.** Set `NEXT_TELEMETRY_DISABLED=1` for local/CI checks.

Fixture-only controls make freshness tests repeatable:

- `GET /__audit/health` confirms the fixture is ready.
- `GET /__test/status` returns content/stock revisions and per-route request counts.
- `POST /__test/revision` with `{"revision":1}` changes only the footer content.
  An optional `"stockRevision":2` independently changes stock quantities.
- `GET /__audit/metrics` exposes fixture request paths and requested product fields.

The optional `tests/cache-redis.integration.cjs` test requires an explicit
`TEST_REDIS_URL` pointing to an empty disposable database. It never falls back
to the application Redis configuration. Do not point it at a deployed cache.

## Freshness and deployment boundaries

Product and variant workflow/module events coalesce before repairing only affected
card metadata and invalidating product/catalog data. Deleted variants recover
their parent from soft-deleted records. Unknown parents trigger one paginated
repair. Inventory events invalidate the stock domain, without recalculating prices.
Custom admin writes invalidate their own data domains; raw image uploads do not
publish a change. Case-type repricing repairs the card data before it completes.

The event queue is bounded and serial. Failed batches retain their IDs and retry
after a minute. It is process-local: restarting a worker can lose a pending batch.
After an interrupted import, use the existing admin **Refresh storefront** action;
data TTLs remain a fallback. A multi-worker rollout needs a durable shared outbox
and a distributed lease for the warmer. Standalone pricing-module integrations
must also publish a covered product/variant event or invoke storefront refresh.

A missing/evicted Redis freshness registry changes its generation, invalidating
surviving older values safely. This introduces one lazy cache refresh when first
released. Subsequent builds keep compatible data; route HTML stays build-scoped.
API refresh reports failure if Redis cannot acknowledge it. Customer cart actions
continue when cache invalidation is temporarily unavailable, and the handler
bypasses cached reads until its pending invalidations are acknowledged.

Deploy this branch only to the verified `new.florayn.com` storefront and
`api.new.florayn.com` backend. Its HTML should bypass the old six-hour forced
Cloudflare document cache so Next can honor content changes. Static assets and
images retain their separate cache behavior. Never purge the whole Cloudflare zone
or change `florayn.com` as part of this deployment.
