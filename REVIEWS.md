# Reviews, review requests and rewards

This rebuilds florayn.com's florayn-core review hub (`review-requests.php`,
`review-rewards.php`) on Medusa. It lives in Admin > Reviews, which has four
tabs: All reviews, Review requests, Coupon rewards and WhatsApp.

A phone-only order (no email at checkout) is stored with the email
`<phone>@no-email.florayn.local` (`workflows/checkout-service.ts`). Never mail
it. Read customer emails through `realEmail()` in `lib/contact.ts`, which
returns null for that placeholder. Mobiles go through `bdMobile()`, which
gives the `8801XXXXXXXXX` form that WhatsApp uses.

## Settings

- The programme is stored in the store's metadata under
  `florayn_review_program`. Code: `lib/review-program.ts`.
- Defaults match florayn.com:
  - 15% off for a review with photos, 10% for text only;
  - codes valid for 60 days;
  - one code per email every 30 days;
  - 3 photos per review;
  - requests sent 4 days after the order is `delivered`, 40 emails a day,
    orders at most 120 days old.
- Request emails start **off**. Switching them on stamps `started_at`, and
  orders that reached the status before that are never mailed. This matches
  florayn.com's "skipped-backlog".
- Reviews are held for approval unless the owner picks "Publish reviews
  immediately".

## Request emails

- `jobs/review-requests.ts` runs hourly. It picks `order_op` rows in a chosen
  status that have waited `delay_days` since `status_changed_at`.
  - Every place that changes `workflow_status` stamps `status_changed_at`: the
    admin, courier send, courier sync and the Steadfast webhook.
  - The daily limit counts `review_request_sent_at` over the last 24 hours.
- Each order is asked once, by email and/or WhatsApp (see below).
  - `order_op.review_request_channel` records how it went.
  - An order that could not be reached, or has nothing to review, is
    recorded with a note and leaves the queue.
- Orders imported from florayn.com (`order_op.source`) are never asked
  automatically.
- The email copy is florayn.com's word for word (`lib/review-emails.ts`). A
  star link is `/product/<handle>/?review=<token>&r=<1-5>#customer-reviews`.
- The token is an HMAC over the order id, signed with `JWT_SECRET`
  (`lib/review-links.ts`). It lets that order's customer review what they
  bought, without signing in, as a verified buyer. It is not accepted for any
  other product.

## Submitting a review

- `POST /store/product-reviews` takes either a signed-in customer or a
  `token`.
- The headline is optional and the text needs 2 or more characters.
- Photos:
  - The browser shrinks each photo to 1600px, then a Server Action (4 MB limit)
    sends it to `POST /store/product-reviews/photos`.
  - The backend checks the file's bytes, and it must be a JPEG, PNG or WebP of
    8 MB or less.
  - It is stored in R2 under `reviews/`. A review may only reference URLs
    under that prefix.
- The product page's review form opens by itself from a request link. It picks
  the stars, fills in the name, then removes the token from the address bar.

## Rewards

- `issueReviewReward` in `lib/review-rewards.ts` runs when a review is
  published: on submit when reviews are published immediately, or when the
  admin clicks Publish.
- It creates one Medusa promotion per review:
  - code `REV` + 6 characters, percentage off the order;
  - `limit: 1`, expiring through its own campaign's `ends_at`.
- The code is mailed to the reviewer, and also shown in the thank-you when the
  review goes live at once.
- The reason a review earned no code (cooldown, rating, no email) is saved on
  the review.
- The checkout has a "Have a discount code?" field
  (`components/promo-code.tsx`). It uses Medusa's cart promotion routes, and
  the quote keeps shopper codes alongside the bundle codes (`BUNDLE-`,
  `FREESHIP-`).
- Unlike florayn.com, the coupon email does not claim the code is locked to an
  email address. Checkout email is optional here, so it could not be.

## WhatsApp

Customers who ordered with only a phone number get their review request and
their code on WhatsApp.

- **Sending by hand works today, with no setup.** The "WhatsApp" buttons on
  the request queue, log and search, and "Send on WhatsApp" on codes not sent
  yet, open a wa.me link to that customer's chat with the message already
  typed. The admin then sends it from the shop's own WhatsApp.
  - The message text is editable on the Review requests and Coupon rewards
    tabs.
  - Sending a request this way records it as "whatsapp by hand".
- **Automatic sending** uses the WhatsApp Business Platform (Meta Cloud API).
  - The connection lives in the `whatsapp_settings` row, set on the WhatsApp
    tab. The token is shown masked only.
  - `lib/whatsapp.ts` sends template messages. `lib/review-whatsapp.ts` holds
    the two templates, `florayn_review_request` and `florayn_review_reward`.
    Both are Marketing templates.
  - "Submit templates to Meta" creates both. Meta must approve them before
    anything sends.
  - The request's button opens `/review/<token>` on the storefront. For one
    product it goes straight to that product's review form; for more, it
    lists them.
  - The button URL holds the shop's address. After the move to florayn.com,
    submit the request template again under a new name.
- **Who gets WhatsApp** is set by the Review requests tab ("Ask on WhatsApp"):
  - only orders without an email (the default);
  - every order, as well as the email;
  - never.
  - Codes go on WhatsApp only when the reviewer has no email.
- If WhatsApp is not connected:
  - a phone-only order is recorded "no email; WhatsApp not connected" and
    leaves the queue;
  - a phone-only reviewer's code is still created, and it waits on Coupon
    rewards for "Send on WhatsApp".
- The cooldown counts by email and by mobile (`product_review.phone`).

## Imports

- `import-florayn-reviews-2026-09-24` imports florayn.com's six published
  reviews.
- `florayn-review-photos-2026-09-25` adds their photos (copied to
  `reviews/florayn/`) and WooCommerce's verified marks.
