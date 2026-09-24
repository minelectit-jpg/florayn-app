# florayn.com orders and customers

Order Manager has two views, Orders and Customers. It also has "Import from
florayn.com", which copies florayn.com's WooCommerce order history into this
store.

## The import (`lib/florayn-import.ts`)

- **It only reads florayn.com**, through the WooCommerce REST API v3 with a
  Read key. The owner creates the key under WooCommerce > Settings > Advanced
  > REST API and pastes it into the drawer.
  - The key is stored in the `order_import` row. The secret is never returned.
  - The key goes in the Basic auth header. If the host strips that header, it
    goes as query parameters instead (HTTPS only).
- **Orders are written with the Order module's `createOrders`.**
  - Not with `createOrderWorkflow`, which checks stock and adds tax and
    promotion steps.
  - So no stock is touched, no event fires, and no email is sent.
  - Line prices are the WooCommerce line totals. Delivery and fees keep their
    WooCommerce amounts. A negative fee becomes a credit line.
- **The total is what the customer paid (`paidAmounts`), not WooCommerce's
  `total`.**
  - florayn.com's order manager keeps a bKash advance
    (`_otm_advance_paid_amount`, `_advance_paid_amount`,
    `_florayn_qo_advance`) and the courier COD (`_otm_courier_cod_amount`)
    apart from `total`. After a full advance, `total` was often 0 or only the
    delivery charge.
  - Paid = COD + advance. Without a courier booking, it is `total` (plus the
    advance when `total` is only the remainder).
  - Any remaining difference from items + delivery becomes "Price adjustment
    on florayn.com": a credit line when less was paid, an extra line when more
    was. The order also gets `metadata.total_adjusted`.
  - These differences come from a hand-set bundle price, a changed delivery
    charge or a free replacement. About 32 of 1104 orders have one.
  - `metadata` keeps `advance_paid`, `cod_amount`, `payment_method` and
    `tracking_code` / `consignment_id` (Steadfast). The order drawer shows
    them.
- **Customers** are matched by real email, else by mobile.
  - A phone-only order is stored under `<phone>@no-email.florayn.local`, the
    same placeholder checkout uses. So a phone's old and new orders share one
    customer.
  - An account with that email is preferred.
- **Statuses** map through `STATUS_MAP`. Drafts are not imported.
  - completed / otm-delivered become delivered.
  - otm-confirmed / printing / printed become confirmed.
  - otm-in-transit becomes shipped.
  - otm-returned becomes returned.
  - cancelled / failed become cancelled.
- **An imported order keeps its florayn.com date and number.**
  - The date is set in `order.created_at` and `order_op.created_at`.
  - The number is in `metadata.wc_order_number`; search finds it.
- **Imported orders are marked `order_op.source = "florayn.com"`.** They were
  handled there, so courier send refuses them and review requests skip them.
- **Running it again** uses `imported_order` (WooCommerce id to order).
  - New orders are added and changed statuses are moved.
  - Nothing is duplicated.
  - A run whose server restarted carries on where it stopped.
- **Raise `IMPORT_VERSION` when the mapping changes.** The next run then
  rebuilds every older import.
  - The new order is written with the old `display_id`.
  - The `order_op` row (status, note) and the `imported_order` row move to the
    new order.
  - Then the old copy is deleted, and the order number sequence is set after
    the highest number.
  - The drawer shows how many imports are outdated.
- **Products are matched by name** (`lib/florayn-import-match.ts`), because
  florayn.com sold every design-and-model as its own product.
  - "Design - Model Case" goes to the design's product (the AirPods product
    for an AirPods model), and the model to its Device option.
    "Samsung Galaxy S25" is the same model as "Samsung S25".
  - "Black - StickPad Pro" matches the StickPad's Colour option.
  - "Beige Leather Chain Phone Charm" matches with no dash.
  - About 98.6% of lines match.
  - `variant_id` is set only when the line names exactly one variant.
    Otherwise `metadata.device` holds the model.
  - Matched lines use our R2 images. An unmatched line (a discontinued design
    such as "Linea") keeps florayn.com's image URL, which breaks once
    florayn.com is gone.
- **In the order drawer, every item links to its product page.**
  - The link carries `?variant=` or `?device=` (see `itemProductUrl`).
  - The product page honours both, plus `?case=`.

## Customers (`/admin/customer-list`)

- The list shows everyone with an order, newest order first: name, mobile,
  real email, order count and spend.
- Spend leaves out cancelled and returned orders; it uses
  `order_summary.totals.current_order_total`.
- Clicking a customer opens the Orders view, searched by their mobile.
- Order search runs on the server across every order: number, florayn.com
  number, name, phone, email and tracking code (`searchOrderIds` in
  `lib/order-ops.ts`).
