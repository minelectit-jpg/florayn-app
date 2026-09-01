import Link from "next/link"

const CASE_TYPES = [
  { href: "/collection/essentials/", label: "Essentials" },
  { href: "/collection/signature/", label: "Signature" },
  { href: "/collection/elite-clear/", label: "Elite Clear" },
  { href: "/collection/armor-black/", label: "Armor Black" },
  { href: "/collection/armor-clear/", label: "Armor Clear" },
  { href: "/collection/alcantara/", label: "Alcantara" },
]

const DEVICES = [
  { href: "/collection/iphone-cases/", label: "iPhone" },
  { href: "/collection/samsung-cases/", label: "Samsung Galaxy" },
  { href: "/collection/airpods-cases/", label: "AirPods" },
  { href: "/collection/watch-bands/", label: "Apple Watch" },
  { href: "/collection/card-wallets/", label: "Card Wallets" },
]

export default function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-[1470px] px-[15px] py-14 md:px-[30px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <p className="display text-2xl leading-none">Florayn</p>
            <p className="max-w-[24ch] text-sm text-ink-muted">
              Premium printed cases, made in Dhaka. One design, every device.
            </p>
          </div>

          <div className="space-y-3">
            <p className="eyebrow">Constructions</p>
            <ul className="space-y-2">
              {CASE_TYPES.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-ink-muted transition-colors hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <p className="eyebrow">Devices</p>
            <ul className="space-y-2">
              {DEVICES.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-ink-muted transition-colors hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <p className="eyebrow">Delivery</p>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>Cash on Delivery</li>
              <li>Inside Dhaka 60৳</li>
              <li>Outside Dhaka 100৳</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
          <p className="eyebrow">
            &copy; {new Date().getFullYear()} Florayn - Dhaka, Bangladesh
          </p>
          <p className="eyebrow">Prices in BDT</p>
        </div>
      </div>
    </footer>
  )
}
