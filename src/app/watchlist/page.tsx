import { Eye } from "lucide-react";
import { WatchlistClient } from "@/components/watchlist/WatchlistClient";
import { listWatchlist } from "@/server/services/watchlist-service";
import { resolvePriceSourceKind } from "@/server/services/price-source";
import { getBist100SyncStatus } from "@/server/services/bist100-service";
import type { Bist100SyncStatus, PriceSourceStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "İzleme Listesi",
};

/**
 * /watchlist — İzleme listesi sayfası (server component).
 *
 * İlk render verisini servisten alır; canlı fiyat akışı, otomatik
 * yenileme ve ekle/çıkar etkileşimi WatchlistClient'a aittir.
 */
export default async function WatchlistPage() {
  const [initialPrices, selectedSource, bist100Status] = await Promise.all([
    listWatchlist(),
    resolvePriceSourceKind(),
    getBist100SyncStatus(),
  ]);
  const initialSource: PriceSourceStatus = {
    selected: selectedSource,
    effective: selectedSource,
    fallbackUsed: false,
    fallbackReason: null,
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">İzleme Listesi</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-800 bg-blue-950 px-2.5 py-0.5 text-xs font-medium text-blue-300">
            <Eye className="h-3 w-3" aria-hidden />
            Canlı Takip
          </span>
        </div>
        <p className="max-w-2xl text-sm text-gray-400">
          İzlediğiniz BIST hisselerinin son fiyatları, günlük değişimleri ve
          fiyat eğilimleri. Fiyatlar 10 saniyede bir otomatik yenilenir;
          "Şimdi Yenile" ile anlık tick tetikleyebilirsiniz.
        </p>
      </section>

      <WatchlistClient
        initialPrices={initialPrices}
        initialSource={initialSource}
        initialBist100Status={bist100Status}
      />
    </div>
  );
}
