"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, BadgeCheck, Camera, Check, Copy, MessageSquare, Star, X } from "lucide-react"
import type { ReviewPage } from "@/lib/product-reviews"
import { getReviewProgram, loadReviewPage, submitReview, uploadReviewPhoto, type ReviewProgramInfo, type SubmitResult } from "@/lib/review-actions"

export function ReviewStars({ rating }: { rating: number }) {
  return <span className="fl-review-stars" aria-label={`${rating.toFixed(1)} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} fill={n <= Math.round(rating) ? "currentColor" : "none"} aria-hidden="true" />)}</span>
}

/** Shrink a photo in the browser (longest side 1600px, JPEG) before it is sent. */
async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/jpeg", 0.82)
}

type Done = Extract<SubmitResult, { ok: true }>

/**
 * Customer reviews. "section" is a standalone band with its own heading and
 * the #customer-reviews id. "accordion" sits inside the product information
 * list's Reviews row, which owns the heading and the id; it opens that row
 * whenever something links to #customer-reviews (the stars under the gallery,
 * the sign-in return link, or a review request email).
 *
 * A review request email links here with ?review=<token>&r=<stars>: the form
 * opens with those stars and the customer's name, and needs no sign-in.
 */
export default function ProductReviews({ productId, pagePath, initial, heading, intro, variant = "section" }: {
  productId: string; pagePath: string; initial: ReviewPage | null; heading: string; intro: string
  variant?: "section" | "accordion"
}) {
  const rootRef = useRef<HTMLElement>(null)
  const revealRow = () => {
    const row = rootRef.current?.closest("details")
    if (row) row.open = true
  }
  useEffect(() => {
    if (variant !== "accordion") return
    if (window.location.hash === "#customer-reviews") revealRow()
    const onHash = () => { if (window.location.hash === "#customer-reviews") revealRow() }
    // Runs before the browser follows the link, so it scrolls to an open row.
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('a[href$="#customer-reviews"]')) revealRow()
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
  const [author, setAuthor] = useState("")
  const [error, setError] = useState("")
  const [pageError, setPageError] = useState("")
  const [signIn, setSignIn] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [copied, setCopied] = useState(false)
  const [program, setProgram] = useState<ReviewProgramInfo | null>(null)
  const [reviewToken, setReviewToken] = useState<string | undefined>()
  const [linkNote, setLinkNote] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, start] = useTransition()
  const [loading, load] = useTransition()
  const formRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollPending = useRef(false)

  function showForm() {
    scrollPending.current = true
    revealRow()
    setOpen(true)
    if (open) formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  // Scroll once the form is actually on the page (it renders after setOpen).
  useEffect(() => {
    if (!open || !scrollPending.current) return
    scrollPending.current = false
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }, [open])
  function write() {
    showForm()
    if (!program) void getReviewProgram(reviewToken).then((info) => info && setProgram(info))
  }

  // A review request email: open the form with the chosen stars and the
  // customer's name, then drop the link's token from the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("review")
    if (!token) return
    const stars = Number(params.get("r"))
    params.delete("review"); params.delete("r")
    const rest = params.toString()
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`)
    void getReviewProgram(token).then((info) => {
      if (info) setProgram(info)
      if (!info?.invite) { setLinkNote(info?.invite_invalid ? "This review link is not valid any more. Sign in to write a review." : ""); showForm(); return }
      setReviewToken(token)
      if (stars >= 1 && stars <= 5) setRating(Math.round(stars))
      if (info.invite.name) setAuthor(info.invite.name)
      showForm()
    })
  }, [])

  function getPage(offset: number) {
    load(async () => {
      setPageError("")
      const next = await loadReviewPage(productId, offset)
      if (!next) { setPageError("Reviews could not be loaded. Please try again."); return }
      setData(next)
    })
  }

  const maxPhotos = program?.max_photos ?? 3
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setError(""); setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, maxPhotos - photos.length)) {
        if (!file.type.startsWith("image/")) { setError("Photos only, please."); continue }
        if (file.size > 20 * 1024 * 1024) { setError("That photo is too large."); continue }
        const image = await shrinkPhoto(file).catch(() => null)
        if (!image) { setError("That photo could not be read. Try a JPEG or PNG."); continue }
        const result = await uploadReviewPhoto(image, reviewToken)
        if (result.ok) setPhotos((list) => [...list, result.url].slice(0, maxPhotos))
        else setError(result.error)
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const rewards = program?.rewards
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
          <div className="fl-review__byline"><span className="fl-review__avatar" aria-hidden="true">{r.author.slice(0, 1).toUpperCase()}</span><div><strong>{r.author}{r.verified ? <span className="fl-review__verified"><BadgeCheck size={13} aria-hidden="true" />Verified buyer</span> : null}</strong><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></div><ReviewStars rating={r.rating} /></div>
          {r.title ? <h3>{r.title}</h3> : null}<p>{r.body}</p>
          {r.images?.length ? <ul className="fl-review__photos" aria-label={`Photos from ${r.author}`}>{r.images.map((src, i) => <li key={src}><a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Photo ${i + 1} from ${r.author}, opens full size`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt="" loading="lazy" decoding="async" /></a></li>)}</ul> : null}
          {r.reply ? <div className="fl-review__reply"><strong>Florayn replied</strong><p>{r.reply}</p></div> : null}
        </article>)}</div>
        {data.count > data.limit && <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Review pages"><button disabled={loading || data.offset === 0} onClick={() => getPage(Math.max(0, data.offset - data.limit))}>← Previous</button><span>{Math.floor(data.offset / data.limit) + 1} / {Math.ceil(data.count / data.limit)}</span><button disabled={loading || data.offset + data.limit >= data.count} onClick={() => getPage(data.offset + data.limit)}>Next →</button></nav>}</> : !open ? <div className="fl-reviews__invitation"><Star size={24} aria-hidden="true" /><h3>Your experience can help someone choose.</h3><p>Share the details you loved, and anything we could do better.</p><button type="button" onClick={write}>Share your experience <ArrowRight size={16} /></button></div> : null}
        {pageError && <p role="alert" className="mt-3 text-sm text-danger">{pageError}</p>}
        {open && <div ref={formRef} className="fl-review-form">
          {done ? <div role="status" className="fl-review-thanks">
            <span className="fl-review-thanks__stars" aria-hidden="true">★★★★★</span>
            {done.reward ? <>
              <h3>Thank you! Here is your {done.reward.pct}% off</h3>
              <p>Use it on your next order.</p>
              <div className="fl-review-thanks__code"><span>{done.reward.code}</span><button type="button" onClick={() => { void navigator.clipboard?.writeText(done.reward!.code); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? <><Check size={14} aria-hidden="true" />Copied</> : <><Copy size={14} aria-hidden="true" />Copy</>}</button></div>
              <p className="fl-review-thanks__small">A copy is on its way to your email. It works once at checkout.</p>
            </> : done.status === "pending" && done.pendingRewardPct ? <>
              <h3>Thank you for your review</h3>
              <p>We are checking it now. Your <strong>{done.pendingRewardPct}% off</strong> code will be emailed to you as soon as it is published.</p>
            </> : done.status === "pending" ? <>
              <h3>Thank you for your review</h3>
              <p>We are checking it now. It will appear here once it is published.</p>
            </> : <>
              <h3>Thank you for your review</h3>
              <p>It is live on the site now.</p>
            </>}
          </div> : <form onSubmit={(e) => {
            e.preventDefault()
            if (!rating || busy || uploading) { if (!rating) setError("Please choose a star rating."); return }
            const values = new FormData(e.currentTarget)
            start(async () => {
              setError(""); setSignIn(false)
              const result = await submitReview(productId, { rating, author: String(values.get("author") ?? ""), title: String(values.get("title") ?? ""), body: String(values.get("body") ?? ""), images: photos }, reviewToken)
              if (result.ok) setDone(result)
              else { setError(result.error ?? "Could not submit your review."); setSignIn(!!result.signIn) }
            })
          }}>
            <h3>Write a review</h3>
            {reviewToken ? <p>Thanks for ordering. No sign-in needed on this link. Your display name will be public.</p> : <p>{program?.auto_approve ? "" : "Reviews appear after moderation. "}Your display name will be public.</p>}
            {linkNote ? <p role="alert" className="text-danger">{linkNote}</p> : null}
            {rewards && (rewards.photo_pct > 0 || rewards.text_pct > 0) ? <p className="fl-review-form__offer">Add a photo with your review and get <strong>{rewards.photo_pct}% off</strong> your next order — a few words alone gets <strong>{rewards.text_pct}% off</strong>.</p> : null}
            <fieldset disabled={busy}><legend>Your rating</legend><div className="fl-review-form__rating">{[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} /><Star size={26} fill={n <= rating ? "currentColor" : "none"} aria-hidden="true" /></label>)}</div>
            <div className="fl-review-form__fields"><label>Display name<input name="author" autoComplete="nickname" required minLength={2} maxLength={60} value={author} onChange={(e) => setAuthor(e.target.value)} /></label><label>Headline (optional)<input name="title" maxLength={120} placeholder="Sum it up in a few words" /></label></div>
            <label>Your review<textarea name="body" required minLength={2} maxLength={3000} rows={4} /></label>
            <div className="fl-review-form__photos">
              <span className="fl-review-form__label">Photos (up to {maxPhotos}, optional)</span>
              <ul>
                {photos.map((src, i) => <li key={src}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={`Your photo ${i + 1}`} /><button type="button" onClick={() => setPhotos((list) => list.filter((p) => p !== src))} aria-label={`Remove photo ${i + 1}`}><X size={13} aria-hidden="true" /></button></li>)}
                {photos.length < maxPhotos ? <li><label className="fl-review-form__add"><Camera size={18} aria-hidden="true" /><span>{uploading ? "Adding…" : "Add photos"}</span><input ref={fileRef} type="file" accept="image/*" multiple disabled={uploading} onChange={(e) => void addPhotos(e.target.files)} className="sr-only" /></label></li> : null}
              </ul>
            </div>
            <div className="fl-review-form__buttons"><button type="submit" disabled={uploading}>{busy ? "Submitting…" : "Submit review"}</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
            </fieldset>
            {error && <p role="alert" className="text-danger">{error}</p>}
            {signIn && <Link className="font-semibold text-purple underline" href={`/account/login/?returnTo=${encodeURIComponent(pagePath + "#customer-reviews")}`}>Sign in to continue →</Link>}
          </form>}
        </div>}
      </div>
    </div>
  </section>
}
