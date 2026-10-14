import { Skeleton } from "@/components/ui/states";

/** AI kararları segment yükleme iskeleti (iyileştirme 8.4). */
export default function AiDecisionsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
    </div>
  );
}
