"use client"

import { ArrowRight } from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { canOptimize } from "@/components/art-image"
import type { Audience } from "@/lib/audience"
import type { HeaderData, NavSection } from "@/lib/header-data"
import { phoneOf, readDevice } from "@/lib/remembered-device"
import { matchesModel } from "@/lib/search/normalize"

import { NavBadge } from "./desktop-nav"
import IntentLink from "./intent-link"
import { caseStyleHref, collectionsConfig, collectionsFor, exampleQueries, familiesOf, modelsOf, sectionForm, seriesGroups, shopHref, styleFromPrice, stylesOf } from "./nav-model"

export type MegaPanelProps = {
  section: NavSection
  data: HeaderData
  audience: Audience
  /** A link in the panel was chosen: close it. */
  onNavigate: () => void
}

const price = (amount: number) => `৳${amount.toLocaleString("en-US")}`

/** Admin images: R2 goes through the optimizer, any other https host as it is. */
function Picture({ src, sizes, className }: { src: string; sizes: string; className: string }) {
  return <Image src={src} alt="" fill sizes={sizes} unoptimized={!canOptimize(src)} className={className} />
}

function Initial({ label, size = "text-[28px]" }: { label: string; size?: string }) {
  return (
    <span aria-hidden="true" className={`grid h-full place-items-center font-semibold text-purple-deep ${size}`}>
      {label.charAt(0)}
    </span>
  )
}

/**
 * One desktop mega panel (loaded on intent by desktop-nav.tsx), drawn from the
 * same admin section and header data as the phone menu: device models by
 * brand and series, case styles, collections, or the section's own links.
 */
export default function MegaPanel(props: MegaPanelProps) {
  const { section } = props
  return (
    <div
      id={`mega-${section.id}`}
      role="region"
      aria-label={section.label}
      className="fl-mega w-max max-w-[calc(100vw-32px)] rounded-[16px] border border-line bg-paper shadow-[0_20px_48px_-16px_rgba(26,22,37,0.32)]"
    >
      {section.kind === "devices" ? (
        <DevicesPanel {...props} />
      ) : section.kind === "case_types" ? (
        <StylesPanel {...props} />
      ) : section.kind === "collections" ? (
        <CollectionsPanel {...props} />
      ) : (
        <LinksPanel {...props} />
      )}
    </div>
  )
}

/**
 * Brands on the left (hidden for a one-brand section), the active brand's
 * models under series headings in the middle, newest first, with a filter
 * that searches every brand of the section; the section's picture on the right.
 */
function DevicesPanel({ section, data, audience, onNavigate }: MegaPanelProps) {
  const router = useRouter()
  const families = useMemo(() => familiesOf(section, data), [section, data])
  const [active, setActive] = useState(families[0]?.family ?? "")
  const [query, setQuery] = useState("")
  const typed = query.trim()

  const groups = useMemo(() => {
    if (!typed) return seriesGroups(modelsOf(data, active))
    return families
      .map((family) => ({ heading: families.length > 1 ? family.label : null, devices: modelsOf(data, family.family).filter((device) => matchesModel(device[1], typed)) }))
      .filter((group) => group.devices.length > 0)
  }, [typed, active, data, families])
  const matches = groups.flatMap((group) => group.devices)

  const rail = families.length > 1
  const columns = [rail ? "200px" : null, "minmax(520px,auto)", section.image ? "260px" : null].filter(Boolean).join(" ")
  const examples = exampleQueries(families.flatMap((family) => modelsOf(data, family.family)))

  return (
    <div className="grid gap-x-8 p-6" style={{ gridTemplateColumns: columns }}>
      {rail ? (
        <ul className="space-y-1 border-r border-line pr-6">
          {families.map((family) => {
            const on = family.family === active && !typed
            return (
              <li key={family.family}>
                <button
                  type="button"
                  aria-pressed={on}
                  onPointerEnter={() => setActive(family.family)}
                  onFocus={() => setActive(family.family)}
                  onClick={() => {
                    setActive(family.family)
                    setQuery("")
                  }}
                  className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${on ? "bg-purple-tint text-purple" : "text-ink hover:bg-field"}`}
                >
                  <span className="flex-1">{family.label}</span>
                  <span className={`text-[13px] tabular-nums ${on ? "text-purple" : "text-ink-muted"}`}>{family.count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="min-w-0">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || matches.length !== 1) return
            event.preventDefault()
            onNavigate()
            router.push(shopHref(matches[0], section, data, audience))
          }}
          placeholder="Find your model"
          aria-label="Find your model"
          autoComplete="off"
          enterKeyHint="go"
          className="h-10 w-full max-w-[320px] rounded-full bg-field px-4 text-[14px] text-ink placeholder:text-ink-muted"
        />
        {groups.length ? (
          <div className="mt-5 gap-x-8 [columns:170px_3]">
            {groups.map((group, i) => (
              <div key={group.heading ?? i} className="mb-5 break-inside-avoid">
                {group.heading ? <p className="mb-2 text-[14px] font-semibold text-ink">{group.heading}</p> : null}
                <ul className="space-y-1.5">
                  {group.devices.map((device) => (
                    <li key={device[0]}>
                      <IntentLink href={shopHref(device, section, data, audience)} onClick={onNavigate} className="inline-flex items-center gap-1.5 text-[14px] text-ink-muted transition-colors hover:text-purple">
                        {device[1]}
                        {device[3] ? <NavBadge>{device[3]}</NavBadge> : null}
                      </IntentLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 max-w-[360px] text-[14px] text-ink-muted">
            <p>
              No model matches “{typed}”.
              {examples.length ? ` Try ${examples.map((example) => `“${example}”`).join(" or ")}.` : null}
            </p>
            {/* Admin > Search: both fields blank hides the help link (as in the phone menu and search). */}
            {data.search.help.href && data.search.help.label ? (
              <IntentLink href={data.search.help.href} onClick={onNavigate} className="mt-2 inline-block font-medium text-purple-deep underline underline-offset-4">
                {data.search.help.label}
              </IntentLink>
            ) : null}
          </div>
        )}
      </div>

      {section.image ? <Promo section={section} image={section.image} onNavigate={onNavigate} /> : null}
    </div>
  )
}

function Promo({ section, image, onNavigate }: { section: NavSection; image: string; onNavigate: () => void }) {
  const body = (
    <>
      <span className="relative block aspect-square overflow-hidden rounded-[14px] bg-field">
        <Picture src={image} sizes="260px" className="object-contain p-4 transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
      </span>
      <span className="mt-3 block text-[17px] font-semibold text-ink">{section.label}</span>
      {section.href ? <span className="mt-0.5 block text-[13px] text-ink-muted transition-colors group-hover:text-purple">Shop all &rsaquo;</span> : null}
    </>
  )
  return section.href ? (
    <IntentLink href={section.href} onClick={onNavigate} className="group block self-start">
      {body}
    </IntentLink>
  ) : (
    <div className="self-start">{body}</div>
  )
}

/** Case styles as photo cards with their lowest price for the section's form, each on the shopper's phone when known. */
function StylesPanel({ section, data, audience, onNavigate }: MegaPanelProps) {
  const [remembered, setRemembered] = useState<string | null>(null)
  useEffect(() => {
    setRemembered(data.rememberDevice ? phoneOf(readDevice(), data.devices)?.[0] ?? null : null)
  }, [data.rememberDevice, data.devices])
  const form = sectionForm(section)

  return (
    <ul className="grid grid-cols-3 gap-4 p-6">
      {stylesOf(section, data).map((caseType) => {
        const [slug, name, , image] = caseType
        const fromPrice = styleFromPrice(caseType, form)
        return (
          <li key={slug} className="w-[210px]">
            <IntentLink href={caseStyleHref(caseType, section, data, audience, remembered)} onClick={onNavigate} className="group block">
              <span className="relative block aspect-square overflow-hidden rounded-[12px] bg-field">
                {image ? (
                  <Picture src={image} sizes="210px" className="object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none" />
                ) : (
                  <Initial label={name} />
                )}
              </span>
              <span className="mt-3 block text-[15px] font-semibold text-ink transition-colors group-hover:text-purple">{name}</span>
              {fromPrice != null ? <span className="mt-0.5 block text-[13px] text-ink-muted">from {price(fromPrice)}</span> : null}
            </IntentLink>
          </li>
        )
      })}
    </ul>
  )
}

/** This mode's collections marked Show in menu, then the way to all of them. */
function CollectionsPanel({ section, data, audience, onNavigate }: MegaPanelProps) {
  const config = collectionsConfig(section)
  return (
    <div className="p-6">
      <ul className="grid grid-cols-4 gap-4">
        {collectionsFor(data, audience, config.limit).map(([slug, title, image, contain]) => (
          <li key={slug} className="w-[150px]">
            <IntentLink href={`/collection/${slug}/`} onClick={onNavigate} className="group block">
              <span className="relative block aspect-square overflow-hidden rounded-[12px] bg-field">
                {image ? <Picture src={image} sizes="150px" className={contain ? "object-contain p-2" : "object-cover"} /> : <Initial label={title} size="text-[24px]" />}
              </span>
              <span className="mt-2 line-clamp-2 block text-[14px] leading-[1.3] text-ink transition-colors group-hover:text-purple">{title}</span>
            </IntentLink>
          </li>
        ))}
      </ul>
      <IntentLink href={config.view_all_href} onClick={onNavigate} className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-ink transition-colors hover:text-purple">
        View all collections
        <ArrowRight size={14} aria-hidden="true" />
      </IntentLink>
    </div>
  )
}

/** A hand-made section: one column per group. */
function LinksPanel({ section, onNavigate }: MegaPanelProps) {
  return (
    <div className="flex gap-12 p-6">
      {section.groups
        .filter((group) => group.links.length > 0)
        .map((group, i) => (
          <div key={`${group.heading ?? ""}${i}`} className="min-w-[160px]">
            {group.heading ? <p className="mb-3 text-[15px] font-semibold text-ink">{group.heading}</p> : null}
            <ul className="space-y-2">
              {group.links.map((link, j) => (
                <li key={`${link.href}${j}`}>
                  <IntentLink href={link.href} onClick={onNavigate} className="inline-flex items-center gap-1.5 text-[14px] text-ink-muted transition-colors hover:text-purple">
                    {link.label}
                    {link.badge ? <NavBadge>{link.badge}</NavBadge> : null}
                  </IntentLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  )
}
