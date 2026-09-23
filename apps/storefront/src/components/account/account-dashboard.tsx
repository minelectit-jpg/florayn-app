"use client"

import Link from "@/components/audience-link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Heart, LogOut, MapPin, Package, User } from "lucide-react"

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
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim()

  function signOut() {
    startSignOut(async () => {
      await logout()
      router.push("/")
      router.refresh()
    })
  }

  return (
    <div className="fl-account">
      <header className="fl-account__welcome">
        <div className="fl-account__identity">
          <span className="fl-account__avatar" aria-hidden="true">{name ? name.slice(0, 1).toUpperCase() : <User size={28} />}</span>
          <div>
            <p className="eyebrow text-purple-deep">Your Florayn</p>
            <h1>{name ? `Hello, ${name}.` : "Welcome back."}</h1>
            <p className="fl-account__email">{customer.email}</p>
          </div>
        </div>
        <Link href="/" className="fl-text-link">Find your next favourite <ArrowRight size={17} /></Link>
      </header>
      <div className="fl-account__layout">
        <aside className="fl-account__sidebar">
        <nav aria-label="Account sections" className="fl-account__nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              aria-controls="account-content"
              className={tab === id ? "is-active" : ""}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {id === "orders" && orders.length > 0 ? <span className="fl-account__count">{orders.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="fl-account__support"><p>Here to help.</p><Link href="/contact/">Contact us <ArrowRight size={14} /></Link></div>
        <button type="button" onClick={signOut} disabled={signingOut} className="fl-account__signout"><LogOut size={16} />{signingOut ? "Signing out…" : "Sign out"}</button>
        </aside>
        <section id="account-content" className="fl-account__content" aria-labelledby="account-section-title">
          <div className="fl-account__section-heading">
            <h2 id="account-section-title">{TABS.find((t) => t.id === tab)?.label}</h2>
            <p>{tab === "orders" ? "Your favourites, on their way or already yours." : tab === "profile" ? "The little details that make this account yours." : tab === "addresses" ? "Keep your delivery details in one place." : "The designs you’ve saved on this device."}</p>
          </div>
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
        body="Your orders will appear here. Find a design you love to get started."
        cta={{ href: "/", label: "Start shopping" }}
      />
    )
  }
  return (
    <div className="space-y-3">
      {orders.map((o, i) => {
        const row = (
          <div className="fl-account-order">
            <div className="fl-account-order__top">
              <div className="flex flex-wrap items-center gap-2">
                <Package size={17} className="text-ink-muted" aria-hidden="true" />
                <span className="font-semibold">
                  Order {o.displayId != null ? `#${o.displayId}` : ""}
                </span>
                {o.legacy ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Imported
                  </span>
                ) : null}
              </div>
              <span className="fl-order-status">{titleCase(o.status)}</span>
            </div>
            <div className="fl-account-order__body">
              <div className="min-w-0">
                <p className="text-xs text-ink-muted">Placed on {formatDate(o.date)}</p>
                {o.items ? <p className="mt-2 text-sm leading-relaxed">{o.items}</p> : null}
              </div>
              <p className="shrink-0 text-lg font-semibold tabular-nums">
                {formatPrice(o.total, o.currencyCode)}
              </p>
            </div>
            {o.href ? <div className="fl-account-order__footer"><span>View order details</span><ArrowRight size={16} /></div> : null}
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
        className="fl-account-input"
      />
    </label>
  )
}

function ProfilePanel({ customer }: { customer: Customer }) {
  const router = useRouter()
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
      if (r.ok) router.refresh()
    })
  }

  return (
    <form
      className="fl-account-form max-w-xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Field label="Last name" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <Field
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Field label="Email" value={customer.email} disabled readOnly />
      {msg ? (
        <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
      ) : null}
      <Button type="submit" className="rounded-full min-h-12" disabled={pending}>
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
    setError(null)
    start(async () => {
      const result = await deleteAddress(id)
      if (!result.ok) setError(result.error ?? "Could not remove the address.")
      else refresh()
    })
  }

  return (
    <div className="space-y-5">
      {error ? <p role="alert" className="fl-form-error">{error}</p> : null}
      {addresses.length ? (
        <ul className="grid gap-4 xl:grid-cols-2">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="fl-address-card"
            >
              <div className="space-y-0.5 text-sm">
                <MapPin size={20} className="mb-4 text-purple" aria-hidden="true" />
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
        <div className="fl-address-card"><MapPin size={24} className="text-purple" /><div><p className="font-medium">A place for your favourites.</p><p className="mt-1 text-sm text-ink-muted">Add your first delivery address below.</p></div></div>
      )}

      {adding ? (
        <form
          className="fl-account-form max-w-xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field
            label="Street address"
            required
            autoComplete="address-line1"
            value={form.address_1}
            onChange={(e) => setForm((f) => ({ ...f, address_1: e.target.value }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Area"
              autoComplete="address-line2"
              value={form.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            />
            <Field
              label="City / District"
              required
              autoComplete="address-level2"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
          </div>
          <Field
            label="Phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button type="submit" className="rounded-full min-h-11" disabled={pending}>
              {pending ? "Saving…" : "Save address"}
            </Button>
            <Button type="button" variant="secondary" className="rounded-full min-h-11" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" className="rounded-full min-h-12" onClick={() => { setError(null); setAdding(true) }}>
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
        <li key={item.handle} className="group space-y-3 rounded-2xl border border-line p-3">
          <Link
            href={`/product/${item.handle}`}
            className="block aspect-square overflow-hidden rounded-[14px] border border-line bg-surface"
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail}
                alt={item.title}
                loading="lazy"
                decoding="async"
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
              aria-label={`Remove ${item.title} from wishlist`}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-purple-tint text-purple hover:text-danger"
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
