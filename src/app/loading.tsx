import { SkeletonGrid } from "@/components/ui/states";

/**
 * Kök route segment yükleme durumu (iyileştirme 8.4) — Next.js App Router
 * otomatik Suspense sarması: sayfa sunucu verisi çekilirken bu iskelet
 * gösterilir. Alt segmentlerin kendi loading.tsx'i yoksa buraya düşer.
 */
export default function RootLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Sayfa yükleniyor">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-900/70" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-900/50" />
      </div>
      <SkeletonGrid count={4} />
      <div className="h-64 animate-pulse rounded-xl border border-gray-800 bg-gray-900/60" />
    </div>
  );
}
