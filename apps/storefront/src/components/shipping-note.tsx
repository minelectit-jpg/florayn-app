import Link from "next/link"
import { ArrowUpRight, Heart, MapPin, Package, Phone, RefreshCw, ShieldCheck, Truck, Wallet } from "lucide-react"
import { DEFAULT_PRESENTATION, safePresentationHref, type DeliveryPresentation } from "@/lib/storefront-presentation"

const icons = { truck: Truck, wallet: Wallet, "map-pin": MapPin, refresh: RefreshCw, package: Package, heart: Heart, shield: ShieldCheck, phone: Phone }

export function ShippingNote({ settings = DEFAULT_PRESENTATION.delivery }: { settings?: DeliveryPresentation }) {
  if (!settings.enabled || !settings.cards.length) return null
  return <section className="fl-delivery" aria-label={settings.heading || "Delivery and exchanges"}>
    {settings.heading && <h2 className="fl-delivery__heading">{settings.heading}</h2>}
    <ul className="fl-delivery__grid">
      {settings.cards.map((card, index) => {
        const Icon = icons[card.icon] ?? Package
        return <li key={index} className="fl-delivery__card">
          <span className="fl-delivery__icon"><Icon size={19} strokeWidth={1.6} aria-hidden="true" /></span>
          <div><h3>{card.title}</h3>{card.description && <p>{card.description}</p>}</div>
        </li>
      })}
    </ul>
    {settings.link_label && safePresentationHref(settings.link_href) && <Link href={settings.link_href} prefetch={false} className="fl-delivery__help">
      {settings.link_label}<ArrowUpRight size={15} aria-hidden="true" />
    </Link>}
  </section>
}
