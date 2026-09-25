"use client"

import { ArrowRight, Smartphone } from "lucide-react"
import Image from "next/image"
import { startTransition, useEffect, useMemo, useState } from "react"

import IntentLink from "@/components/header/intent-link"
import type { Audience } from "@/lib/audience"
import type { HeaderData } from "@/lib/header-data"
import {
  designLink,
  designMeta,
  didYouMean,
  exactModel,
  forMode,
  imageUrl,
  linkContext,
  marked,
  modelLink,
  newestPerFamily,
  prepare,
  search,
  styleHref,
  stylePrice,
  taka,
  type LinkContext,
  type Prepared,
  type SearchResult,
} from "@/lib/search/engine"
import { loadSearchIndex } from "@/lib/search/load-index"

import { Group, Later, TryChips } from "./search-sheet"

/*
 * The search sheet's results (lazy: loaded on the first sign of wanting to
 * search, with the index). One search per animation frame, rendered in a
 * transition so typing never waits for the list. Phones show one column:
 * Models, Designs, Collections, Styles, Categories, See all; from 1024px the
 * designs become a grid on the right (search.css).
 */

export type SearchResultsProps = {
  query: string
  audience: Audience
  data: HeaderData
  /** The remembered phone (an active device's slug), or null. */
  device: string | null
  /** Put words in the field (Try, Did you mean). */
  onPick: (q: string) => void
  /** A result was chosen: remember the words and close the sheet. */
  onChoose: () => void
  /** How many results there are, for the live region. */
  onCount: (count: number) => void
  /** Where Enter goes for some words (a model's shop, or null), once the index is in; null before. */
  onEngine: (exact: ((q: string) => string | null) | null) => void
}

const MODE = { women: "Women", men: "Men" } as const

/** The prepared index, kept for the session: reopening the sheet shows results at once. */
let session: Prepared | null = null

/** Hosts the Next optimizer serves (next.config.ts remotePatterns); others load as they are. */
const OPTIMIZED = /^https:\/\/(?:[a-z0-9-]+\.)*r2\.dev\/|^https:\/\/img\.florayn\.com\//i

/** A result picture; a missing model render falls back to the design's own picture. */
function Thumb({ src, fallback = "", sizes, small }: { src: string; fallback?: string; sizes: string; small?: boolean }) {
  const [url, setUrl] = useState(src)
  return (
    <span className={small ? "fl-sr-thumb fl-sr-thumb--sm" : "fl-sr-thumb"} aria-hidden="true">
      {url ? (
        <Image
          src={url}
          alt=""
          fill
          sizes={sizes}
          unoptimized={!OPTIMIZED.test(url)}
          onError={() => setUrl(url !== fallback ? fallback : "")}
          className="object-contain"
        />
      ) : null}
    </span>
  )
}

function ModelRow({ P, i, links, onChoose }: { P: Prepared; i: number; links: LinkContext; onChoose: () => void }) {
  const [, name, , badge] = P.x.dv[i]
  return (
    <IntentLink data-sr-item href={modelLink(P, i, links)} onClick={onChoose} className="fl-sr-row">
      <Smartphone size={18} aria-hidden="true" className="shrink-0 text-ink-muted" />
      <span className="min-w-0 truncate">{name}</span>
      {badge ? <span className="fl-sr-badge">{badge}</span> : null}
    </IntentLink>
  )
}

export default function SearchResults({ query, audience, data, device, onPick, onChoose, onCount, onEngine }: SearchResultsProps) {
  const [index, setIndex] = useState<Prepared | null>(session)
  const [failed, setFailed] = useState(false)
  const [found, setFound] = useState<{ q: string; result: SearchResult } | null>(null)
  const sections = audience === "men" && data.men ? data.men : data.women
  const links = useMemo(
    () => linkContext(sections, Object.fromEntries(data.caseTypes.map((c) => [c[0], c[4]]))),
    [sections, data.caseTypes]
  )
  const suggest = audience === "men" ? data.search.suggest.men : data.search.suggest.women

  // The index, once per session; after a failure the next word tries again.
  const retry = failed ? query : ""
  useEffect(() => {
    if (index) return
    let live = true
    loadSearchIndex().then(
      (raw) => {
        session = prepare(raw)
        if (!live) return
        setIndex(session)
        setFailed(false)
      },
      () => {
        if (live) setFailed(true)
      }
    )
    return () => {
      live = false
    }
  }, [index, retry])

  // Enter opens a model's shop when the words name exactly one model.
  useEffect(() => {
    if (!index) return
    onEngine((q) => {
      const i = exactModel(index, q)
      return i == null ? null : modelLink(index, i, links)
    })
    return () => onEngine(null)
  }, [index, links, onEngine])

  useEffect(() => {
    if (!index) return
    const frame = window.requestAnimationFrame(() => {
      const result = search(index, query, { audience, device, typing: true, links })
      startTransition(() => setFound({ q: query.trim(), result }))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [index, query, audience, device, links])

  const view = useMemo(() => {
    if (!index || !found) return null
    const { result } = found
    const { designs, other } = forMode(index, result.designs, audience)
    const models = result.models.slice(0, 3)
    const collections = result.collections.slice(0, 3)
    const styles = result.styles.slice(0, 2)
    const categories = result.categories.slice(0, 2)
    return {
      models,
      designs: designs.slice(0, 8),
      other,
      collections,
      styles,
      categories,
      count: models.length + designs.length + collections.length + styles.length + categories.length,
    }
  }, [index, found, audience])

  useEffect(() => {
    if (view) onCount(view.count)
  }, [view, onCount])

  if (!index) {
    return failed ? <p className="fl-sr-note">Press Enter to search</p> : <Later><p className="fl-sr-note">Loading…</p></Later>
  }
  if (!view || !found) return null
  const P = index
  const { q, result } = found

  if (!view.count) {
    const guess = didYouMean(P, q)
    return (
      <div className="pb-2">
        <p className="pt-5 text-[15px] font-medium text-ink">No matches for “{q}”</p>
        {guess ? (
          <button type="button" data-sr-item onClick={() => onPick(guess)} className="fl-sr-row mt-1 w-full text-left">
            <span>
              Did you mean <b className="font-semibold">{guess}</b>?
            </span>
          </button>
        ) : null}
        <TryChips id="sr-none-try" words={suggest} onPick={onPick} />
        <Group id="sr-phones" title="Shop by phone">
          <ul>
            {newestPerFamily(P).map((i) => (
              <li key={i}>
                <ModelRow P={P} i={i} links={links} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        </Group>
        {data.search.help.label && data.search.help.href ? (
          <IntentLink data-sr-item href={data.search.help.href} onClick={onChoose} className="fl-sr-all">
            {data.search.help.label}
            <ArrowRight size={16} aria-hidden="true" />
          </IntentLink>
        ) : null}
      </div>
    )
  }

  const remembered = device ? P.x.dv.findIndex((d) => d[0] === device) : -1
  const styleDevice = result.model ?? (remembered < 0 ? null : remembered)

  return (
    <div className="fl-sr pb-2">
      {view.models.length ? (
        <Group id="sr-models" title="Models">
          <ul>
            {view.models.map((i) => (
              <li key={i}>
                <ModelRow P={P} i={i} links={links} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {view.designs.length ? (
        <Group id="sr-designs" title={result.close ? "Close matches" : "Designs"} className="fl-sr-main">
          {view.other ? (
            <p className="mb-2 text-[13px] text-ink-muted">
              No matches in {MODE[audience]}. Showing {MODE[audience === "men" ? "women" : "men"]} designs.
            </p>
          ) : null}
          <ul className="fl-sr-designs">
            {view.designs.map((hit, n) => {
              const link = designLink(P, hit)
              return (
                <li key={hit.p} className={n >= 6 ? "max-lg:hidden" : undefined}>
                  <IntentLink data-sr-item href={link.href} onClick={onChoose} className="fl-sr-design">
                    <Thumb key={link.src} src={link.src} fallback={link.fallback} sizes="(min-width: 1024px) 160px, 56px" />
                    <span className="min-w-0">
                      <span className="fl-sr-design__name">
                        {marked(P, P.x.p[hit.p][1], hit.marks).map(([text, match], k) =>
                          match ? <mark key={k} className="bg-transparent font-semibold text-ink">{text}</mark> : text
                        )}
                      </span>
                      <span className="fl-sr-design__meta">{designMeta(P, hit)}</span>
                    </span>
                  </IntentLink>
                </li>
              )
            })}
          </ul>
        </Group>
      ) : null}

      {view.collections.length ? (
        <Group id="sr-collections" title="Collections">
          <ul>
            {view.collections.map((k) => {
              const [slug, title, image] = P.x.col[k]
              return (
                <li key={slug}>
                  <IntentLink data-sr-item href={`/collection/${slug}/`} onClick={onChoose} className="fl-sr-row">
                    <Thumb src={imageUrl(P, image)} sizes="40px" small />
                    <span className="min-w-0 truncate">{title}</span>
                  </IntentLink>
                </li>
              )
            })}
          </ul>
        </Group>
      ) : null}

      {view.styles.length ? (
        <Group id="sr-styles" title="Styles">
          <ul>
            {view.styles.map((k) => {
              const [slug, name] = P.x.ct[k]
              const fromPrice = stylePrice(P, k, styleDevice)
              return (
                <li key={slug}>
                  <IntentLink data-sr-item href={styleHref(P, k, styleDevice, links)} onClick={onChoose} className="fl-sr-row">
                    <span className="min-w-0 truncate">
                      {name}
                      {fromPrice != null ? <span className="text-ink-muted"> · from {taka(fromPrice)}</span> : null}
                    </span>
                  </IntentLink>
                </li>
              )
            })}
          </ul>
        </Group>
      ) : null}

      {view.categories.length ? (
        <Group id="sr-categories" title="Categories">
          <ul>
            {view.categories.map((k) => {
              const [label, href, image] = P.x.cat[k]
              return (
                <li key={href}>
                  <IntentLink data-sr-item href={href} onClick={onChoose} className="fl-sr-row">
                    <Thumb src={imageUrl(P, image)} sizes="40px" small />
                    <span className="min-w-0 truncate">{label}</span>
                  </IntentLink>
                </li>
              )
            })}
          </ul>
        </Group>
      ) : null}

      <TryChips id="sr-side-try" words={suggest} onPick={onPick} className="max-lg:hidden" />

      <IntentLink data-sr-item href={`/search/?q=${encodeURIComponent(q)}`} onClick={onChoose} className="fl-sr-all">
        <span className="min-w-0 truncate">See all results for “{q}”</span>
        <ArrowRight size={16} aria-hidden="true" className="shrink-0" />
      </IntentLink>
    </div>
  )
}
