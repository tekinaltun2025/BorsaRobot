"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import type {
  ChartCandle,
  HistoryRange,
  PriceSourceStatus,
  StockDetailView,
  StockStats,
} from "@/lib/types";
import { PriceChart, type HoveredCandle } from "@/components/stock/PriceChart";
import { AiAnalysisSection } from "@/components/stock/AiAnalysisSection";
import { NewsSection } from "@/components/stock/NewsSection";

/**
 * Hisse detay istemcisi — canlı grafik + istatistikler + hızlı emir.
 *
 * Davranış sözleşmesi:
 *  - Dönem seçici: 1G, 1H, 1A, 3A, 1Y → /api/market/history yeniden çekilir.
 *  - Polling: 10 sn'de bir son mum güncellenir (history yeniden fetch).
 *  - Crosshair tooltip: PriceChart onHover ile mum O/H/L/C gösterilir.
 *  - Hızlı Al/Sat: /trading?symbol=XXX — OrderForm sembol parametresiyle
 *    açılır.
 *  - useEffect cleanup: interval temizlenir; chart unmount'ta kendi
 *    cleanup'unu yapar (PriceChart).
 */

/** Otomatik yenileme aralığı (ms). */
const POLL_MS = 10_000;

/** Dönem seçenekleri — UI etiketleri. */
const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "1D", label: "1G" },
  { value: "1W", label: "1H" },
  { value: "1M", label: "1A" },
  { value: "3M", label: "3A" },
  { value: "1Y", label: "1Y" },
];

/** History API yanıt gövdesi. */
interface HistoryPayload {
  symbol: string;
  range: HistoryRange;
  candles: ChartCandle[];
  stats: StockStats;
  source?: PriceSourceStatus;
}

export function StockDetailClient({
  stock,
  initialCandles,
  initialStats,
  initialSource,
}: {
  stock: StockDetailView;
  initialCandles: ChartCandle[];
  initialStats: StockStats;
  initialSource: PriceSourceStatus;
}) {
  const [range, setRange] = useState<HistoryRange>("1D");
  const [candles, setCandles] = useState<ChartCandle[]>(initialCandles);
  const [stats, setStats] = useState<StockStats>(initialStats);
  const [source, setSource] = useState<PriceSourceStatus>(initialSource);
  const [hovered, setHovered] = useState<HoveredCandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>(
    new Date().toLocaleTimeString("tr-TR"),
  );

  /** Dönem + sembol için history verisini çeker. */
  const fetchHistory = useCallback(
    async (targetRange: HistoryRange) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/market/history?symbol=${stock.symbol}&range=${targetRange}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as HistoryPayload;
        setCandles(data.candles);
        setStats(data.stats);
        if (data.source) setSource(data.source);
        setLastRefreshed(new Date().toLocaleTimeString("tr-TR"));
      } catch {
        // Polling hataları sessizce yutulur — son başarılı veri kalır.
      } finally {
        setLoading(false);
      }
    },
    [stock.symbol],
  );

  // Dönem değişince veriyi çek.
  useEffect(() => {
    if (range === "1D" && candles === initialCandles) return;
    void fetchHistory(range);
    // range değişiminde tetiklenir; initialCandles yalnızca ilk mount referansıdır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Polling: son mumu güncelle (interval cleanup'lı). fetchHistory useCallback
  // ile stabil olduğundan interval yalnızca range değişince yeniden kurulur.
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchHistory(range);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [range, fetchHistory]);

  // Tek nokta/düz seri kontrolü: candlestick yalnızca OHLC farkı varsa
  // anlamlıdır; değilse area chart kullanılır.
  const hasOhlcSpread =
    candles.length >= 2 &&
    candles.some((c) => c.high !== c.low || c.open !== c.close);
  const chartType = hasOhlcSpread ? "candlestick" : "area";

  // Başlık fiyatı: crosshair aktifse hover'daki mum, değilse son mum/lastPrice.
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const displayPrice = hovered
    ? hovered.close
    : lastCandle
      ? lastCandle.close
      : stock.lastPrice
        ? Number(stock.lastPrice)
        : null;

  const changePercent = stock.changePercent ? Number(stock.changePercent) : null;
  const change = stock.change ? Number(stock.change) : null;
  const positive = changePercent !== null && changePercent > 0;
  const negative = changePercent !== null && changePercent < 0;

  return (
    <div className="space-y-6">
      {/* Geri dönüş + sembol başlığı */}
      <div className="flex items-center gap-3">
        <Link
          href="/watchlist"
          className="flex items-center gap-1 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label="İzleme listesine dön"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {stock.symbol}
            </h1>
            <span className="text-sm text-gray-400">{stock.name}</span>
            {stock.sector && (
              <span className="rounded-full border border-gray-700 px-2 py-0.5 text-xs text-gray-400">
                {stock.sector}
              </span>
            )}
            <PriceSourceBadge source={source} />
          </div>
        </div>
      </div>

      {/* Fiyat başlığı: son fiyat + değişim + günlük aralık */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-end gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {hovered ? "Seçili Mum" : "Son Fiyat"}
            </p>
            <p
              className={cn(
                "text-4xl font-bold tabular-nums",
                positive && "text-emerald-400",
                negative && "text-rose-400",
              )}
            >
              {displayPrice !== null ? formatCurrency(displayPrice) : "—"}
            </p>
          </div>
          {changePercent !== null && change !== null && (
            <div
              className={cn(
                "flex items-center gap-1 pb-1 text-sm font-medium tabular-nums",
                positive && "text-emerald-400",
                negative && "text-rose-400",
                !positive && !negative && "text-gray-400",
              )}
            >
              {positive ? (
                <TrendingUp className="h-4 w-4" aria-hidden />
              ) : (
                <TrendingDown className="h-4 w-4" aria-hidden />
              )}
              {positive ? "+" : ""}
              {change.toFixed(2)} TL ({positive ? "+" : ""}
              {changePercent.toFixed(2)}%)
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-500">Günlük Aralık</p>
            <p className="tabular-nums text-gray-300">
              {stock.dayLow ? Number(stock.dayLow).toFixed(2) : "—"} —{" "}
              {stock.dayHigh ? Number(stock.dayHigh).toFixed(2) : "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Son Güncelleme</p>
            <p className="tabular-nums text-gray-400">{lastRefreshed}</p>
          </div>
        </div>
      </div>

      {/* Grafik + dönem seçici */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex items-center gap-1 rounded-lg border border-gray-700 p-1"
            role="tablist"
            aria-label="Grafik dönemi"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={range === option.value}
                onClick={() => setRange(option.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  range === option.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => void fetchHistory(range)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Yenile
            </button>
          </div>
        </div>

        {/* Crosshair tooltip satırı */}
        {hovered && (
          <div className="mb-2 flex flex-wrap items-center gap-4 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs tabular-nums text-gray-300">
            <span className="text-gray-500">
              {new Date(hovered.time * 1000).toLocaleString("tr-TR")}
            </span>
            <span>
              A: <span className="text-gray-100">{hovered.open.toFixed(2)}</span>
            </span>
            <span>
              Y: <span className="text-emerald-400">{hovered.high.toFixed(2)}</span>
            </span>
            <span>
              D: <span className="text-rose-400">{hovered.low.toFixed(2)}</span>
            </span>
            <span>
              K:{" "}
              <span
                className={cn(
                  hovered.close >= hovered.open
                    ? "text-emerald-400"
                    : "text-rose-400",
                )}
              >
                {hovered.close.toFixed(2)}
              </span>
            </span>
          </div>
        )}

        {candles.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center text-sm text-gray-500">
            Bu dönem için fiyat verisi yok. "Yenile" ile tick tetikleyin.
          </div>
        ) : (
          <PriceChart
            candles={candles}
            chartType={chartType}
            onHover={setHovered}
          />
        )}
      </div>

      {/* İstatistik kartları + hızlı emir */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Dönem İstatistikleri ({RANGE_OPTIONS.find((r) => r.value === range)?.label})
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">En Yüksek</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-400">
                {stats.high ? Number(stats.high).toFixed(2) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">En Düşük</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-rose-400">
                {stats.low ? Number(stats.low).toFixed(2) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ortalama</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-gray-200">
                {stats.average ? Number(stats.average).toFixed(2) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Örneklem</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-gray-200">
                {stats.sampleCount}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Hızlı İşlem
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {stock.symbol} için emir formuna sembol seçili gider.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href={`/trading?symbol=${stock.symbol}`}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <TrendingUp className="h-4 w-4" aria-hidden />
              AL
            </Link>
            <Link
              href={`/trading?symbol=${stock.symbol}&side=SELL`}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
            >
              <TrendingDown className="h-4 w-4" aria-hidden />
              SAT
            </Link>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            {stock.inWatchlist
              ? "Bu hisse izleme listesinde — fiyat akışı aktif."
              : "Bu hisse izleme listesinde değil — fiyat akışı için ekleyin."}
          </p>
        </div>
      </div>

      {/* AI Analizi + Haberler — Faz 4 bölümleri */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AiAnalysisSection symbol={stock.symbol} />
        <NewsSection symbol={stock.symbol} />
      </div>
    </div>
  );
}
