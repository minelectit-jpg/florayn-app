import Skeleton from "@/components/skeleton"

export default function LoadingCart() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-10 w-40" />
      <div className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            <Skeleton className="h-16 w-16" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <p className="sr-only" role="status">
        Loading cart
      </p>
    </div>
  )
}
