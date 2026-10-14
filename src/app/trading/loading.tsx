import { Skeleton, SkeletonGrid } from "@/components/ui/states";

/** Trading segment yükleme iskeleti (iyileştirme 8.4). */
export default function TradingLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <SkeletonGrid count={4} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
