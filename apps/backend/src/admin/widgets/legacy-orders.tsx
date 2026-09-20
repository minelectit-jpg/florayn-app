import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"

type LegacyOrder = {
  n: string | number
  date: string
  status: string
  total: number
  items: string
}

const bdt = (n: unknown) =>
  "৳" + Number(n ?? 0).toLocaleString("en-US")

/**
 * The customer's order history imported from the old florayn.com WooCommerce
 * store (kept as a read-only archive on the customer's metadata, since the
 * historical orders are already fulfilled and need no live Medusa order).
 */
const LegacyOrdersWidget = ({ data }: DetailWidgetProps<AdminCustomer>) => {
  const meta = (data?.metadata ?? {}) as Record<string, unknown>
  const orders = (Array.isArray(meta.legacy_orders) ? meta.legacy_orders : []) as LegacyOrder[]
  if (!orders.length) return null

  const count = (meta.legacy_order_count as number | undefined) ?? orders.length
  const total = (meta.legacy_total_spent as number | undefined) ?? 0

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Order history (florayn.com)</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {count} order{count === 1 ? "" : "s"} · {bdt(total)} lifetime · imported from the old site
          </Text>
        </div>
        {meta.legacy_phone ? (
          <Badge size="2xsmall">{String(meta.legacy_phone)}</Badge>
        ) : null}
      </div>

      <div className="px-6 py-4">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Items</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {orders.map((o, i) => (
              <Table.Row key={i}>
                <Table.Cell>#{o.n}</Table.Cell>
                <Table.Cell className="whitespace-nowrap">{o.date}</Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall">{o.status}</Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{o.items}</Text>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">
                  {bdt(o.total)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {meta.legacy_address ? (
          <Text size="xsmall" className="text-ui-fg-muted pt-4">
            Delivery address: {String(meta.legacy_address)}
          </Text>
        ) : null}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default LegacyOrdersWidget
