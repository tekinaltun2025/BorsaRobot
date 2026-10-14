"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Layers,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { PositionView } from "@/server/services/portfolio-service";
import type { BulkSellResult } from "@/server/services/trading-service";
import type { TradingMode } from "@/lib/types";

/** Decimal string → güvenli Number (gösterim amaçlı; ADR-8). */
function num(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** K/Z yüzdesine göre renk sınıfı. */
function pnlClass(value: number | null): string {
  if (value === null) return "text-gray-400";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-gray-300";
}

/** Seçim durumu — sembol → girilen adet (boş string = tüm lot). */
type SelectionMap = Record<string, string>;

/** Toplu satış diyaloğu durumu. */
type BulkOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "result"; result: BulkSellResult }
  | { kind: "error"; message: string };

/**
 * Pozisyon tablosu — sembol, adet, ort. maliyet, güncel fiyat, piyasa değeri,
 * gerçekleşmemiş K/Z (TL ve %). Fiyatı olmayan pozisyonlar "—" gösterir.
 *
 * Toplu satış kolaylığı: her satırın solunda kutulu seçim (checkbox); seçim
 * yapıldığında toplu satış çubuğu açılır — seçili pozisyonlar için adet
 * girişi (varsayılan: tüm lot), "Toplu Sat" ve "Vazgeç" butonları. Onay
 * diyaloğu sonrası /api/trading/bulk-sell çağrılır; sonuç özeti (başarılı/
 * başarısız + toplam gerçekleşen K/Z) tablo altında gösterilir.
 */
export function PortfolioTable({
  positions,
  tradingMode,
  onBulkSold,
}: {
  positions: PositionView[];
  /** Aktif çalışma modu — LIVE'da onay diyaloğunda ekstra uyarı gösterilir. */
  tradingMode: TradingMode;
  /** Toplu satış tamamlandığında üst bileşene (portföy yenileme) bildirilir. */
  onBulkSold?: () => void;
}) {
  const [selection, setSelection] = useState<SelectionMap>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome>({ kind: "idle" });
  const isLive = tradingMode === "LIVE";

  const selectedSymbols = useMemo(
    () => Object.keys(selection).filter((symbol) => selection[symbol] !== undefined),
    [selection],
  );
  const selectedCount = selectedSymbols.length;

  /** Seçili pozisyonların tahmini toplam değeri (adet girişlerine göre). */
  const totalEstimate = useMemo(() => {
    let total = 0;
    let valid = true;
    for (const symbol of selectedSymbols) {
      const position = positions.find((p) => p.symbol === symbol);
      if (!position) continue;
      const price = num(position.lastPrice);
      if (price === null) {
        valid = false;
        continue;
      }
      const rawQty = selection[symbol] ?? "";
      const qty = rawQty.trim() === "" ? Number(position.quantity) : Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0 || qty > Number(position.quantity)) {
        valid = false;
        continue;
      }
      total += price * qty;
    }
    return valid ? total : null;
  }, [selection, selectedSymbols, positions]);

  /** Seçili her pozisyon için girilen adet geçerli mi? */
  const allQuantitiesValid = useMemo(() => {
    for (const symbol of selectedSymbols) {
      const position = positions.find((p) => p.symbol === symbol);
      if (!position) return false;
      const rawQty = selection[symbol] ?? "";
      if (rawQty.trim() === "") continue; // boş = tüm lot (geçerli)
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0 || qty > Number(position.quantity)) {
        return false;
      }
    }
    return true;
  }, [selection, selectedSymbols, positions]);

  /** Fiyatı olmayan (satılamayan) pozisyon seçili mi? */
  const hasUnpricedSelection = useMemo(
    () =>
      selectedSymbols.some((symbol) => {
        const position = positions.find((p) => p.symbol === symbol);
        return position !== undefined && num(position.lastPrice) === null;
      }),
    [selectedSymbols, positions],
  );

  function toggleRow(symbol: string): void {
    setOutcome({ kind: "idle" });
    setSelection((prev) => {
      const next = { ...prev };
      if (symbol in next) {
        delete next[symbol];
      } else {
        next[symbol] = ""; // varsayılan: tüm lot
      }
      return next;
    });
  }

  function toggleAll(): void {
    setOutcome({ kind: "idle" });
    setSelection((prev) => {
      if (Object.keys(prev).length === positions.length) {
        return {}; // tümünü bırak
      }
      const next: SelectionMap = {};
      for (const p of positions) next[p.symbol] = ""; // varsayılan: tüm lot
      return next;
    });
  }

  function setQuantity(symbol: string, value: string): void {
    setSelection((prev) => ({ ...prev, [symbol]: value }));
  }

  function clearSelection(): void {
    setSelection({});
    setConfirmOpen(false);
    setOutcome({ kind: "idle" });
  }

  /** Bulk istek gövdesi — boş adet = tüm lot'a çevrilir. */
  function buildItems(): { symbol: string; quantity: number }[] {
    return selectedSymbols
      .map((symbol) => {
        const position = positions.find((p) => p.symbol === symbol);
        if (!position) return null;
        const rawQty = selection[symbol] ?? "";
        const qty =
          rawQty.trim() === "" ? Number(position.quantity) : Number(rawQty);
        return { symbol, quantity: qty };
      })
      .filter((item): item is { symbol: string; quantity: number } => item !== null);
  }

  async function handleBulkSell(): Promise<void> {
    const items = buildItems();
    if (items.length === 0) return;

    setOutcome({ kind: "submitting" });
    try {
      const response = await fetch("/api/trading/bulk-sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          ...(isLive ? { confirmLive: true } : {}),
        }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Toplu satış gönderilemedi.";
        setOutcome({ kind: "error", message });
        setConfirmOpen(false);
        return;
      }

      setOutcome({ kind: "result", result: data as BulkSellResult });
      setConfirmOpen(false);
      setSelection({});
      onBulkSold?.();
    } catch {
      setOutcome({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
      });
      setConfirmOpen(false);
    }
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
        <Briefcase className="h-8 w-8 text-gray-600" aria-hidden />
        <p className="text-sm font-medium text-gray-300">Açık pozisyon yok</p>
        <p className="text-xs text-gray-500">
          Alım emri verdiğinizde pozisyonlar burada listelenir.
        </p>
      </div>
    );
  }

  const allSelected = selectedCount === positions.length;

  return (
    <div className="space-y-3">
      {/* Toplu satış çubuğu — seçim yapıldığında görünür. */}
      {selectedCount > 0 && (
        <div className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-amber-400" aria-hidden />
              <span className="font-medium text-amber-100">
                {selectedCount} pozisyon seçildi
              </span>
              <span className="text-amber-200/70">
                · Toplam tahmini değer:{" "}
                {totalEstimate === null ? "—" : formatCurrency(totalEstimate)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!allQuantitiesValid || hasUnpricedSelection}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden />
                Toplu Sat
              </button>
            </div>
          </div>

          {/* Seçili pozisyonlar için kompakt adet girişleri. */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {selectedSymbols.map((symbol) => {
              const position = positions.find((p) => p.symbol === symbol);
              if (!position) return null;
              const rawQty = selection[symbol] ?? "";
              const qty = rawQty.trim() === "" ? Number(position.quantity) : Number(rawQty);
              const invalid =
                rawQty.trim() !== "" &&
                (!Number.isInteger(qty) || qty <= 0 || qty > Number(position.quantity));
              const price = num(position.lastPrice);
              return (
                <div
                  key={symbol}
                  className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-200">
                    {symbol}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={Number(position.quantity)}
                    step={1}
                    inputMode="numeric"
                    value={rawQty}
                    onChange={(e) => setQuantity(symbol, e.target.value)}
                    placeholder={`${Number(position.quantity).toLocaleString("tr-TR")} (tümü)`}
                    aria-label={`${symbol} satılacak adet`}
                    className={cn(
                      "w-24 rounded-md border bg-gray-950 px-2 py-1 text-right text-xs tabular-nums text-gray-100 outline-none transition-colors focus:border-blue-500",
                      invalid ? "border-rose-600" : "border-gray-700",
                    )}
                  />
                  <span className="w-20 text-right text-[11px] tabular-nums text-gray-500">
                    {price !== null && !invalid && qty > 0
                      ? formatCurrency(price * qty)
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          {hasUnpricedSelection && (
            <p className="mt-2 text-xs text-rose-400">
              Fiyatı olmayan pozisyonlar satılamaz; seçimden çıkarın.
            </p>
          )}
        </div>
      )}

      {/* Pozisyon tablosu — sol sütunda kutulu seçim. */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/80 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Tümünü seç"
                  className="h-4 w-4 cursor-pointer accent-rose-500"
                />
              </th>
              <th className="px-4 py-3 font-medium">Sembol</th>
              <th className="px-4 py-3 text-right font-medium">Adet</th>
              <th className="px-4 py-3 text-right font-medium">Ort. Maliyet</th>
              <th className="px-4 py-3 text-right font-medium">Güncel Fiyat</th>
              <th className="px-4 py-3 text-right font-medium">Piyasa Değeri</th>
              <th className="px-4 py-3 text-right font-medium">K/Z</th>
              <th className="px-4 py-3 text-right font-medium">K/Z %</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const lastPrice = num(p.lastPrice);
              const marketValue = num(p.marketValue);
              const pnl = num(p.unrealizedPnl);
              const pnlPercent = num(p.unrealizedPnlPercent);
              const checked = p.symbol in selection;
              return (
                <tr
                  key={p.id}
                  className={cn(
                    "border-b border-gray-800/60 transition-colors last:border-b-0 hover:bg-gray-900/60",
                    checked && "bg-amber-950/10",
                  )}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(p.symbol)}
                      aria-label={`${p.symbol} pozisyonunu seç`}
                      className="h-4 w-4 cursor-pointer accent-rose-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-100">{p.symbol}</span>
                    <span className="block text-xs text-gray-500">{p.name}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {Number(p.quantity).toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {formatCurrency(Number(p.avgCost))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {lastPrice === null ? "—" : formatCurrency(lastPrice)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {marketValue === null ? "—" : formatCurrency(marketValue)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${pnlClass(pnl)}`}>
                    {pnl === null ? "—" : formatCurrency(pnl)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${pnlClass(pnlPercent)}`}>
                    {pnlPercent === null
                      ? "—"
                      : `${pnlPercent > 0 ? "+" : ""}${pnlPercent.toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Toplu satış onay diyaloğu. */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-sell-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl border border-rose-800 bg-gray-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h3 id="bulk-sell-confirm-title" className="font-semibold text-rose-300">
                Toplu Satış Onayı
              </h3>
            </div>
            <p className="mt-3 text-sm text-gray-300">
              <strong>{selectedCount}</strong> pozisyon satılacak, toplam tahmini
              tutar{" "}
              <strong className="tabular-nums">
                {totalEstimate === null ? "—" : formatCurrency(totalEstimate)}
              </strong>
              . Onaylıyor musunuz?
            </p>
            <ul className="mt-3 space-y-1 rounded-lg bg-gray-950/60 p-3 text-xs text-gray-300">
              {selectedSymbols.map((symbol) => {
                const position = positions.find((p) => p.symbol === symbol);
                if (!position) return null;
                const rawQty = selection[symbol] ?? "";
                const qty =
                  rawQty.trim() === "" ? Number(position.quantity) : Number(rawQty);
                return (
                  <li key={symbol} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{symbol}</span>
                    <span className="tabular-nums text-gray-400">
                      {qty.toLocaleString("tr-TR")} adet
                    </span>
                  </li>
                );
              })}
            </ul>
            {isLive && (
              <p className="mt-3 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                CANLI İŞLEM: Bu satışlar DenizBank üzerinden{" "}
                <strong>gerçek para</strong> ile gerçekleştirilir ve geri
                alınamaz.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleBulkSell}
                disabled={outcome.kind === "submitting"}
                className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {outcome.kind === "submitting" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                {outcome.kind === "submitting" ? "Satılıyor..." : "Onaylıyorum, Sat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toplu satış sonuç özeti. */}
      {outcome.kind === "result" && (
        <div
          role="status"
          className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 text-sm"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
            <span className="font-medium text-gray-200">
              Toplu satış tamamlandı — {outcome.result.succeeded.length} başarılı
              {outcome.result.failed.length > 0
                ? `, ${outcome.result.failed.length} başarısız`
                : ""}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Toplam gerçekleşen K/Z:{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                Number(outcome.result.totalRealizedPnl) >= 0
                  ? "text-emerald-400"
                  : "text-rose-400",
              )}
            >
              {formatCurrency(Number(outcome.result.totalRealizedPnl))}
            </span>
          </p>
          {outcome.result.succeeded.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {outcome.result.succeeded.map((s) => (
                <li key={s.symbol} className="flex items-center gap-1.5 text-emerald-300">
                  <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {s.symbol}: {s.quantity.toLocaleString("tr-TR")} adet satıldı
                    {s.realizedPnl !== null
                      ? ` — K/Z: ${formatCurrency(Number(s.realizedPnl))}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {outcome.result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {outcome.result.failed.map((f) => (
                <li key={f.symbol} className="flex items-start gap-1.5 text-rose-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {f.symbol}: {f.error}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Toplu satış hata mesajı (istek düzeyi). */}
      {outcome.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{outcome.message}</p>
        </div>
      )}
    </div>
  );
}
