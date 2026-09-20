import {
  InventoryEvents,
  InventoryItemWorkflowEvents,
  InventoryLevelWorkflowEvents,
  Modules,
  ProductCategoryWorkflowEvents,
  ProductCollectionWorkflowEvents,
  ProductEvents,
  ProductOptionWorkflowEvents,
  ProductVariantWorkflowEvents,
  ProductWorkflowEvents,
  ReservationItemWorkflowEvents,
} from "@medusajs/framework/utils"

import { rebuildCards } from "./rebuild-cards"
import { queueStorefrontRevalidation } from "./revalidate-storefront"

type Kind = "product" | "variant" | "option" | "catalog" | "stock"
const kinds = new Map<string, Kind>()
function events(names: Record<string, string>, kind: Kind, prefix?: string) {
  for (const [key, name] of Object.entries(names)) {
    if (!prefix || ["CREATED", "UPDATED", "DELETED", "RESTORED", "ATTACHED", "DETACHED"].some((action) => key === `${prefix}_${action}`)) {
      kinds.set(name, kind)
    }
  }
}
events(ProductWorkflowEvents, "product")
events(ProductVariantWorkflowEvents, "variant")
events(ProductOptionWorkflowEvents, "option")
events(ProductCollectionWorkflowEvents, "catalog")
events(ProductCategoryWorkflowEvents, "catalog")
events(ProductEvents, "product", "PRODUCT")
events(ProductEvents, "variant", "PRODUCT_VARIANT")
events(ProductEvents, "option", "PRODUCT_OPTION")
events(ProductEvents, "catalog", "PRODUCT_COLLECTION")
events(ProductEvents, "catalog", "PRODUCT_CATEGORY")
events(InventoryEvents, "stock")
events(InventoryItemWorkflowEvents, "stock")
events(InventoryLevelWorkflowEvents, "stock")
events(ReservationItemWorkflowEvents, "stock")

export const storefrontEventNames = [...kinds.keys()]

type Batch = {
  container: any
  products: Set<string>
  variants: Set<string>
  options: Set<string>
  tags: Set<string>
  rebuildAll: boolean
}
let pending: Batch | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
const MAX_PENDING_IDS = 5000

function schedule(wait = 500) {
  if (timer !== undefined || running || !pending) return
  timer = setTimeout(() => { void flush() }, wait)
}

function boundIds(batch: Batch) {
  if (batch.rebuildAll || batch.products.size + batch.variants.size + batch.options.size > MAX_PENDING_IDS) {
    batch.rebuildAll = true
    batch.products.clear()
    batch.variants.clear()
    batch.options.clear()
  }
}

async function flush() {
  timer = undefined
  const batch = pending!
  pending = undefined
  running = true
  let retryAfter = 500
  try {
    if (!batch.rebuildAll && (batch.variants.size || batch.options.size)) {
      const products = batch.container.resolve(Modules.PRODUCT)
      for (const [ids, list] of [
        [batch.variants, products.listProductVariants.bind(products)],
        [batch.options, products.listProductOptions.bind(products)],
      ] as const) {
        const values = [...ids]
        for (let offset = 0; offset < values.length; offset += 100) {
          const part = values.slice(offset, offset + 100)
          // Medusa's core deletion workflows soft-delete these records, so
          // parent product IDs remain available after the deletion event.
          const rows = await list({ id: part }, {
            select: ["id", "product_id"], withDeleted: true, take: part.length,
          })
          const found = new Set<string>()
          for (const row of rows) {
            if (row.product_id) {
              found.add(row.id)
              batch.products.add(row.product_id)
            }
          }
          // A hard deletion or unusual module event may lack a recoverable
          // parent. One coalesced, paginated pass repairs those orphaned cards.
          if (part.some((id) => !found.has(id))) batch.rebuildAll = true
        }
      }
    }
    if (batch.rebuildAll) await rebuildCards(batch.container)
    else if (batch.products.size) await rebuildCards(batch.container, { productIds: [...batch.products] })
    const delivered = await queueStorefrontRevalidation({ tags: [...batch.tags] })
    if (!delivered) throw new Error("Storefront event refresh could not be delivered")
  } catch {
    // Preserve failed work and merge events received during this pass. Retry
    // once per minute after bounded delivery attempts, without blocking Medusa's
    // serial event worker or retaining one unresolved promise per event.
    const newer = pending as Batch | undefined
    if (newer) {
      for (const key of ["products", "variants", "options", "tags"] as const) {
        for (const value of newer[key]) batch[key].add(value)
      }
      batch.rebuildAll ||= newer.rebuildAll
    }
    boundIds(batch)
    pending = batch
    retryAfter = 60_000
    console.warn("[storefront-refresh] event batch failed; pending changes retained for retry in 60s")
  } finally {
    running = false
    schedule(retryAfter)
  }
}

/** Merge workflow/module events before rebuilding cards and expiring readers. */
export function queueStorefrontEvent(container: any, name: string, data: unknown): void {
  const kind = kinds.get(name)
  if (!kind) return
  const batch = pending ??= {
    container, products: new Set(), variants: new Set(), options: new Set(), tags: new Set(),
    rebuildAll: false,
  }
  if (kind === "stock") {
    // Blank inventory is a separate fetch; orders need not expire the catalogue.
    batch.tags.add("stock")
  } else {
    batch.tags.add("products")
    batch.tags.add("catalog")
    if (!batch.rebuildAll && kind !== "catalog" && !(kind === "product" && name.endsWith(".deleted"))) {
      const records = Array.isArray(data) ? data : [data]
      for (const record of records) {
        const id = record && typeof record === "object" ? (record as { id?: unknown }).id : undefined
        if (typeof id !== "string") batch.rebuildAll = true
        else if (kind === "product") batch.products.add(id)
        else if (kind === "variant") batch.variants.add(id)
        else batch.options.add(id)
      }
    }
  }
  boundIds(batch)
  schedule()
}
