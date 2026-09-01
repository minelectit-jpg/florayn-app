import Skeleton from "@/components/skeleton"

export default function LoadingCheckout() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-10 w-48" />
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
      <p className="sr-only" role="status">
        Loading checkout
      </p>
    </div>
  )
}
