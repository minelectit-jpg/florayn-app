# Contact page maintenance

The Contact page and its Medusa admin belong to `new.florayn.com` and
`api.new.florayn.com`. This work does not modify the separate live store at
`florayn.com`. The confirmation page's **Back to shop** and **Continue shopping**
links deliberately navigate directly to `https://florayn.com/`, as requested by
the owner. Keep the checkout's Back to bag link pointing to its local cart.

## Content and editing

Admin **Contact** (`/app/contact`) edits page introduction, phone/email, their
labels and notes, multiline address, FAQ introduction, ordered FAQ rows and
the closing support message. Blank contact values hide their cards; an empty
FAQ list hides the FAQ section. Each question has a stable ID and can be added,
removed or moved up/down. Save errors retain the draft.

The content module owns one `contact_setting` record with ID
`contactset_default`. Reads return the defaults without creating rows; the
first save persists the singleton. Admin GET/POST `/admin/contact-settings`
requires admin authentication, and POST validates again in its workflow.
Store GET `/store/contact-settings` returns only the public display fields.
Use plain text, bounded strings, safe normalized phone/email values, and at
most 30 FAQs. Do not render editor content as HTML.

Defaults preserve the Contact page's existing business details and policies.
FAQ copy describes policies; it does not change shipping prices, bundle rules,
payment providers or exchange logic. Keep this copy consistent when business
rules change. Checkout's separate support settings and footer content remain
their own existing editor fields; editing Contact does not silently overwrite
them.

## Rendering and freshness

The page is server rendered with a 60-second revalidation window. Metadata and
the page share `getContactSettings` through React cache. Its one small fetch is
tagged `content` and `content:contact`. A save queues only `content:contact`
invalidation; do not clear product, catalog, checkout or entire-layout caches.
An endpoint outage uses existing safe defaults and bounded revalidation.
Explicit blank fields and an empty FAQ list must not reappear as defaults.

FAQs use native details/summary, so they work without a new client bundle.
The first answer is open by default. Modern browsers support a single open
answer through the details name attribute; other browsers retain usable
independent disclosures. Preserve keyboard operation, focus indicators,
text wrapping and mobile layout. Contact buttons use tel/mailto; the page does
not send messages or claim to have sent one.

## Migration and verification

The generated migration `Migration20260921064114` adds only the Contact table
and its index to the existing content module. Use
`medusa exec ./src/scripts/migrate-contact-settings.ts` for read-only preflight,
then the same command with `apply Migration20260921064114` to apply exactly
this migration. The helper verifies the table and recorded migration and is
idempotent. Do not run broad production migrations or seed routines for this
feature, including unrelated OTP/account migrations.

Root `npm test`, storefront typecheck, backend/admin build and storefront build
must pass. CI verifies saved Contact values and ordered/empty FAQs in a
disposable Medusa/PostgreSQL instance, then checks the scoped migration helper.
The actual Next.js/Redis test verifies a Contact edit refreshes that page while
unrelated data remains cached. All integration resources must be disposable;
never use production orders, emails or payments for QA.
