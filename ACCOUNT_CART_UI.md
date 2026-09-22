# Account, bag and product layout guardrails

- Apply storefront changes only to `new.florayn.com`; never change the live `florayn.com` store.
- Account login and account creation share the existing email-code flow. Preserve server-side verification, httpOnly customer cookies, request cooldown and no-store customer reads. Never expose tokens or store profile/address drafts in browser storage.
- Account order amounts and statuses come from the server. Do not invent shipment tracking, loyalty points or delivery guarantees. The current wishlist is saved on the shopper's device, not synchronized to their account.
- Cart quantities use one React transition around the existing server action. That action revalidates `/cart`; do not add a competing `router.refresh()` after it. Keep controls disabled through the update and show failed actions clearly.
- Bag subtotal is goods only (`getCart()` normalizes Medusa `item_subtotal`). Delivery and the final payable quote belong to checkout. Preserve the existing bundle calculation, exact variant IDs and selected thumbnails.
- Desktop product details use `ProductDetailsSticky`: short panels pin below the header; tall panels scroll until their bottom is visible, then stay while the left content scrolls. Re-measure with ResizeObserver after bundle/tab/viewport changes. Keep dialogs portalled outside this sticky stacking context.
- Shop model choices stay within the current device family/form. iPhone and Samsung share `phone`; all AirPods models, including Max, share `airpods`. Do not mix Watch, Wallet or future families into other shops.
- Mobile product cards place the case type below the model. Keep the approved compact filter toolbar and let long values wrap. Test 320px and 390px, including quantity/remove controls in the bag.
- Bundle badge text remains controlled through Admin > Bundles. Purple savings messages display the actual calculated amount, retaining “Estimated” until selection is complete.

## Verification

Run root `npm test`, storefront typecheck/production build, and the existing full CI (including isolated checkout integration). `shop-model-scope.test.cjs` renders the actual selector with mixed device families to protect category isolation.

For local browser QA, `UI_REFINEMENT_FIXTURE=1 node apps/storefront/tests/fixtures/mock-store-api.cjs` enables disposable account fixtures as well as products/carts. Use `shopper@example.invalid` and code `123456`; any other six-digit code fails. The local fixture never sends email or forwards to real services. Verify profile/address changes, sign-out, empty/populated cart, quantity increases/decreases, savings, checkout handoff, and mobile overflow. Do not use a real customer/order for these checks.
