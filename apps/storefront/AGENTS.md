# AGENTS.md - storefront

## This app is not an npm workspace member

It has its own `node_modules` and `package-lock.json`. Medusa's admin peers on
React 18; Next 15's App Router needs React 19. npm workspaces hoist one React
for the whole tree, and React 19 renamed its element symbol from
`react.element` to `react.transitional.element`, so a hoisted React 18 renderer
cannot render React 19 elements - the production build dies on `/404` with
React error #31. Two installs is the fix.

- Install here: `npm --prefix apps/storefront install <pkg>` or `cd` in first.
- Never add this app back into the root `workspaces` array.

## Routes

`/product/<slug>/` and `/collection/<slug>/` are contractual URLs, including the
trailing slash (`trailingSlash: true` in `next.config.ts`). Do not restructure
them, and do not add a country-code or locale segment.

- `product/[slug]` resolves an exact Medusa handle first, then a compatible
  `<product-handle>-<device-slug>` URL. Keep the combined, memoized resolution in
  `device-page.ts`; metadata and the page must not repeat the same backend read.
- `collection/[slug]` - resolves a Medusa collection by handle first, then falls
  back to a product category with the same handle.

## Data

- `src/lib/medusa.ts` - the JS SDK client and the shared product field list.
  Real prices are region-scoped. Metadata/ID-only reads must explicitly opt out
  with `{ pricing: false }`: Medusa 2.19 adds variant pricing whenever `region_id`
  is present, even if calculated-price fields were omitted.
- `src/lib/catalog.ts` - the custom `/store/designs`, `/store/devices` and
  `/store/case-types` routes the backend's catalog module adds.
- `src/lib/cart.ts` - server actions; the cart id lives in an httpOnly cookie.

Every backend call needs `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `.env.local`.
Without it requests fail with a publishable-key error, not an obvious 401.

## Variants encode device and case-type compatibility

A phone-case product currently groups one design with multiple case types and
devices. Its variants represent sellable device/case-type pairs. Build valid
selections from those variants, never a Cartesian product of the full catalogs.
Regular products and device-dependent Alcantara prices must retain real pricing.

## Performance and freshness gates

Read root `PERFORMANCE.md` before changing product data, cache behavior or adding
browser payload. Run root `npm test` and production builds before deployment.
The CI workflow also verifies actual Next.js behavior with disposable Redis.

- Share repeated related-design data through `product-view-data.ts`; do not send
  another full device/case map for each carousel or pack component.
- Preserve exact variant IDs, regional amounts, images, selector fallbacks and
  mixed-device pack behavior when reducing data. Do not split the catalog merely
  to work around an overbroad query.
- Tag every cached fetch with its domain and connect new admin mutations to
  invalidation. Raw uploads do not publish product changes. Document new
  integrations that bypass the existing Medusa product workflows/events.
- Use `npm run perf:check` for sequential HTTP checks and the opt-in `#perf`
  browser panel for document LCP/navigation readiness. HTTP response time is not
  a complete page-load measurement. Do not raise payload budgets without evidence.
- The current deployment branch is `codex/durable-performance`, targeting only
  `new.florayn.com` and `api.new.florayn.com`. Keep `florayn.com` unchanged.
