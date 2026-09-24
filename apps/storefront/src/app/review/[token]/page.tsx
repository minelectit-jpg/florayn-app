import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { getReviewProgram } from "@/lib/review-actions"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Write a review", robots: { index: false, follow: false } }

type Params = { params: Promise<{ token: string }> }

const reviewHref = (handle: string, token: string) =>
  `/product/${encodeURIComponent(handle)}/?review=${encodeURIComponent(token)}#customer-reviews`

/**
 * Where a WhatsApp review request's "Write a review" button lands. The link
 * is signed for one order: with one product it goes straight to that
 * product's review form (name filled in, no sign-in); with several it lists
 * them to choose from.
 */
export default async function ReviewLinkPage({ params }: Params) {
  const token = decodeURIComponent((await params).token)
  const info = await getReviewProgram(token)
  const products = info?.invite?.products ?? []
  if (products.length === 1) redirect(reviewHref(products[0].handle, token))

  if (!info?.invite || !products.length) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <h1 className="display text-[2rem] leading-tight">Write a review</h1>
        <p className="text-ink-muted">
          {info ? "This review link is not valid any more." : "We could not open your review link just now. Please try again in a moment."}
        </p>
        <p className="text-sm text-ink-muted">
          <Link href="/contact/" className="underline underline-offset-4 transition-colors hover:text-purple">Contact us</Link>
          {" "}and we will send you a new one.
        </p>
      </div>
    )
  }

  const name = info.invite.name?.split(" ")[0]
  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <div className="space-y-2 text-center">
        <h1 className="display text-[2rem] leading-tight">{name ? `Thank you, ${name}!` : "Thank you for your order!"}</h1>
        <p className="text-ink-muted">Which one would you like to review?</p>
        {info.rewards ? (
          <p className="text-sm text-ink-muted">
            Add a photo with your review and get {info.rewards.photo_pct}% off your next order ({info.rewards.text_pct}% for a few words).
          </p>
        ) : null}
      </div>
      <ul className="grid gap-3">
        {products.map((p) => (
          <li key={p.id}>
            <Link
              href={reviewHref(p.handle, token)}
              className="flex items-center gap-4 rounded-xl border border-line bg-paper p-3 transition-colors hover:border-purple"
            >
              {p.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail} alt="" width={64} height={64} className="size-16 shrink-0 rounded-lg object-cover" />
              ) : null}
              <span className="flex-1 font-medium">{p.title}</span>
              <span className="text-sm font-medium text-purple">Write a review</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
