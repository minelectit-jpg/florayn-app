import { Badge, Heading, Table, Text } from "@medusajs/ui"

import type { DimRow, RecentHit } from "../../../lib/tracking/live"

/**
 * The Live page's tables (TRACKING.md 9): one per dimension (sources,
 * products, models, case types; landing pages and the rest on the report
 * tabs) and the recent activity list. Rows arrive sorted and labelled from
 * lib/tracking/live.ts; product rows name the product, never a customer.
 */

export type DimColumn = { key: keyof DimRow; label: string; money?: boolean }

export const PRODUCT_COLUMNS: DimColumn[] = [
  { key: "product_views", label: "Views" },
  { key: "add_to_cart", label: "Add to cart" },
  { key: "purchases", label: "Bought" },
  { key: "revenue", label: "Revenue", money: true },
]

export const SESSION_COLUMNS: DimColumn[] = [
  { key: "sessions", label: "Sessions" },
  { key: "product_views", label: "Views" },
  { key: "add_to_cart", label: "Add to cart" },
  { key: "purchases", label: "Orders" },
  { key: "revenue", label: "Revenue", money: true },
]

const EVENT_LABELS: Record<string, string> = {
  ViewContent: "Viewed",
  AddToCart: "Added to cart",
  InitiateCheckout: "Checkout",
  Purchase: "Order",
}

export function taka(n: number): string {
  return `৳${Math.round(n).toLocaleString("en-US")}`
}

function cell(row: DimRow, column: DimColumn): string {
  const value = Number(row[column.key] ?? 0)
  return column.money ? taka(value) : Math.round(value).toLocaleString("en-US")
}

export function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

export function DimTable({ title, rows, columns, keyLabel, empty, limit = 10 }: {
  title: string
  rows: DimRow[]
  columns: DimColumn[]
  keyLabel: string
  empty: string
  limit?: number
}) {
  const shown = rows.slice(0, limit)
  return (
    <div className="space-y-2">
      <Heading level="h3">{title}</Heading>
      {shown.length ? <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{keyLabel}</Table.HeaderCell>
              {columns.map((column) => <Table.HeaderCell key={column.key} className="text-right">{column.label}</Table.HeaderCell>)}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shown.map((row) => <Table.Row key={row.key}>
              <Table.Cell className="max-w-[16rem] truncate" title={row.label === row.key ? row.key : `${row.label} (${row.key})`}>{row.label}</Table.Cell>
              {columns.map((column) => <Table.Cell key={column.key} className="text-right tabular-nums">{cell(row, column)}</Table.Cell>)}
            </Table.Row>)}
          </Table.Body>
        </Table>
      </div> : <Text size="small" className="text-ui-fg-subtle">{empty}</Text>}
    </div>
  )
}

export function RecentTable({ rows }: { rows: RecentHit[] }) {
  if (!rows.length) return <Text size="small" className="text-ui-fg-subtle">No product views, carts or orders in the last 24 hours.</Text>
  return (
    <div className="overflow-x-auto">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>When</Table.HeaderCell>
            <Table.HeaderCell>What</Table.HeaderCell>
            <Table.HeaderCell>Details</Table.HeaderCell>
            <Table.HeaderCell>From</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Value</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row, index) => <Table.Row key={`${index}-${row.event}-${row.ago_s}`}>
            <Table.Cell className="whitespace-nowrap">{ago(row.ago_s)}</Table.Cell>
            <Table.Cell className="whitespace-nowrap">
              <span className="flex items-center gap-1.5">
                {EVENT_LABELS[row.event] ?? row.event}
                {row.internal ? <Badge size="2xsmall" color="grey">Staff</Badge> : null}
              </span>
            </Table.Cell>
            <Table.Cell className="max-w-[22rem] truncate" title={row.label}>{row.label}</Table.Cell>
            <Table.Cell className="whitespace-nowrap">{row.source_label ?? "-"}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{row.value === null ? "-" : taka(row.value)}</Table.Cell>
          </Table.Row>)}
        </Table.Body>
      </Table>
    </div>
  )
}
