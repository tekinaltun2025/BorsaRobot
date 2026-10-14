"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  HistogramSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Skeleton, SkeletonGrid, ErrorState, EmptyState } from "@/components/ui/states";

/**
 * K/Z (kâr/zarar) analitiği bölümü — trading ekranı.
 *
 * İçerik:
 *  - Özet kartları: toplam net K/Z, toplam kâr, toplam zarar, işlem sayısı.
 *  - Toplam K/Z grafiği: günlük histogram (kâr yeşil / zarar kırmızı barlar)
 *    + kümülatif K/Z çizgisi (Lightweight Charts v5 HistogramSeries+LineSeries).
 *  - Hisse başına K/Z: yatay bar listesi (yeşil/kırmızı).
 *  - Sıfırlama: onay diyaloğu ile K/Z damgası ilerletilir; emir geçmişi
 *    asla silinmez.
 *
 * Veri: GET /api/trading/pnl — refreshKey artışıyla yeniden çekilir.
 */

/** GET /api/trading/pnl yanıt tipleri (pnl-service ile birebir). */
interface PnlDailyPoint {
  time: number;
  date: string;
  pnl: number;
  cumulative: number;
  count: number;
}

interface PnlBySymbol {
  symbol: string;
  realizedPnl: string;
  tradeCount: number;
  lastTradeAt: string;
}

interface PnlOverview {
  resetAt: string | null;
  totalRealizedPnl: string;
  totalProfit: string;
  totalLoss: string;
  tradeCount: number;
  daily: PnlDailyPoint[];
  bySymbol: PnlBySymbol[];
}

/** TL para biçimlendirici — tr-TR yereli. */
function formatTry(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value);
}

/** K/Z rengi: ≥0 yeşil, <0 kırmızı. */
function pnlColor(value: number): string {
  return value >= 0 ? "#22c55e" : "#ef4444";
}

/** Grafik konteyneri — histogram + kümülatif çizgi (tek chart instance). */
function PnlChart({ daily }: { daily: PnlDailyPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const histogramRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Chart instance'ı bir kez oluşturulur; resize observer bağlanır.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(75, 85, 99, 0.15)" },
        horzLines: { color: "rgba(75, 85, 99, 0.15)" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: {
        borderColor: "#374151",
        timeVisible: false,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;

    histogramRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      priceScaleId: "pnl",
    });
    // Histogram sağ ölçekte; kümülatif çizgi ayrı ölçekte (farklı büyüklük).
    chart.priceScale("pnl").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    lineRef.current = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      priceScaleId: "cumulative",
      lastValueVisible: true,
      priceLineVisible: false,
    });
    chart.priceScale("cumulative").applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      histogramRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Veri değişince seriler güncellenir (chart instance korunur).
  useEffect(() => {
    const histogram = histogramRef.current;
    const line = lineRef.current;
    if (!histogram || !line) return;

    histogram.setData(
      daily.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.pnl,
        color: pnlColor(point.pnl),
      })),
    );
    line.setData(
      daily.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.cumulative,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [daily]);

  return <div ref={containerRef} className="h-64 w-full" />;
}

/** Hisse başına K/Z yatay bar listesi. */
function PnlBySymbolList({ bySymbol }: { bySymbol: PnlBySymbol[] }) {
  if (bySymbol.length === 0) {
    return (
      <EmptyState
        title="Hisse başına K/Z verisi yok"
        message="Henüz gerçekleşmiş satım işlemi bulunamadı."
      />
    );
  }

  // Bar genişliği: en büyük mutlak K/Z'ye göre oranlama.
  const maxAbs = Math.max(
    ...bySymbol.map((s) => Math.abs(Number(s.realizedPnl))),
    1,
  );

  return (
    <ul className="space-y-2">
      {bySymbol.map((item) => {
        const pnl = Number(item.realizedPnl);
        const widthPercent = Math.max((Math.abs(pnl) / maxAbs) * 100, 2);
        return (
          <li key={item.symbol} className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{item.symbol}</span>
              <span
                className="font-mono font-semibold"
                style={{ color: pnlColor(pnl) }}
              >
                {pnl >= 0 ? "+" : ""}
                {formatTry(pnl)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-gray-800">
              <div
                className="h-full rounded"
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: pnlColor(pnl),
                }}
              />
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {item.tradeCount} işlem
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** K/Z analitiği bölümü — trading dashboard'a gömülür. */
export function PnlSection({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<PnlOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/trading/pnl", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `K/Z verileri alınamadı (${res.status})`);
      }
      setData((await res.json()) as PnlOverview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshKey + sıfırlama sonrası yeniden çekim.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** Sıfırlama: onay diyaloğu kapatılır, damga ilerletilir, veri tazelenir. */
  async function handleReset(): Promise<void> {
    setResetting(true);
    try {
      const res = await fetch("/api/trading/pnl/reset", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Sıfırlama başarısız (${res.status})`);
      }
      setConfirmOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  const totalPnl = useMemo(
    () => (data ? Number(data.totalRealizedPnl) : 0),
    [data],
  );

  return (
    <section className="space-y-4 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Kâr/Zarar Analitiği</h2>
        <div className="flex items-center gap-3">
          {data?.resetAt && (
            <span className="text-xs text-gray-500">
              Son sıfırlama:{" "}
              {new Date(data.resetAt).toLocaleString("tr-TR")}
            </span>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={resetting}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white disabled:opacity-50"
          >
            K/Z Sıfırla
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-4 animate-pulse">
          <Skeleton className="h-6 w-32" />
          <SkeletonGrid count={4} />
        </div>
      )}

      {!loading && error && (
        <ErrorState
          title="K/Z verileri yüklenemedi"
          message={error}
          action={<button onClick={load} className="text-sm text-blue-400 underline">Tekrar Dene</button>}
        />
      )}

      {!loading && !error && data && (
        <>
          {/* Özet kartları */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500">Toplam Net K/Z</div>
              <div
                className="mt-1 font-mono text-lg font-bold"
                style={{ color: pnlColor(totalPnl) }}
              >
                {totalPnl >= 0 ? "+" : ""}
                {formatTry(totalPnl)}
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500">Toplam Kâr</div>
              <div className="mt-1 font-mono text-lg font-bold text-green-500">
                {formatTry(Number(data.totalProfit))}
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500">Toplam Zarar</div>
              <div className="mt-1 font-mono text-lg font-bold text-red-500">
                {formatTry(Number(data.totalLoss))}
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500">İşlem Sayısı</div>
              <div className="mt-1 font-mono text-lg font-bold">
                {data.tradeCount}
              </div>
            </div>
          </div>

          {/* Toplam K/Z grafiği */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-400">
              Günlük K/Z (barlar) ve Kümülatif K/Z (çizgi)
            </h3>
            {data.daily.length === 0 ? (
              <EmptyState
                title="Henüz K/Z verisi yok"
                message="Satım işlemi yaptığınızda grafik burada oluşur."
              />
            ) : (
              <PnlChart daily={data.daily} />
            )}
          </div>

          {/* Hisse başına kırılım */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-400">
              Hisse Başına Gerçekleşmiş K/Z
            </h3>
            <PnlBySymbolList bySymbol={data.bySymbol} />
          </div>
        </>
      )}

      {/* Sıfırlama onay diyaloğu */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="K/Z sıfırlama onayı"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl">
            <h3 className="text-base font-semibold">K/Z Sıfırlama Onayı</h3>
            <p className="mt-2 text-sm text-gray-400">
              Gerçekleşmiş kâr/zarar sayaçları sıfırlanacak. Emir geçmişiniz
              <strong className="text-gray-200"> silinmez</strong>; yalnızca bu
              andan sonraki işlemler K/Z hesaplarına katılır. Bu işlem geri
              alınamaz.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={resetting}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:border-gray-500 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={resetting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {resetting ? "Sıfırlanıyor…" : "Sıfırla"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
