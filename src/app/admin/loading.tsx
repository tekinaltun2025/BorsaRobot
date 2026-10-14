import { Skeleton } from "@/components/ui/states";

/** Yönetim paneli segment yükleme iskeleti (iyileştirme 8.4). */
export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-48" />
        ))}
      </div>
    </div>
  );
}
