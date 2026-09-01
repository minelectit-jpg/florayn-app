import Skeleton from "@/components/skeleton"

export default function LoadingProduct() {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="space-y-3">
        <Skeleton className="aspect-square w-full border border-[var(--color-line)]" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-72 w-full" />
        <div className="flex items-center gap-4 border-t border-[var(--color-line)] pt-5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ml-auto h-11 w-32" />
        </div>
      </div>

      <p className="sr-only" role="status">
        Loading product
      </p>
    </div>
  )
}
