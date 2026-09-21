"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Heart, MapPin, Package, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/money"
import {
  addAddress,
  deleteAddress,
  logout,
  updateProfile,
  type AccountOrder,
  type Customer,
  type CustomerAddress,
} from "@/lib/customer"

type Tab = "orders" | "profile" | "addresses" | "wishlist"

const TABS: { id: Tab; label: string; icon: typeof Package }[] = [
  { id: "orders", label: "Orders", icon: Package },
  { id: "profile", label: "Profile", icon: User },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "wishlist", label: "Wishlist", icon: Heart },
]

export default function AccountDashboard({
  customer,
  orders,
  addresses,
}: {
  customer: Customer
  orders: AccountOrder[]
  addresses: CustomerAddress[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("orders")
  const [signingOut, startSignOut] = useTransition()

  const name =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() ||
    customer.email

  function signOut() {
    startSignOut(async () => {
      await logout()
      router.push("/")
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div className="space-y-1">
          <p className="eyebrow">Account</p>
          <h1 className="display text-[2rem] leading-tight md:text-[2.5rem]">
            Hello, {name}
          </h1>
          <p className="text-sm text-ink-muted">{customer.email}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </header>

      <div className="grid gap-8 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-2 overflow-x-auto md:flex-col md:gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-sm transition-colors ${
                tab === id
                  ? "bg-ink text-white"
                  : "text-ink-muted hover:bg-surface hover:text-ink"
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {tab === "orders" ? <OrdersPanel orders={orders} /> : null}
          {tab === "profile" ? <ProfilePanel customer={customer} /> : null}
          {tab === "addresses" ? <AddressesPanel addresses={addresses} /> : null}
          {tab === "wishlist" ? <WishlistPanel /> : null}
        </section>
      </div>
    </div>
  )
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso || "—"
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function OrdersPanel({ orders }: { orders: AccountOrder[] }) {
  if (!orders.length) {
    return (
      <EmptyState
        title="No orders yet"
        body="When you place an order it will show up here — along with anything imported from florayn.com."
        cta={{ href: "/", label: "Start shopping" }}
      />
    )
  }
  return (
    <div className="space-y-3">
      {orders.map((o, i) => {
        const row = (
          <div className="flex items-center justify-between gap-4 rounded-[14px] border border-line bg-paper px-5 py-4 transition-colors hover:border-ink/40">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  Order {o.displayId != null ? `#${o.displayId}` : ""}
                </span>
                {o.legacy ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Imported
                  </span>
                ) : null}
              </div>
              {o.items ? (
                <p className="truncate text-sm text-ink-muted">{o.items}</p>
              ) : null}
              <p className="text-xs text-ink-muted">
                {formatDate(o.date)} · {titleCase(o.status)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-medium tabular-nums">
                {formatPrice(o.total, o.currencyCode)}
              </p>
              {o.href ? (
                <span className="text-xs text-purple underline underline-offset-4">
                  View
                </span>
              ) : null}
            </div>
          </div>
        )
        return o.href ? (
          <Link key={o.id ?? i} href={o.href} className="block">
            {row}
          </Link>
        ) : (
          <div key={o.id ?? `legacy-${i}`}>{row}</div>
        )
      })}
    </div>
  )
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-[10px] border border-line-strong bg-paper px-4 py-2.5 text-sm outline-none focus:border-ink disabled:bg-surface disabled:text-ink-muted"
      />
    </label>
  )
}

function ProfilePanel({ customer }: { customer: Customer }) {
  const [firstName, setFirstName] = useState(customer.first_name ?? "")
  const [lastName, setLastName] = useState(customer.last_name ?? "")
  const [phone, setPhone] = useState(customer.phone ?? "")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function save() {
    setMsg(null)
    start(async () => {
      const r = await updateProfile({ first_name: firstName, last_name: lastName, phone })
      setMsg(r.ok ? { ok: true, text: "Profile saved." } : { ok: false, text: r.error ?? "Could not save." })
    })
  }

  return (
    <form
      className="max-w-md space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Field label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <Field
        label="Phone"
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Field label="Email" value={customer.email} disabled readOnly />
      {msg ? (
        <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}

function AddressesPanel({ addresses }: { addresses: CustomerAddress[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ address_1: "", area: "", city: "", phone: "" })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function refresh() {
    router.refresh()
  }

  function submit() {
    setError(null)
    start(async () => {
      const r = await addAddress({
        address_1: form.address_1,
        address_2: form.area,
        city: form.city,
        phone: form.phone,
      })
      if (!r.ok) {
        setError(r.error ?? "Could not save the address.")
        return
      }
      setForm({ address_1: "", area: "", city: "", phone: "" })
      setAdding(false)
      refresh()
    })
  }

  function remove(id: string) {
    start(async () => {
      await deleteAddress(id)
      refresh()
    })
  }

  return (
    <div className="space-y-5">
      {addresses.length ? (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-4 rounded-[14px] border border-line bg-paper px-5 py-4"
            >
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">
                  {[a.first_name, a.last_name].filter(Boolean).join(" ") || "Saved address"}
                </p>
                <p className="text-ink-muted">
                  {[a.address_1, a.address_2, a.city, a.province].filter(Boolean).join(", ")}
                </p>
                {a.phone ? <p className="text-ink-muted">{a.phone}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={pending}
                className="shrink-0 text-xs text-ink-muted underline underline-offset-4 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No saved addresses yet.</p>
      )}

      {adding ? (
        <form
          className="max-w-md space-y-4 rounded-[14px] border border-line bg-surface/40 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field
            label="Street address"
            value={form.address_1}
            onChange={(e) => setForm((f) => ({ ...f, address_1: e.target.value }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Area"
              value={form.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            />
            <Field
              label="City / District"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
          </div>
          <Field
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save address"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add an address
        </Button>
      )}
    </div>
  )
}

type WishlistEntry = { handle: string; title: string; thumbnail?: string | null }
const WISHLIST_KEY = "florayn:wishlist"
const WISHLIST_EVENT = "florayn:wishlist"

function WishlistPanel() {
  const [items, setItems] = useState<WishlistEntry[]>([])

  useEffect(() => {
    const read = () => {
      try {
        const all = JSON.parse(localStorage.getItem(WISHLIST_KEY) || "{}") as Record<
          string,
          WishlistEntry
        >
        setItems(Object.values(all))
      } catch {
        setItems([])
      }
    }
    read()
    window.addEventListener(WISHLIST_EVENT, read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener(WISHLIST_EVENT, read)
      window.removeEventListener("storage", read)
    }
  }, [])

  function remove(handle: string) {
    try {
      const all = JSON.parse(localStorage.getItem(WISHLIST_KEY) || "{}") as Record<string, WishlistEntry>
      delete all[handle]
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(all))
      window.dispatchEvent(new Event(WISHLIST_EVENT))
    } catch {
      /* storage unavailable - ignore */
    }
  }

  if (!items.length) {
    return (
      <EmptyState
        title="Your wishlist is empty"
        body="Tap the heart on any design to save it here for later."
        cta={{ href: "/", label: "Browse designs" }}
      />
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.handle} className="group space-y-2">
          <Link
            href={`/product/${item.handle}`}
            className="block aspect-square overflow-hidden rounded-[14px] border border-line bg-surface"
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail}
                alt={item.title}
                className="size-full object-cover"
              />
            ) : null}
          </Link>
          <div className="flex items-start justify-between gap-2">
            <Link href={`/product/${item.handle}`} className="text-sm hover:text-purple">
              {item.title}
            </Link>
            <button
              type="button"
              onClick={() => remove(item.handle)}
              aria-label="Remove from wishlist"
              className="shrink-0 text-ink-muted hover:text-red-600"
            >
              <Heart size={16} fill="currentColor" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string
  body: string
  cta: { href: string; label: string }
}) {
  return (
    <div className="rounded-[16px] border border-dashed border-line px-6 py-14 text-center">
      <h2 className="display text-xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-ink-muted">{body}</p>
      <Link
        href={cta.href}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-[10px] bg-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-deep"
      >
        {cta.label}
      </Link>
    </div>
  )
}
