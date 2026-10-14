import { Skeleton, SkeletonGrid } from "@/components/ui/states";

/** İzleme listesi segment yükleme iskeleti (iyileştirme 8.4). */
export default function WatchlistLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <SkeletonGrid count={4} />
      <Skeleton className="h-96" />
    </div>
  );
}
