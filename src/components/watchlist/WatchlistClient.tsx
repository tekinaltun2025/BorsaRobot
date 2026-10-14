"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ListRestart,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import type {
  Bist100SyncStatus,
  PriceSourceStatus,
  WatchlistPriceView,
  WatchlistPricesResponse,
} from "@/lib/types";

/**
 * İzleme listesi istemcisi — canlı fiyat takibi.
 *
 * Davranış sözleşmesi:
 *  - Polling: POLL_MS (10 sn) aralıklarla /api/market/prices çekilir;
 *    useEffect cleanup ile interval temizlenir (memory leak yok).
 *  - "Şimdi Yenile": /api/market/tick POST (yeni fiyat üret) → fiyatları
 *    yeniden çek. Tick, fiyatları değiştirdiği için yenilemenin ön koşuludur.
 *  - Ekleme: sembol girişi (3-5 harf BIST) → POST /api/watchlist.
 *  - Çıkarma: satırdaki çöp kutusu → DELETE /api/watchlist.
 *  - "BIST 100 Senkronize Et": POST /api/watchlist/sync-bist100 — güncel
 *    endeks listesini İş Yatırım kaynağından çeker; endeksten çıkan yalnızca
 *    otomatik (BIST100) kayıtları düşer, elle eklenenler korunur.
 *  - Satıra tıklayınca /stock/[symbol] detayına gider.
 *
 * Gereksiz re-render yok: fetch'ler useCallback ile sabitlenir; interval
 * callback'i ref üzerinden en güncel fonksiyona işaret eder.
 */

/** Otomatik yenileme aralığı (ms) — 10 saniye. */
const POLL_MS = 10_000;

/** Satır başına sparkline'da gösterilecek son fiyat örneklemesi. */
const SPARK_POINTS = 24;

/** Sparkline mini grafiği — saf SVG, bağımlılık yok. */
function Sparkline({
  points,
  positive,
}: {
  points: number[];
  positive: boolean;
}) {
  if (points.length < 2) {
    return <div className="h-6 w-20" aria-hidden />;
  }

  const width = 80;
  const height = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="h-6 w-20 overflow-visible"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={positive ? "#34d399" : "#fb7185"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Değişim yüzdesi görünümü — yeşil/kırmızı/nötr tonlama. */
function ChangeCell({
  change,
  changePercent,
}: {
  change: string | null;
  changePercent: string | null;
}) {
  if (change === null || changePercent === null) {
    return <span className="text-gray-500">—</span>;
  }

  const pct = Number(changePercent);
  const abs = Number(change);
  const positive = pct > 0;
  const negative = pct < 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        positive && "text-emerald-400",
        negative && "text-rose-400",
        !positive && !negative && "text-gray-400",
      )}
    >
      {positive ? (
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
      ) : negative ? (
        <TrendingDown className="h-3.5 w-3.5" aria-hidden />
      ) : null}
      {positive ? "+" : ""}
      {pct.toFixed(2)}%
      <span className="text-xs opacity-70">
        ({positive ? "+" : ""}
        {abs.toFixed(2)} TL)
      </span>
    </span>
  );
}

export function WatchlistClient({
  initialPrices,
  initialSource,
  initialBist100Status,
}: {
  initialPrices: WatchlistPriceView[];
  initialSource: PriceSourceStatus;
  initialBist100Status: Bist100SyncStatus;
}) {
  const router = useRouter();
  const [prices, setPrices] = useState<WatchlistPriceView[]>(initialPrices);
  const [source, setSource] = useState<PriceSourceStatus>(initialSource);
  const [bist100Status, setBist100Status] =
    useState<Bist100SyncStatus>(initialBist100Status);
  const [syncingBist100, setSyncingBist100] = useState(false);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [symbolInput, setSymbolInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);

  /** Fiyat listesini API'den çeker. */
  const fetchPrices = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/market/prices", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as WatchlistPricesResponse;
      setPrices(data.prices);
      if (data.source) setSource(data.source);
    } catch {
      // Polling hataları sessizce yutulur — son başarılı liste kalır.
    }
  }, []);

  /** Sparkline serilerini sembol başına son N kapanışla günceller. */
  const fetchSparks = useCallback(async (): Promise<void> => {
    try {
      const symbols = prices.map((p) => p.symbol);
      if (symbols.length === 0) return;
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          const response = await fetch(
            `/api/market/history?symbol=${symbol}&range=1D`,
            { cache: "no-store" },
          );
          if (!response.ok) return [symbol, []] as const;
          const data = (await response.json()) as { candles: { close: number }[] };
          const closes = data.candles
            .slice(-SPARK_POINTS)
            .map((c) => c.close);
          return [symbol, closes] as const;
        }),
      );
      setSparks(Object.fromEntries(entries));
    } catch {
      // Sparkline opsiyonel — hata halinde sessizce atlanır.
    }
    // prices bağımlılığı bilinçli: sembol seti değişince seri yeniden kurulur.
  }, [prices]);

  /** Tick + yenile: simülatörü çalıştır, sonra fiyatları çek. */
  const handleRefresh = useCallback(async (): Promise<void> => {
    if (ticking) return;
    setTicking(true);
    setNotice(null);
    try {
      const tickResponse = await fetch("/api/market/tick", { method: "POST" });
      if (!tickResponse.ok) {
        setNotice({
          kind: "error",
          message: "Piyasa tick'i tetiklenemedi.",
        });
        return;
      }
      await fetchPrices();
      await fetchSparks();
    } catch {
      setNotice({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.",
      });
    } finally {
      setTicking(false);
    }
  }, [ticking, fetchPrices, fetchSparks]);

  // Polling: her POLL_MS'te fiyatları yenile (interval cleanup'lı).
  const refreshRef = useRef(handleRefresh);
  useEffect(() => {
    refreshRef.current = handleRefresh;
  }, [handleRefresh]);

  useEffect(() => {
    // İlk açılışta sparkline'ları doldur.
    void fetchSparks();
    const interval = setInterval(() => {
      void refreshRef.current();
    }, POLL_MS);
    return () => clearInterval(interval);
    // fetchSparks, prices değişiminde yeniden kurulmaz — yalnızca mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** İzleme listesine sembol ekle. */
  async function handleAdd(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (symbol === "" || adding) return;

    setAdding(true);
    setNotice(null);
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Hisse eklenemedi.";
        setNotice({ kind: "error", message });
        return;
      }

      setSymbolInput("");
      setNotice({
        kind: "success",
        message: `${symbol} izleme listesine eklendi.`,
      });
      await fetchPrices();
      router.refresh();
    } catch {
      setNotice({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.",
      });
    } finally {
      setAdding(false);
    }
  }

  /** İzleme listesinden sembol çıkar. */
  async function handleRemove(
    event: React.MouseEvent<HTMLButtonElement>,
    symbol: string,
  ): Promise<void> {
    event.stopPropagation();
    if (ticking) return;

    try {
      const response = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Hisse çıkarılamadı.";
        setNotice({ kind: "error", message });
        return;
      }

      setNotice({
        kind: "success",
        message: `${symbol} izleme listesinden çıkarıldı.`,
      });
      await fetchPrices();
      router.refresh();
    } catch {
      setNotice({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.",
      });
    }
  }

  const inputValid = /^[A-ZÇĞİÖŞÜa-zçğıöşü]{3,5}$/.test(symbolInput.trim());

  /** BIST 100 listesini kaynaktan çekip izleme listesiyle senkronize eder. */
  async function handleSyncBist100(): Promise<void> {
    if (syncingBist100) return;
    setSyncingBist100(true);
    setNotice(null);
    try {
      const response = await fetch("/api/watchlist/sync-bist100", {
        method: "POST",
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "BIST 100 senkronu başarısız.";
        setNotice({ kind: "error", message });
        return;
      }

      const result = data as {
        fetchedCount: number;
        addedCount: number;
        removedCount: number;
        totalWatchlist: number;
      };
      setNotice({
        kind: "success",
        message:
          `BIST 100 senkronize edildi: ${result.fetchedCount} bileşen çekildi, ` +
          `${result.addedCount} yeni eklendi, ${result.removedCount} çıkarıldı ` +
          `(toplam ${result.totalWatchlist}).`,
      });
      await fetchPrices();
      router.refresh();
    } catch {
      setNotice({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.",
      });
    } finally {
      setSyncingBist100(false);
    }
  }

  /** BIST 100 senkron durumunu API'den çeker (polling sonrası tazeleme). */
  const fetchBist100Status = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/watchlist/sync-bist100", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as Bist100SyncStatus;
      setBist100Status(data);
    } catch {
      // Durum çekilemezse mevcut görünüm korunur.
    }
  }, []);

  // Senkron durumu 60 sn'de bir tazelenir (hafif sorgu).
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchBist100Status();
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchBist100Status]);

  /** "Son senkron: X dk önce" metni. */
  const lastSyncLabel = (() => {
    if (bist100Status.lastSyncedAt === null) return "henüz senkron yapılmadı";
    const diffMs = Date.now() - new Date(bist100Status.lastSyncedAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "az önce";
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours} sa önce`;
  })();

  return (
    <div className="space-y-4">
      {/* Üst bar: ekleme formu + yenileme butonu */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          onSubmit={handleAdd}
          className="flex items-center gap-2"
          aria-label="İzleme listesine hisse ekle"
        >
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            placeholder="BIST sembolü (örn. THYAO)"
            maxLength={5}
            className="w-48 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 uppercase outline-none transition-colors placeholder:normal-case placeholder:text-gray-500 focus:border-blue-500"
            aria-label="Sembol"
          />
          <button
            type="submit"
            disabled={!inputValid || adding}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Ekle
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <PriceSourceBadge source={source} />
          <button
            type="button"
            onClick={() => void handleSyncBist100()}
            disabled={syncingBist100}
            title={`BIST 100 güncel listesi İş Yatırım kaynağından otomatik çekilir (5 dk'da bir). Son senkron: ${lastSyncLabel}.`}
            className="flex items-center gap-1.5 rounded-lg border border-blue-800 bg-blue-950/40 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncingBist100 ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ListRestart className="h-4 w-4" aria-hidden />
            )}
            {syncingBist100 ? "Senkronize ediliyor..." : "BIST 100 Senkronize Et"}
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={ticking}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              className={cn("h-4 w-4", ticking && "animate-spin")}
              aria-hidden
            />
            {ticking ? "Yenileniyor..." : "Şimdi Yenile"}
          </button>
        </div>
      </div>

      {/* Bildirim */}
      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            notice.kind === "success"
              ? "border-emerald-800 bg-emerald-950/60 text-emerald-300"
              : "border-rose-800 bg-rose-950/60 text-rose-300",
          )}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {notice.message}
        </div>
      )}

      {/* Fiyat tablosu */}
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-medium">Sembol</th>
              <th className="px-4 py-3 font-medium">Ad</th>
              <th className="px-4 py-3 font-medium">Kaynak</th>
              <th className="px-4 py-3 text-right font-medium">Son Fiyat</th>
              <th className="px-4 py-3 text-right font-medium">Günlük Değişim</th>
              <th className="px-4 py-3 font-medium">Eğilim (1G)</th>
              <th className="px-4 py-3 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  İzleme listesi boş. Yukarıdaki formdan BIST sembolü ekleyin
                  veya "BIST 100 Senkronize Et" ile güncel endeks listesini çekin.
                </td>
              </tr>
            )}
            {prices.map((item) => {
              const spark = sparks[item.symbol] ?? [];
              const positive =
                item.changePercent !== null
                  ? Number(item.changePercent) >= 0
                  : true;
              return (
                <tr
                  key={item.stockId}
                  onClick={() => router.push(`/stock/${item.symbol}`)}
                  className="cursor-pointer border-b border-gray-800/60 transition-colors last:border-0 hover:bg-gray-800/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/stock/${item.symbol}`}
                      className="font-semibold text-blue-400 hover:text-blue-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        item.source === "BIST100"
                          ? "border-blue-800 bg-blue-950/60 text-blue-300"
                          : "border-gray-700 bg-gray-800/60 text-gray-400",
                      )}
                      title={
                        item.source === "BIST100"
                          ? "BIST 100 otomatik senkron kaydı — endeksten çıkarsa listeden düşer."
                          : "Elle eklenen kayıt — BIST 100 senkronu bu kayda dokunmaz."
                      }
                    >
                      {item.source === "BIST100" ? "BIST 100" : "Manuel"}
                    </span>
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-gray-300">
                    {item.name}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.lastPrice ? (
                      formatCurrency(Number(item.lastPrice))
                    ) : (
                      <span className="text-gray-500">Fiyat bekleniyor</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChangeCell
                      change={item.change}
                      changePercent={item.changePercent}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline points={spark} positive={positive} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => void handleRemove(e, item.symbol)}
                      disabled={ticking}
                      aria-label={`${item.symbol} izleme listesinden çıkar`}
                      className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-rose-950 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        {source.effective === "YAHOO"
          ? "Fiyatlar Yahoo Finance'den gerçek BIST verisi olarak çekilir; Yahoo erişilemezse otomatik olarak simüle veriye düşülür."
          : "Fiyatlar simülatörden (random walk) gelir; admin panelinden Yahoo Finance gerçek veri kaynağına geçebilirsiniz."}{" "}
        BIST 100 bileşenleri İş Yatırım kaynağından otomatik çekilir (5 dakikada
        bir yenilenir; son senkron: {lastSyncLabel}). Satıra tıklayarak hisse
        detayına ve canlı grafiğe gidebilirsiniz.
      </p>
    </div>
  );
}
