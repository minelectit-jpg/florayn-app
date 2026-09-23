"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, MessageSquare, Star } from "lucide-react"
import type { ReviewPage } from "@/lib/product-reviews"
import { loadReviewPage, submitReview } from "@/lib/review-actions"

export function ReviewStars({ rating }: { rating: number }) {
  return <span className="fl-review-stars" aria-label={`${rating.toFixed(1)} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} fill={n <= Math.round(rating) ? "currentColor" : "none"} aria-hidden="true" />)}</span>
}
/**
 * Customer reviews. "section" is a standalone band with its own heading and
 * the #customer-reviews id. "accordion" sits inside the product information
 * list's Reviews row, which owns the heading and the id; it opens that row
 * whenever something links to #customer-reviews (the stars under the gallery,
 * or the sign-in return link).
 */
export default function ProductReviews({ productId, pagePath, initial, heading, intro, variant = "section" }: {
  productId: string; pagePath: string; initial: ReviewPage | null; heading: string; intro: string
  variant?: "section" | "accordion"
}) {
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (variant !== "accordion") return
    const row = rootRef.current?.closest("details")
    if (!row) return
    const reveal = () => { row.open = true }
    if (window.location.hash === "#customer-reviews") reveal()
    const onHash = () => { if (window.location.hash === "#customer-reviews") reveal() }
    // Runs before the browser follows the link, so it scrolls to an open row.
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('a[href$="#customer-reviews"]')) reveal()
    }
    window.addEventListener("hashchange", onHash)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("hashchange", onHash)
      document.removeEventListener("click", onClick, true)
    }
  }, [variant])
  const [data, setData] = useState(initial)
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [error, setError] = useState("")
  const [pageError, setPageError] = useState("")
  const [signIn, setSignIn] = useState(false)
  const [sent, setSent] = useState(false)
  const [busy, start] = useTransition()
  const [loading, load] = useTransition()
  const formRef = useRef<HTMLDivElement>(null)
  function write() {
    setOpen(true)
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }))
  }
  function getPage(offset: number) {
    load(async () => {
      setPageError("")
      const next = await loadReviewPage(productId, offset)
      if (!next) { setPageError("Reviews could not be loaded. Please try again."); return }
      setData(next)
    })
  }
  const inline = variant === "accordion"
  return <section ref={rootRef} id={inline ? undefined : "customer-reviews"} className={inline ? "fl-reviews fl-reviews--inline" : "fl-reviews"} aria-labelledby={inline ? "customer-reviews-heading" : "reviews-heading"}>
    <header className="fl-reviews__header">{inline ? <p>{intro}</p> : <div><p className="eyebrow">FROM OUR COMMUNITY</p><h2 id="reviews-heading">{heading}</h2><p>{intro}</p></div>}
      <button type="button" className="fl-reviews__write" onClick={write}><MessageSquare size={17} />Write a review<ArrowRight size={16} /></button>
    </header>
    <div className="fl-reviews__layout">
      <div className="fl-reviews__summary">
        {data?.count ? <><strong>{data.average!.toFixed(1)}<small>/ 5</small></strong><ReviewStars rating={data.average!} /><p>{data.count} customer review{data.count === 1 ? "" : "s"}</p>
          <div className="fl-reviews__distribution">{[5, 4, 3, 2, 1].map((n) => <div key={n}><span>{n} ★</span><span className="fl-reviews__bar"><span style={{ width: `${(data.distribution[n - 1] / data.count) * 100}%` }} /></span><span>{data.distribution[n - 1]}</span></div>)}</div></>
          : <><MessageSquare size={30} aria-hidden="true" /><h3>{data ? "Be the first to share" : "Customer stories"}</h3><p>{data ? "Tried it? Tell us what you think." : "Reviews are temporarily unavailable."}</p>{!data && <button onClick={() => getPage(0)} disabled={loading} className="underline">Try again</button>}</>}
      </div>
      <div>
        {data?.reviews.length ? <><div className="fl-reviews__list">{data.reviews.map((r) => <article key={r.id}>
          <div className="fl-review__byline"><span className="fl-review__avatar" aria-hidden="true">{r.author.slice(0, 1).toUpperCase()}</span><div><strong>{r.author}</strong><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></div><ReviewStars rating={r.rating} /></div>
          <h3>{r.title}</h3><p>{r.body}</p>{r.reply ? <div className="fl-review__reply"><strong>Florayn replied</strong><p>{r.reply}</p></div> : null}
        </article>)}</div>
        {data.count > data.limit && <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Review pages"><button disabled={loading || data.offset === 0} onClick={() => getPage(Math.max(0, data.offset - data.limit))}>← Previous</button><span>{Math.floor(data.offset / data.limit) + 1} / {Math.ceil(data.count / data.limit)}</span><button disabled={loading || data.offset + data.limit >= data.count} onClick={() => getPage(data.offset + data.limit)}>Next →</button></nav>}</> : !open ? <div className="fl-reviews__invitation"><Star size={24} aria-hidden="true" /><h3>Your experience can help someone choose.</h3><p>Share the details you loved, and anything we could do better.</p><button type="button" onClick={write}>Share your experience <ArrowRight size={16} /></button></div> : null}
        {pageError && <p role="alert" className="mt-3 text-sm text-danger">{pageError}</p>}
        {open && <div ref={formRef} className="fl-review-form">
          {sent ? <div role="status"><h3>Thank you for sharing.</h3><p>Your review has been submitted and will appear after moderation.</p></div> : <form onSubmit={(e) => {
            e.preventDefault()
            if (!rating || busy) { if (!rating) setError("Please choose a star rating."); return }
            const values = new FormData(e.currentTarget)
            start(async () => {
              setError(""); setSignIn(false)
              const result = await submitReview(productId, { rating, author: String(values.get("author") ?? ""), title: String(values.get("title") ?? ""), body: String(values.get("body") ?? "") })
              if (result.ok) setSent(true)
              else { setError(result.error ?? "Could not submit your review."); setSignIn(!!result.signIn) }
            })
          }}>
            <h3>Share your experience</h3><p>Reviews appear after moderation. Your display name will be public.</p>
            <fieldset disabled={busy}><legend>Your rating</legend><div className="fl-review-form__rating">{[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} /><Star size={26} fill={n <= rating ? "currentColor" : "none"} aria-hidden="true" /></label>)}</div>
            <div className="fl-review-form__fields"><label>Display name<input name="author" autoComplete="nickname" required minLength={2} maxLength={60} /></label><label>Review title<input name="title" required minLength={3} maxLength={120} /></label></div>
            <label>Your review<textarea name="body" required minLength={10} maxLength={3000} rows={4} /></label>
            <div className="fl-review-form__buttons"><button type="submit">{busy ? "Submitting…" : "Submit review"}</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
            </fieldset>
            {error && <p role="alert" className="text-danger">{error}</p>}
            {signIn && <Link className="font-semibold text-purple underline" href={`/account/login/?returnTo=${encodeURIComponent(pagePath + "#customer-reviews")}`}>Sign in to continue →</Link>}
          </form>}
        </div>}
      </div>
    </div>
  </section>
}

