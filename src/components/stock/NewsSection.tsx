"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  ExternalLink,
  Loader2,
  Newspaper,
  Radar,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

/**
 * Haberler bölümü — /stock/[symbol] detay sayfası.
 *
 * Davranış sözleşmesi:
 *  - "Haber Tara" → POST /api/news/scan?symbol=XXX (Google News RSS, key'siz).
 *    Sonuç özeti gösterilir (yeni / tekrar eden makale sayıları) ve liste
 *    baştan yüklenir.
 *  - Makale listesi: GET /api/news?symbol=XXX (tarih sıralı, sayfalı).
 *  - "Daha Fazla" → sonraki sayfa mevcut listenin sonuna eklenir.
 *  - Dış linkler target=_blank + rel="noopener noreferrer" ile açılır.
 *  - Tarama hatası asla sayfayı düşürmez — yönlendirici mesaj gösterilir.
 */

/** Makale görünümü — GET /api/news öğesi. */
interface NewsArticleItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
}

/** GET /api/news yanıt zarfı. */
interface NewsListResponse {
  articles: NewsArticleItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /api/news/scan yanıt gövdesi. */
interface NewsScanResponse {
  symbol: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  scannedAt: string;
}

/** Sayfa boyutu — API tarafı da 10'da clamp'ler. */
const PAGE_SIZE = 10;

/** Hata zarfından güvenli mesaj çıkarır. */
function extractErrorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export function NewsSection({ symbol }: { symbol: string }) {
  const [articles, setArticles] = useState<NewsArticleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<string | null>(null);

  /** Makale listesini çeker — append=true ise mevcut listeye ekler. */
  const fetchNews = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const response = await fetch(
          `/api/news?symbol=${symbol}&page=${targetPage}&pageSize=${PAGE_SIZE}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as NewsListResponse;
        setArticles((prev) =>
          append ? [...prev, ...data.articles] : data.articles,
        );
        setTotal(data.total);
      } catch {
        // Liste yükleme hatası sessizce yutulur — eski liste kalır.
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [symbol],
  );

  // İlk yükleme.
  useEffect(() => {
    void fetchNews(1, false);
  }, [fetchNews]);

  /** Haber taraması tetikler ve listeyi yeniler. */
  async function handleScan() {
    setScanning(true);
    setError(null);
    setScanInfo(null);
    try {
      const response = await fetch(`/api/news/scan?symbol=${symbol}`, {
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(
          extractErrorMessage(payload, "Haber taraması başarısız oldu."),
        );
        return;
      }
      if (typeof payload === "object" && payload !== null && "inserted" in payload) {
        const result = payload as NewsScanResponse;
        setScanInfo(
          `Tarama tamamlandı: ${result.fetched} makale bulundu — ${result.inserted} yeni, ${result.duplicates} zaten kayıtlı.`,
        );
        setPage(1);
        await fetchNews(1, false);
      }
    } catch {
      setError("Haber taramasına ulaşılamadı. Ağ bağlantınızı kontrol edin.");
    } finally {
      setScanning(false);
    }
  }

  /** Sonraki sayfayı listeye ekler. */
  function handleLoadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchNews(nextPage, true);
  }

  const hasMore = articles.length < total;

  return (
    <section
      className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
      aria-label="Haberler"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          <Newspaper className="h-4 w-4 text-amber-400" aria-hidden />
          Haberler
          {total > 0 && (
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium normal-case text-gray-400">
              {total} makale
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void handleScan()}
          disabled={scanning}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Radar className="h-3.5 w-3.5" aria-hidden />
          )}
          {scanning ? "Taranıyor…" : "Haber Tara"}
        </button>
      </div>

      {error && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300"
          role="alert"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {scanInfo && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300"
          role="status"
        >
          <Radar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{scanInfo}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          Haberler yükleniyor…
        </div>
      ) : articles.length === 0 ? (
        <div className="mt-4 flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 text-center text-sm text-gray-500">
          <p>Henüz kayıtlı haber yok.</p>
          <p className="text-xs text-gray-600">
            "Haber Tara" ile Google News'ten bu hisse için makale çekin.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {articles.map((article) => (
            <li
              key={article.id}
              className="rounded-lg border border-gray-800 bg-gray-950/50 p-3.5 transition-colors hover:border-gray-700"
            >
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-snug text-gray-200 group-hover:text-white">
                    {article.title}
                  </p>
                  <ExternalLink
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-600 transition-colors group-hover:text-blue-400"
                    aria-hidden
                  />
                </div>
                {article.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                    {article.summary}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 font-medium text-gray-400">
                    {article.source}
                  </span>
                  <span>{formatDate(article.publishedAt)}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-700 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {loadingMore ? "Yükleniyor…" : `Daha Fazla (${articles.length}/${total})`}
        </button>
      )}
    </section>
  );
}
