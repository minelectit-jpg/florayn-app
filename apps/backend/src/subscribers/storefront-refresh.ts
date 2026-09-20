import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { queueStorefrontEvent, storefrontEventNames } from "../lib/storefront-events"

export default async function storefrontRefresh({ event, container }: SubscriberArgs<unknown>) {
  // Medusa's Redis event worker is serial by default. Waiting for the debounce
  // here would block every following event and prevent actual coalescing.
  queueStorefrontEvent(container, event.name, event.data)
}

export const config: SubscriberConfig = {
  event: storefrontEventNames,
  context: { subscriberId: "florayn-storefront-refresh" },
}
