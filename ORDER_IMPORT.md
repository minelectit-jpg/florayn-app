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
  - Line prices are what the customer paid (the WooCommerce line total).
    Delivery and fees keep their WooCommerce amounts. A negative fee becomes a
    credit line.
  - An order whose total differs by 1 taka or more carries
    `metadata.total_mismatch`.
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
- **Products** are linked by WooCommerce slug = our handle, for the thumbnail
  and review links.
  - An unmatched line keeps florayn.com's image URL. That URL breaks once
    florayn.com is gone.

## Customers (`/admin/customer-list`)

- The list shows everyone with an order, newest order first: name, mobile,
  real email, order count and spend.
- Spend leaves out cancelled and returned orders; it uses
  `order_summary.totals.current_order_total`.
- Clicking a customer opens the Orders view, searched by their mobile.
- Order search runs on the server across every order: number, florayn.com
  number, name, phone, email and tracking code (`searchOrderIds` in
  `lib/order-ops.ts`).
