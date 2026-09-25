"use client"

import { ArrowRight, Check, Smartphone } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react"

import Link from "@/components/audience-link"
import ProductCard from "@/components/product-card"
import { withAudience, type Audience } from "@/lib/audience"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { phoneOf, readDevice } from "@/lib/remembered-device"
import {
  designPrices,
  didYouMean,
  forMode,
  modelLink,
  newestPerFamily,
  pairPrice,
  prepare,
  renderUrl,
  search,
  sells,
  styleHref,
  stylePrice,
  taka,
  thumbUrl,
  type DesignHit,
  type LinkContext,
  type Prepared,
} from "@/lib/search/engine"
import { loadSearchIndex } from "@/lib/search/load-index"

/** Cards per step: 24, then Show more adds 24. */
const PAGE = 24
const MODE = { women: "Women", men: "Men" } as const
const CHIP = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-field px-4 text-[14px] text-ink transition-colors hover:text-purple-deep"

/** The results while the index loads: 8 empty cards. */
function GridSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mt-6 h-6 w-56 max-w-full rounded-full bg-field" />
      <div className="fl-grid mt-6">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square rounded-[10px] bg-field" />
        ))}
      </div>
    </div>
  )
}

const subscribeNothing = () => () => {}
/**
 * False on the server and while hydrating, true from then on (and at once on
 * a client-side visit). The page is one static HTML for every ?q=, built with
 * no words, so nothing that depends on them may render before this is true:
 * the first render in the browser then matches the HTML (no React #418).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false)
}

/** The whole page before the browser knows the words (the static HTML). */
export function SearchSkeleton({ placeholder }: { placeholder: string }) {
  return (
    <div aria-busy="true">
      <div className="flex h-12 w-full max-w-[640px] items-center rounded-full bg-field px-5 text-[16px] text-ink-muted">
        <span className="truncate">{placeholder}</span>
      </div>
      <GridSkeleton />
    </div>
  )
}

/**
 * A ProductCard from an index row, built like the shop's light cards
 * (shop-view.tsx). Its variants are what the design really costs: with a
 * model, one per style it is sold in for that model, so the card shows the
 * named style's exact price; without one, one per price it has, so a spread
 * reads "From". The picture is the model's render only when the design's
 * renders are known; otherwise the card falls back to the design's own.
 */
export function cardFor(P: Prepared, hit: DesignHit) {
  const [handle, name, design, form, , caseTypes, , , fromPrice] = P.x.p[hit.p]
  const caseType = hit.ct == null ? null : P.x.ct[hit.ct]
  const device = hit.device == null ? null : P.x.dv[hit.device]
  const variant = (style: string, amount: number | null, image: string) => ({
    // No variant id: Quick Add stays hidden and the card opens the product page.
    id: "",
    title: style,
    options: [{ value: device?.[1] ?? "" }, { value: style }],
    calculated_price: amount == null ? null : { calculated_amount: amount },
    metadata: { images: image ? [image] : [] },
  }) as unknown as StoreVariant
  const at = hit.device
  let variants = at == null
    ? []
    : caseTypes
      .filter((k) => sells(P, hit.p, k, at))
      .map((k) => variant(P.x.ct[k][1], pairPrice(P, hit.p, k, at), k === hit.ct ? renderUrl(P, hit.p, k, at) : ""))
  if (!variants.length) variants = designPrices(P, hit.p, null).map((amount) => variant("", amount, ""))
  if (!variants.length) variants = [variant("", fromPrice, "")]
  return {
    product: {
      id: `search-${handle}`,
      title: name,
      handle,
      thumbnail: thumbUrl(P, hit.p) || null,
      metadata: { design_name: name, design_slug: design, form },
      variants,
    } as unknown as StoreProduct,
    device: device?.[1] ?? null,
    deviceSlug: device?.[0] ?? null,
    caseType: caseType?.[1] ?? null,
    caseTypeSlug: caseType?.[0] ?? null,
  }
}

function Chips({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      {title ? <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[.06em] text-ink-muted">{title}</h2> : null}
      <ul className="flex flex-wrap gap-2">{children}</ul>
    </div>
  )
}

/** Where to go next when there is nothing (yet): Try words and each family's newest model. */
function Suggestions({ P, suggest, links }: { P: Prepared | null; suggest: string[]; links: LinkContext }) {
  return (
    <>
      {suggest.length ? (
        <Chips title="Try">
          {suggest.map((word) => (
            <li key={word}>
              <Link href={`/search/?q=${encodeURIComponent(word)}`} prefetch={false} className={CHIP}>{word}</Link>
            </li>
          ))}
        </Chips>
      ) : null}
      {P ? (
        <Chips title="Shop by phone">
          {newestPerFamily(P).map((i) => {
            const [slug, name] = P.x.dv[i]
            return (
              <li key={slug}>
                <Link href={modelLink(P, i, links)} prefetch={false} className={CHIP}>
                  <Smartphone size={16} aria-hidden="true" className="text-ink-muted" />
                  {name}
                </Link>
              </li>
            )
          })}
        </Chips>
      ) : null}
    </>
  )
}

export default function SearchPageClient({
  audience,
  links,
  placeholder,
  suggest,
  help,
  rememberDevice,
}: {
  audience: Audience
  links: LinkContext
  placeholder: string
  /** This mode's Try suggestions (Admin > Search). */
  suggest: string[]
  help: { label: string; href: string }
  rememberDevice: boolean
}) {
  const router = useRouter()
  const hydrated = useHydrated()
  const address = (useSearchParams().get("q") ?? "").trim()
  // The words only once hydrated: the static HTML was built without them.
  const q = hydrated ? address : ""
  const [value, setValue] = useState(q)
  /** The words the address has, or is about to have. */
  const inAddress = useRef(q)
  const [index, setIndex] = useState<Prepared | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [device, setDevice] = useState<string | null>(null)
  const [more, setMore] = useState({ q, limit: PAGE })
  const limit = more.q === q ? more.limit : PAGE

  // Back, forward or the header's search changed the words: show them.
  useEffect(() => {
    if (q === inAddress.current) return
    inAddress.current = q
    setValue(q)
  }, [q])

  useEffect(() => {
    if (rememberDevice) setDevice(readDevice())
  }, [rememberDevice])

  useEffect(() => {
    let live = true
    loadSearchIndex().then(
      (raw) => {
        if (live) setIndex(prepare(raw))
      },
      () => {
        if (live) setFailed(true)
      }
    )
    return () => {
      live = false
    }
  }, [attempt])

  const go = useCallback((words: string) => {
    inAddress.current = words
    router.replace(withAudience(words ? `/search/?q=${encodeURIComponent(words)}` : "/search/", audience), { scroll: false })
  }, [router, audience])

  // The address follows the field after a pause, without a new history entry or a scroll.
  useEffect(() => {
    const words = value.trim()
    if (words === inAddress.current) return
    const timer = window.setTimeout(() => go(words), 250)
    return () => window.clearTimeout(timer)
  }, [value, go])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const words = value.trim()
    if (words !== inAddress.current) go(words)
    // Put the phone keyboard away so the results show.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  // Only a phone counts as the remembered model: a stale AirPods/watch/wallet slug reads as none.
  const phone = index ? phoneOf(device, index.x.dv)?.[0] ?? null : null
  const result = useMemo(() => (index && q ? search(index, q, { audience, device: phone, links }) : null), [index, q, audience, phone, links])
  const mode = useMemo(() => (index && result ? forMode(index, result.designs, audience) : null), [index, result, audience])

  // Exactly the static HTML (and the Suspense fallback) until hydrated.
  if (!hydrated) return <SearchSkeleton placeholder={placeholder} />

  let body: ReactNode
  if (!q) {
    body = <Suggestions P={index} suggest={suggest} links={links} />
  } else if (!index || !result || !mode) {
    body = failed ? (
      <p role="status" className="mt-6 text-[15px] text-ink-muted">
        Search could not load.{" "}
        <button
          type="button"
          onClick={() => {
            setFailed(false)
            setAttempt((n) => n + 1)
          }}
          className="font-medium text-purple underline underline-offset-4"
        >
          Try again
        </button>
      </p>
    ) : (
      <GridSkeleton />
    )
  } else {
    const P = index
    const model = result.model == null ? null : { name: P.x.dv[result.model][1], href: modelLink(P, result.model, links) }
    const remembered = phone ? P.x.dv.findIndex((d) => d[0] === phone) : -1
    const styleDevice = result.model ?? (remembered < 0 ? null : remembered)
    const count = mode.designs.length
    const collections = result.collections.slice(0, 6)
    const styles = result.styles.slice(0, 3)
    const guess = count ? null : didYouMean(P, q)

    body = (
      <>
        <h2 className="mt-6 text-[20px] font-semibold tracking-[-0.01em] text-ink" aria-live="polite">
          {count ? `${count} ${count === 1 ? "design" : "designs"} for “${q}”` : `No matches for “${q}”`}
        </h2>

        {model ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-purple-tint px-3 text-[13px] font-medium text-purple-deep">
              <Check size={14} aria-hidden="true" />
              Fits {model.name}
            </span>
            <Link href={model.href} prefetch={false} className="inline-flex min-h-10 items-center gap-1 font-medium text-purple-deep hover:text-purple">
              Open the {model.name} shop
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : null}

        {collections.length || styles.length ? (
          <Chips>
            {collections.map((k) => {
              const [slug, title] = P.x.col[k]
              return (
                <li key={`c-${slug}`}>
                  <Link href={`/collection/${slug}/`} prefetch={false} className={CHIP}>{title}</Link>
                </li>
              )
            })}
            {styles.map((k) => {
              const [slug, name] = P.x.ct[k]
              const fromPrice = stylePrice(P, k, styleDevice)
              return (
                <li key={`s-${slug}`}>
                  <Link href={styleHref(P, k, styleDevice, links)} prefetch={false} className={CHIP}>
                    {name}
                    {fromPrice != null ? <span className="text-ink-muted">· from {taka(fromPrice)}</span> : null}
                  </Link>
                </li>
              )
            })}
          </Chips>
        ) : null}

        {count ? (
          <>
            {mode.other ? (
              <p className="mt-4 text-[14px] text-ink-muted">
                No matches in {MODE[audience]}. Showing {MODE[audience === "men" ? "women" : "men"]} designs.
              </p>
            ) : null}
            {result.close ? (
              <p className="mt-6 text-[12px] font-semibold uppercase tracking-[.06em] text-ink-muted">Close matches</p>
            ) : null}
            <div className="fl-grid mt-4">
              {mode.designs.slice(0, limit).map((hit, i) => {
                const card = cardFor(P, hit)
                return <ProductCard key={card.product.id} {...card} priority={i < 4} fetchPriority={i < 4 ? "high" : "low"} />
              })}
            </div>
            {count > limit ? (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setMore({ q, limit: limit + PAGE })}
                  className="h-12 rounded-full border border-line px-8 text-[14px] font-medium text-ink transition-colors hover:border-ink"
                >
                  Show more
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {guess ? (
              <p className="mt-3 text-[15px] text-ink">
                Did you mean{" "}
                <Link href={`/search/?q=${encodeURIComponent(guess)}`} prefetch={false} className="font-semibold underline underline-offset-4 hover:text-purple">
                  {guess}
                </Link>
                ?
              </p>
            ) : null}
            <Suggestions P={P} suggest={suggest} links={links} />
            {help.label && help.href ? (
              <Link href={help.href} prefetch={false} className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-purple-deep hover:text-purple">
                {help.label}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : null}
          </>
        )}
      </>
    )
  }

  return (
    <div className="fl-spage">
      <form role="search" action={withAudience("/search/", audience)} method="get" onSubmit={submit} className="max-w-[640px]">
        <input
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Search"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-12 w-full max-w-[640px] rounded-full bg-field px-5 text-[16px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
        />
      </form>
      {body}
    </div>
  )
}
