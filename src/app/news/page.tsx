import { Suspense } from "react";
import { NewsTickerColumns } from "@/components/news/NewsTickerColumns";

/**
 * /news sayfası — Yan yana 2 kayan pencere (IMPORTANT / CRITICAL).
 *
 * Server Component: İlk veriyi sunucuda çeker (SEO + hızlı FCP).
 * Client Component: useEffect + setInterval ile 30-60 sn aralıklarla yeniler.
 * CSS @keyframes ile dikey kaydırma animasyonu.
 * Mobilde tek sütun (stack), masaüstünde yan yana (grid).
 */
export default async function NewsPage() {
  // Sunucuda ilk veriyi çek (SEO + hızlı ilk boyama)
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/news/important?limit=20`, {
    cache: "no-store",
  });
  const initialData = res.ok ? await res.json() : { important: [], critical: [], fetchedAt: new Date().toISOString() };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Haber Akışı</h1>
        <p className="text-gray-400">
          Önem derecesi <span className="text-yellow-400">IMPORTANT</span> ve{" "}
          <span className="text-red-400">CRITICAL</span> olan haberler — otomatik yenilenir (30-60 sn).
        </p>
      </header>

      <Suspense fallback={<NewsTickerColumnsSkeleton />}>
        <NewsTickerColumns initialData={initialData} />
      </Suspense>
    </div>
  );
}

function NewsTickerColumnsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-3 p-4 rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="h-6 w-24 bg-gray-800 rounded animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 w-full bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
      <div className="space-y-3 p-4 rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="h-6 w-24 bg-gray-800 rounded animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 w-full bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}