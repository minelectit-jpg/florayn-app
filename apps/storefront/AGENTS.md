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

- `product/[slug]` - slug is the Medusa product `handle`, which is
  `<design-slug>-<case-type-slug>`.
- `collection/[slug]` - resolves a Medusa collection by handle first, then falls
  back to a product category with the same handle.

## Data

- `src/lib/medusa.ts` - the JS SDK client and the shared product field list.
  Prices are region-scoped, so every product query needs `region_id`.
- `src/lib/catalog.ts` - the custom `/store/designs`, `/store/devices` and
  `/store/case-types` routes the backend's catalog module adds.
- `src/lib/cart.ts` - server actions; the cart id lives in an httpOnly cookie.

Every backend call needs `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `.env.local`.
Without it requests fail with a publishable-key error, not an obvious 401.

## Variants are devices

A product is one design in one case type; its variants are the devices that case
type fits. Build device pickers from `product.variants`, never from the full
device list - variants already encode compatibility.
