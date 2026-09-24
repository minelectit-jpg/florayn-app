import { Badge, Button, Input, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

type Customer = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  district: string | null
  account: boolean
  orders: number
  spent: number
  first_order: string
  last_order: string
  from_florayn: boolean
}

const taka = (n: number) => `৳${Math.round(n).toLocaleString("en-US")}`
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

/**
 * Everyone who has ordered - from this store and from florayn.com - newest
 * order first, with their order count and spend. Clicking a customer shows
 * their orders.
 */
export function CustomerList({ onOpen }: { onOpen: (search: string) => void }) {
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ count: number; customers: Customer[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(q.trim()); setOffset(0) }, 300)
    return () => clearTimeout(timer)
  }, [q])
  useEffect(() => {
    let live = true
    setLoading(true)
    fetch(`/admin/customer-list?offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}`, { credentials: "include" })
      .then(async (res) => { const body = await res.json(); if (!res.ok) throw new Error(body?.message || "Could not load customers."); if (live) setData(body) })
      .catch((e) => toast.error(e.message))
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [query, offset])

  return (
    <div className="overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest">
      <div className="flex flex-wrap items-center gap-2 border-b border-ui-border-base px-4 py-3">
        <Input size="small" placeholder="Search name, mobile or email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="grow" />
        <Text size="small" className="text-ui-fg-muted">{data ? `${data.count} customer${data.count === 1 ? "" : "s"}` : ""}</Text>
      </div>
      {loading && !data ? <div className="px-4 py-16 text-center text-ui-fg-subtle">Loading…</div>
        : !data?.customers.length ? <div className="px-4 py-16 text-center text-ui-fg-subtle">{query ? "No customer matches that." : "No customers yet."}</div>
          : <>
            <div className="hidden grid-cols-[1fr_150px_80px_110px_130px] gap-3 border-b border-ui-border-base px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ui-fg-muted md:grid">
              <span>Customer</span><span>Mobile</span><span className="text-right">Orders</span><span className="text-right">Spent</span><span>Last order</span>
            </div>
            <ul className="divide-y divide-ui-border-base">
              {data.customers.map((c) => (
                <li key={c.id} className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-ui-bg-base-hover md:grid-cols-[1fr_150px_80px_110px_130px]" onClick={() => onOpen(c.phone || c.email || c.name || "")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium text-ui-fg-base"><span className="truncate">{c.name || "—"}</span>{c.account ? <Badge size="2xsmall" color="green">account</Badge> : null}{c.from_florayn ? <Badge size="2xsmall" color="purple">florayn.com</Badge> : null}</div>
                    <div className="truncate text-xs text-ui-fg-subtle">{c.email || "no email"}{c.district ? ` · ${c.district}` : ""}<span className="md:hidden"> · {c.phone || "—"}</span></div>
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">{c.phone || "—"}</div>
                  <div className="text-right text-sm tabular-nums">{c.orders}<span className="text-ui-fg-muted md:hidden"> orders</span></div>
                  <div className="hidden text-right text-sm font-medium tabular-nums md:block">{taka(c.spent)}</div>
                  <div className="hidden text-sm md:block">{day(c.last_order)}<div className="text-xs text-ui-fg-muted">since {day(c.first_order)}</div></div>
                </li>
              ))}
            </ul>
            {data.count > 50 ? <div className="flex items-center justify-between border-t border-ui-border-base px-4 py-3">
              <Text size="small" className="text-ui-fg-muted">{offset + 1}–{Math.min(offset + 50, data.count)} of {data.count}</Text>
              <div className="flex gap-2">
                <Button size="small" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>Prev</Button>
                <Button size="small" variant="secondary" disabled={offset + 50 >= data.count || loading} onClick={() => setOffset(offset + 50)}>Next</Button>
              </div>
            </div> : null}
          </>}
    </div>
  )
}
