import { Star } from "lucide-react"

/**
 * Five stars for a real average rating. With no rating (no reviews yet) all
 * five are hollow and muted - never filled - so nothing reads as a score the
 * product does not have. Server-safe: no state, no client code.
 */
export default function RatingStars({ rating, size = 13 }: { rating: number | null; size?: number }) {
  const filled = rating ? Math.round(rating) : 0
  return (
    <span className={`fl-rating-stars${rating ? "" : " is-empty"}`} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} strokeWidth={1.8} fill={n <= filled ? "currentColor" : "none"} />
      ))}
    </span>
  )
}
