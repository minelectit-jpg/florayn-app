import Skeleton from "@/components/skeleton"

export default function LoadingProduct() {
  return (
    <div className="fl-pdp mx-auto w-full max-w-[1360px] px-0 md:px-[30px]">
      <div className="grid grid-cols-1 gap-3.5 md:gap-[30px] lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-x-[56px]">
        <Skeleton className="aspect-square w-full rounded-[10px]" />
        <div className="space-y-4 md:space-y-6">
          <Skeleton className="h-8 w-4/5 rounded" />
          <Skeleton className="h-7 w-28 rounded" />
          <Skeleton className="h-[52px] w-full rounded-[12px]" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-[10px]" />)}
          </div>
          <Skeleton className="h-[52px] w-full rounded-[10px]" />
        </div>
      </div>
      <p className="sr-only" role="status">Loading product</p>
    </div>
  )
}
