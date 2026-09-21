import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { ensureOps } from "../lib/order-ops"

/**
 * Give every newly placed order a workflow row (default `processing`) so it
 * appears in the order manager immediately. Historical orders are covered by
 * the one-off /admin/order-ops/backfill. Idempotent - safe if it runs twice.
 */
export default async function orderOpCreate({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data?.id
  if (!orderId) return
  try {
    await ensureOps(container, [orderId])
  } catch {
    // Never let bookkeeping fail order placement.
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "florayn-order-op-create" },
}
