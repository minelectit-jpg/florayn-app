import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { ORDER_OPS_MODULE } from "../modules/order-ops"

/**
 * The order-management workflow. These back the admin tabs and are the source
 * of truth for where an order sits, independent of Medusa's own order.status.
 *
 *   processing -> confirmed -> shipped -> delivered
 *                                      \-> returned
 *   (refunded / cancelled are terminal side states set by the merchant)
 */
export const WORKFLOW_STATUSES = [
  "processing",
  "confirmed",
  "shipped",
  "delivered",
  "returned",
  "refunded",
  "cancelled",
] as const

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

export const DEFAULT_STATUS: WorkflowStatus = "processing"

export type OrderOpRow = {
  id: string
  order_id: string
  workflow_status: WorkflowStatus
  steadfast_consignment_id: string | null
  steadfast_tracking_code: string | null
  steadfast_status: string | null
  steadfast_synced_at: string | null
  label_printed_at: string | null
  note: string | null
}

/** The order-ops module service. */
export function opsService(container: any): any {
  return container.resolve(ORDER_OPS_MODULE)
}

/** Fetch the op rows for a set of order ids, keyed by order_id. */
export async function opsByOrderId(
  container: any,
  orderIds: string[]
): Promise<Map<string, OrderOpRow>> {
  if (!orderIds.length) return new Map()
  const ops: OrderOpRow[] = await opsService(container).listOrderOps(
    { order_id: orderIds },
    { take: orderIds.length }
  )
  return new Map(ops.map((op) => [op.order_id, op]))
}

/** Ensure an op row exists for each order id (default `processing`). Idempotent. */
export async function ensureOps(container: any, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return
  const existing = await opsByOrderId(container, orderIds)
  const missing = orderIds.filter((id) => !existing.has(id))
  if (missing.length) {
    await opsService(container).createOrderOps(
      missing.map((order_id) => ({ order_id, workflow_status: DEFAULT_STATUS }))
    )
  }
}

/**
 * Create op rows for every existing order that lacks one, in pages. Runs once to
 * bring historical orders into the workflow; new orders get a row from the
 * order-placed subscriber. Returns how many rows were created.
 */
export async function backfillOps(container: any, pageSize = 200): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let created = 0
  let skip = 0
  for (;;) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id"],
      pagination: { skip, take: pageSize, order: { created_at: "DESC" } },
    })
    if (!orders?.length) break
    const ids = orders.map((o: any) => o.id)
    const before = await opsByOrderId(container, ids)
    const missing = ids.filter((id: string) => !before.has(id))
    if (missing.length) {
      await opsService(container).createOrderOps(
        missing.map((order_id: string) => ({ order_id, workflow_status: DEFAULT_STATUS }))
      )
      created += missing.length
    }
    if (orders.length < pageSize) break
    skip += pageSize
  }
  return created
}

/** Counts per workflow status (one cheap indexed count each). */
export async function countsByStatus(
  container: any
): Promise<Record<WorkflowStatus, number>> {
  const svc = opsService(container)
  const entries = await Promise.all(
    WORKFLOW_STATUSES.map(async (status) => {
      const [, count] = await svc.listAndCountOrderOps(
        { workflow_status: status },
        { take: 1 }
      )
      return [status, count] as const
    })
  )
  return Object.fromEntries(entries) as Record<WorkflowStatus, number>
}

/** Set the workflow status for a set of orders, creating op rows as needed. */
export async function setWorkflowStatus(
  container: any,
  orderIds: string[],
  status: WorkflowStatus
): Promise<void> {
  await ensureOps(container, orderIds)
  const existing = await opsByOrderId(container, orderIds)
  const updates = orderIds
    .map((id) => existing.get(id))
    .filter((op): op is OrderOpRow => Boolean(op))
    .map((op) => ({ id: op.id, workflow_status: status }))
  if (updates.length) await opsService(container).updateOrderOps(updates)
}

/** The rich order fields the manager list and courier need. */
export const ORDER_MANAGE_FIELDS = [
  "id",
  "display_id",
  "status",
  "created_at",
  "email",
  "currency_code",
  "total",
  "metadata",
  "customer_id",
  "items.title",
  "items.quantity",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.province",
  "shipping_address.phone",
]

/** Hydrate order details for a set of ids, keyed by id (order preserved by caller). */
export async function hydrateOrders(
  container: any,
  orderIds: string[]
): Promise<Map<string, any>> {
  if (!orderIds.length) return new Map()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ORDER_MANAGE_FIELDS,
    filters: { id: orderIds },
  })
  return new Map((orders ?? []).map((o: any) => [o.id, o]))
}

/** The compact order shape the admin order manager renders. */
export function projectManagedOrder(order: any, op: OrderOpRow | undefined) {
  const addr = order.shipping_address ?? {}
  const meta = order.metadata ?? {}
  return {
    order_id: order.id,
    display_id: order.display_id,
    created_at: order.created_at,
    total: Number(order.total ?? 0),
    currency_code: order.currency_code ?? "bdt",
    customer_name: [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim(),
    phone: addr.phone ?? (meta.customer_phone as string) ?? "",
    address: [addr.address_1, addr.address_2, addr.province].filter(Boolean).join(", "),
    district: addr.province ?? (meta.district as string) ?? "",
    items: (order.items ?? [])
      .map((i: any) => (i.quantity > 1 ? `${i.title} ×${i.quantity}` : i.title))
      .filter(Boolean)
      .join(", "),
    item_count: (order.items ?? []).reduce((n: number, i: any) => n + Number(i.quantity ?? 0), 0),
    workflow_status: (op?.workflow_status ?? DEFAULT_STATUS) as WorkflowStatus,
    steadfast_consignment_id: op?.steadfast_consignment_id ?? null,
    steadfast_tracking_code: op?.steadfast_tracking_code ?? null,
    steadfast_status: op?.steadfast_status ?? null,
    label_printed_at: op?.label_printed_at ?? null,
    note: op?.note ?? null,
  }
}

export type ManagedOrder = ReturnType<typeof projectManagedOrder>

/**
 * List orders for one workflow tab (or "all"), newest first, paginated. Reads
 * the op rows for that status (indexed), then hydrates the matching orders.
 */
export async function listOrdersForStatus(
  container: any,
  status: WorkflowStatus | "all",
  opts: { limit?: number; offset?: number } = {}
): Promise<{ orders: ManagedOrder[]; count: number }> {
  const svc = opsService(container)
  const take = Math.min(Math.max(1, opts.limit ?? 50), 200)
  const skip = Math.max(0, opts.offset ?? 0)
  const filter = status === "all" ? {} : { workflow_status: status }
  const [ops, count]: [OrderOpRow[], number] = await svc.listAndCountOrderOps(
    filter,
    { order: { created_at: "DESC" }, take, skip }
  )
  const ids = ops.map((op) => op.order_id)
  const orders = await hydrateOrders(container, ids)
  const projected = ops
    .map((op) => {
      const order = orders.get(op.order_id)
      return order ? projectManagedOrder(order, op) : null
    })
    .filter((o): o is ManagedOrder => Boolean(o))
  return { orders: projected, count }
}
