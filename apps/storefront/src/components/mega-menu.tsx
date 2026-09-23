"use client"

import Link from "@/components/audience-link"
import { useMemo, useState } from "react"

import ProductImage from "@/components/product-image"
import type { CaseTypeInfo, MenuSection } from "@/lib/content"

type Brand = { key: string; label: string; families: MenuSection["groups"] }

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"

/** Representative photo per construction (from florayn.com's own catalogue),
 * keyed by our case-type slug, for the "Shop by style" menu. */
const F = "https://florayn.com/wp-content/uploads"
const STYLE_IMAGE: Record<string, string> = {
  alcantara: `${F}/2025/10/Front-1-copyvv-768x768.jpg`,
  essentials: `${F}/2025/10/Front-74-768x768.jpg`,
  signature: `${F}/2025/10/Front-1-copy-768x768.jpg`,
  "elite-clear": `${F}/2025/10/Front-1-copy5mmm-768x768.jpg`,
  "armor-clear": `${F}/2025/10/7.5-cleaer-768x768.jpg`,
  "armor-black": `${F}/2026/05/17-Pro_-66-copy_-768x768.webp`,
}

function bdt(n: number) {
  return `৳${n.toLocaleString("en-US")}`
}

/** Rail label + promo hero per brand. Falls back to the iPhone hero. */
const BRAND: Record<string, { label: string; image: string; caption: string }> = {
  iphone: {
    label: "iPhone Cases",
    image: `${R2}/sunburst/signature/iphone-17-pro-max/1.webp`,
    caption: "iPhone Cases",
  },
  samsung: {
    label: "Samsung Cases",
    image: `${R2}/timeless/signature/iphone-17-pro-max/1.webp`,
    caption: "Samsung Cases",
  },
  apple: {
    label: "AirPods Cases",
    image: `${R2}/sunburst/signature/airpods-1-2/1.webp`,
    caption: "AirPods Cases",
  },
  google: { label: "Pixel Cases", image: `${R2}/sunburst/signature/iphone-17-pro-max/1.webp`, caption: "Pixel Cases" },
}
const brandMeta = (key: string, fallbackLabel: string) =>
  BRAND[key] ?? {
    label: fallbackLabel,
    image: BRAND.iphone.image,
    caption: fallbackLabel,
  }

/**
 * Groups a section's families by brand ("iPhone 17 Series" -> iPhone). Groups
 * with no heading (e.g. the Styles list) are NOT branded, so such a section
 * gets the plain column layout instead of the rail + promo layout.
 */
function brandsOf(section: MenuSection): Brand[] {
  const order: string[] = []
  const map = new Map<string, Brand>()
  for (const group of section.groups) {
    const heading = (group.heading ?? "").trim()
    if (!heading) continue
    const first = heading.split(/\s+/)[0]
    const key = first.toLowerCase()
    if (!map.has(key)) {
      map.set(key, { key, label: brandMeta(key, `${first} Cases`).label, families: [] })
      order.push(key)
    }
    map.get(key)!.families.push(group)
  }
  return order.map((k) => map.get(k)!)
}

function PhoneGlyph() {
  return (
    <svg width="18" height="24" viewBox="0 0 18 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="16" height="22" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4.5" y="4" width="6.5" height="4.5" rx="1.4" fill="currentColor" />
    </svg>
  )
}

export default function MegaPanel({
  section,
  caseTypes = [],
}: {
  section: MenuSection
  caseTypes?: CaseTypeInfo[]
}) {
  const brands = useMemo(() => brandsOf(section), [section])
  const [active, setActive] = useState(0)

  // Non-device sections (Styles) = the case constructions: a "Shop by style"
  // grid of photo cards with each construction's blurb and starting price.
  if (brands.length === 0) {
    const byName = new Map(caseTypes.map((c) => [c.name.toLowerCase(), c]))
    const cards = section.groups
      .flatMap((g) => g.links)
      .map((link) => {
        const info = byName.get(link.label.toLowerCase())
        const image = info ? info.image ?? STYLE_IMAGE[info.slug] : undefined
        return { link, info, image }
      })

    return (
      <div className="grid grid-cols-3 gap-4 p-6">
        {cards.map(({ link, info, image }) => (
          <Link
            key={link.id}
            href={link.href}
            className="group flex w-[210px] flex-col overflow-hidden rounded-[12px] border border-line bg-surface transition-colors hover:border-purple"
          >
            <span className="relative block aspect-square w-full overflow-hidden bg-paper">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={link.label}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : null}
            </span>
            <span className="flex flex-1 flex-col p-3">
              <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                {link.label}
                {link.badge ? (
                  <span className="rounded-full bg-purple px-1.5 py-[1px] text-[9px] font-semibold uppercase text-white">
                    {link.badge}
                  </span>
                ) : null}
              </span>
              {info?.price != null ? (
                <span className="mt-1 text-[13px] font-medium text-ink">
                  from {bdt(info.price)}
                </span>
              ) : null}
            </span>
          </Link>
        ))}
      </div>
    )
  }

  const current = brands[Math.min(active, brands.length - 1)]
  const meta = brandMeta(current.key, current.label)
  // Device families become one titled column each (Phone Case). A single flat
  // family (AirPods) is split into "Base Series" / "Pro Series" so it reads as
  // titled columns too instead of a bare list.
  const displayFamilies = useMemo(() => {
    if (current.families.length === 1) {
      const links = current.families[0].links
      const pro = links.filter((l) => /\bpro\b/i.test(l.label))
      const base = links.filter((l) => !/\bpro\b/i.test(l.label))
      if (pro.length && base.length) {
        return [
          { heading: "Base Series", links: base },
          { heading: "Pro Series", links: pro },
        ]
      }
    }
    return current.families
  }, [current])
  const cols = Math.min(displayFamilies.length, 3)

  return (
    <div className="grid grid-cols-[210px_auto_296px] gap-x-8 p-6">
      {/* Left rail: brands. */}
      <ul className="border-r border-line pr-6">
        {brands.map((brand, i) => {
          const isActive = i === active
          return (
            <li key={brand.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                aria-current={isActive}
                className={[
                  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors",
                  isActive ? "bg-purple/10 text-purple" : "text-ink hover:bg-surface",
                ].join(" ")}
              >
                <span className={isActive ? "text-purple" : "text-ink-muted"}>
                  <PhoneGlyph />
                </span>
                <span className="flex-1">{brand.label}</span>
                <span aria-hidden="true" className="text-ink-muted">
                  &rsaquo;
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* Middle: the active brand's families / models, always top-aligned. */}
      <div className="flex flex-col justify-start">
        <div
          className="grid auto-rows-min gap-x-12 gap-y-7"
          style={{ gridTemplateColumns: `repeat(${cols}, max-content)` }}
        >
          {displayFamilies.map((family, i) => (
            <div key={family.heading ?? i}>
              {family.heading ? (
                <p className="mb-3 text-[15px] font-semibold">{family.heading}</p>
              ) : null}
              <ul className="space-y-2">
                {family.links.map((link) => (
                  <li key={link.id}>
                    <LinkRow href={link.href} label={link.label} badge={link.badge} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Right: promo hero for the active brand. */}
      <Link
        href={section.href ?? "/shop/"}
        className="group relative block min-h-[196px] self-stretch overflow-hidden rounded-[14px] bg-surface"
      >
        <ProductImage
          src={meta.image}
          alt={meta.caption}
          label={meta.caption}
          sizes="312px"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          fillMode="absolute"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/55 to-transparent p-4">
          <span className="block text-[17px] font-semibold text-white">{meta.caption}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-white/85">
            Shop all &rsaquo;
          </span>
        </span>
      </Link>
    </div>
  )
}

function LinkRow({
  href,
  label,
  badge,
  size = "sm",
}: {
  href: string
  label: string
  badge: string | null
  size?: "sm" | "lg"
}) {
  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center gap-1.5 text-ink-muted transition-colors hover:text-purple",
        size === "lg" ? "text-[15px]" : "text-sm",
      ].join(" ")}
    >
      {label}
      {badge ? (
        <span className="rounded-full bg-purple px-1.5 py-[1px] text-[9px] font-semibold uppercase text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
