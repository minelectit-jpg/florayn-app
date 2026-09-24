import { Badge, Button, Container, Heading, Text, Textarea, toast } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, post, ManagerSelect } from "./shared"

type Review = {
  id: string; author: string; rating: number; title: string; body: string; reply: string; status: string; created_at: string; review_key: string
  images?: string[]; verified?: boolean; email?: string | null; order_id?: string | null
  coupon_code?: string | null; reward_pct?: number | null; reward_mailed?: boolean; reward_note?: string | null
}

function ReviewRow({ review, onSaved }: { review: Review; onSaved: () => void }) {
  const [reply, setReply] = useState(review.reply)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function save(status: string) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      const result = await post(`/admin/content/product-reviews/${review.id}`, { status, reply })
      toast.success(result.reward?.code ? `Review published. Code ${result.reward.code} (${result.reward.pct}% off) created and mailed.` : "Review updated.")
      onSaved()
    }
    catch (e: any) { toast.error(e.message) } finally { lock.current = false; setBusy(false) }
  }
  return <article className="grid gap-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Text weight="plus">{review.author} · {"★".repeat(review.rating)}<span className="text-ui-fg-muted">{"★".repeat(5 - review.rating)}</span>{review.verified ? <span className="ml-2 text-xs text-ui-fg-interactive">Verified buyer</span> : null}</Text>
      <Badge color={review.status === "approved" ? "green" : review.status === "pending" ? "orange" : "grey"}>{review.status === "approved" ? "published" : review.status === "rejected" ? "hidden" : "pending"}</Badge>
    </div>
    <Text size="xsmall" className="text-ui-fg-subtle">{review.review_key.replace(/^design:/, "Design: ")} · {new Date(review.created_at).toLocaleDateString()}{review.email ? ` · ${review.email}` : ""}</Text>
    {review.title ? <Heading level="h3">{review.title}</Heading> : null}
    <Text className="whitespace-pre-wrap break-words">{review.body}</Text>
    {review.images?.length ? <div className="flex flex-wrap gap-2">{review.images.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="h-16 w-16 rounded-md border object-cover" /></a>)}</div> : null}
    {review.coupon_code
      ? <Text size="small">Reward: <strong>{review.coupon_code}</strong> ({review.reward_pct}% off){review.reward_mailed ? " · mailed" : " · not mailed"}</Text>
      : review.reward_note ? <Text size="xsmall" className="text-ui-fg-muted">No code: {review.reward_note}</Text> : null}
    <Textarea aria-label={`Reply to ${review.author}`} placeholder="Reply publicly as Florayn (optional)" maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} disabled={busy} />
    <div className="flex flex-wrap gap-2">
      <Button size="small" disabled={busy} onClick={() => save("approved")}>{review.status === "approved" ? "Save reply" : "Publish"}</Button>
      {review.status !== "rejected" ? <Button size="small" variant="secondary" disabled={busy} onClick={() => save("rejected")}>Hide review</Button> : null}
      {review.status !== "approved" && reply !== review.reply ? <Button size="small" variant="secondary" disabled={busy} onClick={() => save(review.status)}>Save reply only</Button> : null}
    </div>
  </article>
}

/**
 * Review moderation. Publishing a review is what creates and mails the
 * customer's discount code (when rewards are on); hiding it keeps it for later.
 */
export default function ReviewsEditor({ productId }: { productId?: string }) {
  const [status, setStatus] = useState("pending")
  const [offset, setOffset] = useState(0)
  const [reviews, setReviews] = useState<Review[]>([])
  const [count, setCount] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { const result = await api(`/admin/content/product-reviews?offset=${offset}&status=${status}${productId ? "&product_id=" + encodeURIComponent(productId) : ""}`); setReviews(result.reviews); setCount(result.count) }
    catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [offset, status, productId])
  useEffect(() => { void load() }, [load])
  return <Container className="grid gap-4">
    <div><Heading level="h2">Product reviews</Heading><Text size="small" className="text-ui-fg-subtle">Publishing a review is what creates and mails the customer's discount code. Hide spam, or add a public reply. Customer ratings and words are preserved.</Text></div>
    <div className="flex items-center gap-3"><ManagerSelect aria-label="Review status" value={status} onValueChange={(v) => { setStatus(v); setOffset(0) }}><option value="pending">Pending approval</option><option value="approved">Published</option><option value="rejected">Hidden</option><option value="">All reviews</option></ManagerSelect><Button variant="secondary" disabled={loading} onClick={load}>Refresh</Button></div>
    {error && <Text role="alert" className="text-ui-fg-error">{error}</Text>}
    {loading ? <Text>Loading reviews…</Text> : reviews.length ? reviews.map((r) => <ReviewRow key={r.id + r.reply + r.status + (r.coupon_code ?? "")} review={r} onSaved={load} />) : <Text size="small">No reviews in this view.</Text>}
    {count > 20 && <div className="flex gap-3"><Button variant="secondary" disabled={!offset || loading} onClick={() => setOffset((v) => Math.max(0, v - 20))}>Previous</Button><Text>{offset / 20 + 1} / {Math.ceil(count / 20)}</Text><Button variant="secondary" disabled={offset + 20 >= count || loading} onClick={() => setOffset((v) => v + 20)}>Next</Button></div>}
  </Container>
}
