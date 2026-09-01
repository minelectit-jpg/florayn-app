import Skeleton, { SkeletonGrid } from "@/components/skeleton"

export default function LoadingCollection() {
  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b border-[var(--color-line)] pb-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-3 w-24" />
      </header>
      <SkeletonGrid count={8} />
      <p className="sr-only" role="status">
        Loading collection
      </p>
    </div>
  )
}
