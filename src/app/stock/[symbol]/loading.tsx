import { Skeleton } from "@/components/ui/states";

/** Hisse detay segment yükleme iskeleti (iyileştirme 8.4). */
export default function StockDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <Skeleton className="h-80" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
