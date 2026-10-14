"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Zap, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton, ErrorState, EmptyState } from "@/components/ui/states";

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  importanceLevel: "IMPORTANT" | "CRITICAL";
  symbol: string;
  stockName: string;
}

interface NewsData {
  important: NewsArticle[];
  critical: NewsArticle[];
  fetchedAt: string;
}

interface NewsTickerColumnsProps {
  initialData: NewsData;
}

export function NewsTickerColumns({ initialData }: NewsTickerColumnsProps) {
  const [data, setData] = useState<NewsData>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const importantTrackRef = useRef<HTMLDivElement>(null);
  const criticalTrackRef = useRef<HTMLDivElement>(null);
  const isHoveringImportant = useRef(false);
  const isHoveringCritical = useRef(false);

  // Veri çekme fonksiyonu
  const fetchNews = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/news/important?limit=20", { cache: "no-store" });
      if (!res.ok) throw new Error("Haberler yüklenemedi.");
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  // Otomatik yenileme: 30-60 saniye arası rastgele
  useEffect(() => {
    const scheduleNext = () => {
      const delay = Math.floor(Math.random() * 30000) + 30000; // 30-60 sn
      intervalRef.current = setTimeout(() => {
        fetchNews();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, []);

  // Kaydırma animasyonunu duraklat/devam ettir (hover ile)
  const pauseAnimation = (trackRef: React.RefObject<HTMLDivElement | null>, isHovering: React.MutableRefObject<boolean>) => {
    if (trackRef.current) {
      trackRef.current.style.animationPlayState = isHovering.current ? "paused" : "running";
    }
  };

  useEffect(() => {
    pauseAnimation(importantTrackRef, isHoveringImportant);
    pauseAnimation(criticalTrackRef, isHoveringCritical);
  }, [data.important.length, data.critical.length]);

  // Tarih formatla
  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Haber kartı render
  const renderArticle = (article: NewsArticle, index: number) => (
    <article
      key={article.id}
      className={cn(
        "flex-shrink-0 w-full px-4 py-3 rounded-lg border transition-all duration-200",
        article.importanceLevel === "CRITICAL"
          ? "border-red-600/50 bg-red-950/30 hover:bg-red-950/50"
          : "border-yellow-600/50 bg-yellow-950/30 hover:bg-yellow-950/50"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
            article.importanceLevel === "CRITICAL" ? "bg-red-600 text-white" : "bg-yellow-500 text-gray-900"
          )}
        >
          {article.importanceLevel === "CRITICAL" ? <Zap className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <span className="font-mono">{article.symbol}</span>
            <span className="hidden sm:inline">{article.stockName}</span>
            <span>·</span>
            <time>{formatDate(article.publishedAt)}</time>
            <span>·</span>
            <span>{article.source}</span>
          </div>
          <h3 className="font-semibold text-white truncate">{article.title}</h3>
          <p className="mt-1 text-sm text-gray-300 line-clamp-2">{article.summary}</p>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Detay <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </article>
  );

  // Sütun render
  const renderColumn = (
    title: string,
    icon: React.ReactNode,
    articles: NewsArticle[],
    trackRef: React.RefObject<HTMLDivElement | null>,
    isHoveringRef: React.MutableRefObject<boolean>,
    colorClass: string
  ) => (
    <div className="space-y-3 p-4 rounded-xl border border-gray-800 bg-gray-900/50">
      <header className="flex items-center justify-between mb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</h2>
        <span className="text-xs text-gray-500">{articles.length} haber</span>
      </header>
      <div
        ref={trackRef}
        className="animate-scroll-vertical"
        onMouseEnter={() => { isHoveringRef.current = true; }}
        onMouseLeave={() => { isHoveringRef.current = false; }}
      >
        {articles.length === 0 ? (
          <EmptyState
            title={title === "ÖNEMLİ" ? "Önemli haber yok" : "Kritik haber yok"}
            message={title === "ÖNEMLİ" ? "Önemli seviyede haber bulunamadı." : "Kritik seviyede haber bulunamadı."}
          />
        ) : (
          articles.map((article, index) => renderArticle(article, index))
        )}
      </div>
    </div>
  );

  // Loading skeleton
  if (loading && data.important.length === 0 && data.critical.length === 0) {
    return (
      <section className="space-y-4" aria-live="polite" aria-label="Haber akışı">
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
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-live="polite" aria-label="Haber akışı">
      {/* Son güncelleme bilgisi */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Son güncelleme: {formatDate(data.fetchedAt)}</span>
        <button
          onClick={fetchNews}
          disabled={loading}
          className="flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
        >
          {loading ? "Yenileniyor..." : "Şimdi Yenile"}
        </button>
      </div>

      {/* Hata durumu */}
      {error && (
        <ErrorState
          title="Haberler yüklenemedi"
          message={error}
          action={<button onClick={fetchNews} className="text-sm text-blue-400 underline">Tekrar Dene</button>}
        />
      )}

      {/* Yan yana sütunlar - Mobilde stack, masaüstünde grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderColumn(
          "ÖNEMLİ",
          <AlertTriangle className="h-4 w-4 text-yellow-400" />,
          data.important,
          importantTrackRef,
          isHoveringImportant,
          "border-yellow-600"
        )}
        {renderColumn(
          "KRİTİK",
          <Zap className="h-4 w-4 text-red-400" />,
          data.critical,
          criticalTrackRef,
          isHoveringCritical,
          "border-red-600"
        )}
      </div>
    </section>
  );
}