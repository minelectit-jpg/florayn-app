# Product page content and reviews

Read before changing product selectors, content or reviews. Applies to new.florayn.com only.

## Presentation

- Keep the original shared ProductView layout and its measured sticky right column.
- More designs shows four complete thumbnails and a partial fifth at narrow mobile widths, with native horizontal scrolling. Desktop keeps 108px thumbnails.
- Case products show Model, More designs, then Case type. The model control has a 44px minimum height.
- On mobile and desktop, four case-type image/name/price tiles occupy a row; more types scroll horizontally. Keep unsupported pairs disabled and preserve exact variant IDs, live stock and case-type pricing. Regular products keep their option swatches.
- Bundle/pack remains opt-in, with the existing Admin-controlled badge. Its mobile cards are compact; estimated prices stay labelled estimates, and savings remain bold purple.
- Top of the details column, every breakpoint: star rating + "N Reviews" (links to and opens the Reviews row), the title, the price, then one live line "In stock | <delivery estimate>". On phones the title stays on one line: its size comes from its length (`--title-chars`, set server-side from the design name and longest model, so a model change never resizes it) and only the design name may truncate, never the model. Stock uses the buy box's refreshed stock; the estimate is Admin > Product delivery copy and never shows beside "Sold out".
- Product only / Bundle is one connected tab bar with centred uppercase labels (our purple for the active tab and the badge). In bundle mode the panel hangs off the bar.
- Recommended products and "We think you'll love" use the shop card (`.fl-card`) in a swipe rail: one item is one full-width card, two or more sit two to a phone screen. A model change must update image, price, destination and cart variant together; the link is a stretched sibling of the buttons.
- Share and Pairs well with are removed. Do not restore them.
- Everything below the purchase buttons is one bordered list of native disclosures (`.fl-acc`), closed by default: Description, Reviews, Delivery (Admin heading), Product details, Good to know (FAQs). Rows appear only with content. All copy, including collapsed answers and reviews, is in server HTML; no client-only SEO content, no link or button inside a summary.
- The Reviews row carries `id="customer-reviews"` (the sign-in return link depends on it) and opens itself for any link to that anchor. Never invent ratings, reviews, verified-purchase badges or review counts: with no reviews the stars stay hollow beside "No reviews yet", and a failed review read shows no summary.
- Phone spacing is compressed with mobile-first utility pairs that restore the desktop values at `md:`; keep that pattern.

### Buy buttons

These are set in Admin > Buy buttons (`buy_box` in `florayn_presentation`).
The logic is in `lib/buy-box.ts` and the tests are in `tests/buy-box.test.cjs`.

- **Layout.** One row holds the quantity stepper (44px buttons), Add to cart
  and the wishlist heart. Below it, Buy it now fills the width.
  - Purple means only the buy action. Buy it now is the one filled button and
    shows the price times the quantity ("Buy it now · 1,400.00৳"). That is the
    plain goods total; pack savings are applied at checkout.
  - Add to cart is outlined, or filled ink as on florayn.com.
  - A working button keeps full colour with a spinner; it never fades.
- **One action at a time.** Add to cart, Buy it now and the bar share one busy
  guard. Tapping Buy it now after Add to cart on the same case goes straight
  to checkout, so there is never a second copy in the bag (`buyNowQuantity`).
  The + button stops at live stock.
- **Lines under the buttons** (`BuyAssurance`) are in the server HTML.
  - They are each Product delivery card's "Line under the buy buttons" (at
    most 3), plus the Bundles free-delivery line ("{amount}" is the minimum).
  - They show under Buy it now, or under the pack button in bundle mode.
- **Quick-buy bar** (`product-buy-bar.tsx`), below 1024px only.
  - It appears once the buttons have scrolled under the header. One
    IntersectionObserver drives it: no scroll listeners, no portal and no
    `ssr:false`.
  - It sits in place inside the details panel. That is safe only while the
    panel is sticky just from 1024px up.
  - It is hidden in bundle mode and while typing.
- **Sold out.** Buy it now makes way for up to three in-stock case types for
  the same model, one tap each, at the same height. With none in stock it
  shows "Choose another model", which opens the model list. No invented
  urgency or scarcity, ever.

## Editing

Admin > Product delivery edits the delivery line under the price (`estimate`,
up to 60 characters, one line, blank hides it; default "Delivery in 1–3 business
days") and the Delivery row of the information list: heading (the row title),
enabled state, icons, card copy/order, and the optional help link. Empty cards or
disabled state hide the row. These are display messages, not checkout rate
controls; keep them consistent with Checkout settings and the home/contact copy.

Admin > Footer edits brand/tagline, support copy/link, social links/order,
copyright (supports {year}), and location note. Existing Footer links controls
still manage ordered columns and links. Mobile columns collapse independently;
desktop shows all links. All text is rendered safely as text, with validated
navigation URLs. Both settings sections live in store metadata under
`florayn_presentation`, use the core store update workflow, and invalidate the
existing content cache domain. No migration is needed. Frontend/backend
`storefront-presentation.ts` contracts must stay identical (covered by a test).

Product Manager > open a product > Product page content edits headings, the review introduction, information rows and FAQs. The existing Description editor updates main copy. Choose the product form (phone, AirPods etc.) to customize its information/FAQ separately; all models of that form use it.

Metadata key: florayn_product_content. Null facts/FAQs means automatic defaults, [] intentionally hides that section. Limits: 16 information rows, 12 FAQs; plain text only, safely escaped in React. The core saveProductContentWorkflow merges other metadata and retains product/variant IDs. Existing product invalidation covers these writes.

Standard FAQs cover option selection, COD, checkout delivery calculation and support without inventing product materials or shipping promises. Product-specific answers can replace them. Google retired FAQ rich results in May 2026, so this feature provides useful crawlable content, not a rich-result or ranking promise:
https://developers.google.com/search/updates#may-2026

## Reviews and moderation

Signed-in customers submit a 1–5 rating, display name, title and body. Server authentication supplies the customer ID; client-supplied moderation/identity fields are ignored. New entries are pending. Only approved entries and merchant replies are returned publicly. No customer ID or email is projected. One review per customer per design (or regular product), enforced by a unique partial database index; up to 10 submissions/customer/day. No purchase-verification claim.

Design reviews pool by design_slug across models and product forms; regular products use product ID. Admin > Product reviews provides the pending queue, published/hidden filters, approval/hiding and public replies. The same panel appears in Product Manager. Customer wording/ratings are preserved. Hiding can be reversed by approval. Disabling reviews on a product hides the section and blocks its public read/submission.

Content module product_review is separate from public product metadata: pending reviews and customer IDs never enter public catalog payloads. Public pages read six reviews at a time; five bounded count queries calculate the real overall rating/distribution. Admin lists 20 at a time. Content cache invalidation covers moderation/replies; new pending submissions need no public invalidation.

## Migration and verification

Migration20260923090000 creates only product_review and its three indexes. Apply through src/scripts/migrate-product-reviews.ts after its read-only preflight; it permits only this migration on florayn_v3 or the disposable checkout/contact test database. No seeds or unrelated migrations. The migration is additive; do not drop customer reviews during normal rollback.

Root npm test includes content validation, escaping, SSR FAQ visibility, review privacy, published/enabled checks, bounded aggregates and auth middleware. verify-product-manager-isolated.ts exercises real Medusa content saves, pending/approval/hiding/replies, persisted ratings, and duplicate constraints on disposable Postgres. Never create reviews or customer accounts on the deployed store for QA.

The optional UI_REFINEMENT_FIXTURE supplies synthetic local reviews, five case types, customer sign-in and Admin content endpoints. Its responses never contact a real service or send email.
