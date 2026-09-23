# Product page content and reviews

Read before changing product selectors, content or reviews. Applies to new.florayn.com only.

## Presentation

- Keep the original shared ProductView layout and its measured sticky right column.
- More designs shows four complete thumbnails and a partial fifth at narrow mobile widths, with native horizontal scrolling. Desktop keeps 108px thumbnails.
- Case products show Model, More designs, then Case type. The model control has a 44px minimum height.
- On mobile and desktop, four case-type image/name/price tiles occupy a row; more types scroll horizontally. Keep unsupported pairs disabled and preserve exact variant IDs, live stock and case-type pricing. Regular products keep their option swatches.
- Bundle/pack remains opt-in, with the existing Admin-controlled badge. Its mobile cards are compact; estimated prices stay labelled estimates, and savings remain bold purple.
- Recommended products use a compact horizontal card on mobile and vertical cards on desktop. A model change must update image, price, destination and cart variant together.
- Share and Pairs well with are removed. Do not restore them.
- Description and information use native disclosures, with visible product FAQ disclosures below. Their content is rendered in server HTML, including collapsed answers; no client-only SEO content.
- Reviews are a separate visible section, linked directly below the product title. Never invent ratings, reviews, verified-purchase badges or review counts.

## Editing

Admin > Product delivery edits the shared delivery cards below purchase actions:
heading, enabled state, icons, card copy/order, and the optional help link. Empty
cards or disabled state hide the section. These are display messages, not
checkout rate controls; keep them consistent with Checkout settings.

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
