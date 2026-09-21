import Skeleton from "@/components/skeleton"
import "./order.css"

export default function LoadingOrder() {
  return (
    <div data-order-confirmation className="order-page space-y-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-40 w-full" />
      <p className="sr-only" role="status">
        Loading your order
      </p>
    </div>
  )
}
