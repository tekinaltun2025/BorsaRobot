"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import type { PlaceOrderResult } from "@/server/services/trading-service";
import type { TradingMode } from "@/lib/types";

/** Sembol seçim listesi öğesi — izleme listesinden beslenir. */
export interface OrderFormStock {
  symbol: string;
  name: string;
  lastPrice: string | null;
}

/** Formun sonucu — başarılı emirler üst bileşene (refresh) bildirilir. */
type FormOutcome =
  | { kind: "idle" }
  | { kind: "success"; message: string; order: PlaceOrderResult["order"]; idempotentReplay: boolean }
  | { kind: "error"; message: string };

/**
 * Al/Sat formu — sembol seçimi (izleme listesi), BUY/SELL toggle, tamsayı
 * miktar, tahmini tutar (fiyat × adet + komisyon), onay ve sonuç mesajı.
 *
 * clientRequestId her gönderimde crypto.randomUUID() ile üretilir —
 * idempotency anahtarı istemci tarafında tutulur (ADR-7).
 */
export function OrderForm({
  stocks,
  cashBalance,
  commissionRatePercent,
  defaultSymbol,
  defaultSide,
  tradingMode,
  onOrderPlaced,
}: {
  stocks: OrderFormStock[];
  cashBalance: string;
  commissionRatePercent: string;
  /** /stock/[symbol] hızlı emir yönlendirmesinden gelen sembol. */
  defaultSymbol?: string;
  /** /stock/[symbol] hızlı emir yönlendirmesinden gelen yön. */
  defaultSide?: "BUY" | "SELL";
  /** Aktif çalışma modu — LIVE'da canlı işlem uyarısı + ekstra onay gösterilir. */
  tradingMode: TradingMode;
  onOrderPlaced: () => void;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">(defaultSide ?? "BUY");
  const [symbol, setSymbol] = useState<string>(
    defaultSymbol ?? stocks[0]?.symbol ?? "",
  );
  const [quantity, setQuantity] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<FormOutcome>({ kind: "idle" });
  /** Canlı mod ekstra onayı — kullanıcı "CANLI İŞLEM" uyarısını onayladı mı? */
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const isLive = tradingMode === "LIVE";

  const selected = useMemo(
    () => stocks.find((s) => s.symbol === symbol) ?? null,
    [stocks, symbol],
  );

  const price = selected?.lastPrice ? Number(selected.lastPrice) : null;
  const qty = quantity.trim() === "" ? 0 : Number(quantity);
  const isValidQty = Number.isInteger(qty) && qty > 0;
  const estimate =
    price !== null && isValidQty ? price * qty : null;
  const commission =
    estimate !== null ? (estimate * Number(commissionRatePercent)) / 100 : null;
  const totalEstimate = estimate !== null && commission !== null ? estimate + commission : null;

  const canSubmit =
    !submitting && symbol !== "" && isValidQty && price !== null &&
    (!isLive || liveConfirmed);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    // Canlı modda onay kutusu her gönderimden sonra sıfırlanır — her emir
    // için bilinçli, ayrı bir onay zorunludur (yanlışlıkla seri emir koruması).
    if (isLive) setLiveConfirmed(false);

    setSubmitting(true);
    setOutcome({ kind: "idle" });

    try {
      const response = await fetch("/api/trading/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side,
          symbol,
          quantity: qty,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Emir gönderilemedi.";
        setOutcome({ kind: "error", message });
        return;
      }

      const result = data as PlaceOrderResult;
      if (result.order.status === "FILLED") {
        setOutcome({
          kind: "success",
          idempotentReplay: result.idempotentReplay,
          order: result.order,
          message:
            `${result.order.side === "BUY" ? "Alım" : "Satım"} emri gerçekleşti: ` +
            `${Number(result.order.quantity).toLocaleString("tr-TR")} adet ` +
            `${result.order.symbol} @ ${formatCurrency(Number(result.order.filledPrice ?? 0))}` +
            (result.order.realizedPnl !== null
              ? ` — K/Z: ${formatCurrency(Number(result.order.realizedPnl))}`
              : ""),
        });
        setQuantity("");
        onOrderPlaced();
      } else {
        setOutcome({
          kind: "error",
          message:
            result.order.errorMessage ??
            `Emir ${result.order.status} durumuna geçti.`,
        });
        onOrderPlaced(); // REJECTED emir de geçmişe düşer — listeyi tazele
      }
    } catch {
      setOutcome({
        kind: "error",
        message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5"
      aria-label="Emir formu"
    >
      <div>
        <h2 className="font-semibold">Hızlı Emir</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Nakit bakiye: {formatCurrency(Number(cashBalance))} · Komisyon: %{Number(commissionRatePercent).toLocaleString("tr-TR")}
        </p>
      </div>

      {/* BUY/SELL toggle */}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Emir yönü">
        {(["BUY", "SELL"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={side === option}
            onClick={() => setSide(option)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
              side === option
                ? option === "BUY"
                  ? "border-emerald-600 bg-emerald-950 text-emerald-300"
                  : "border-rose-600 bg-rose-950 text-rose-300"
                : "border-gray-700 text-gray-400 hover:bg-gray-800",
            )}
          >
            {option === "BUY" ? (
              <TrendingUp className="h-4 w-4" aria-hidden />
            ) : (
              <TrendingDown className="h-4 w-4" aria-hidden />
            )}
            {option === "BUY" ? "AL" : "SAT"}
          </button>
        ))}
      </div>

      {/* Sembol seçimi */}
      <div className="space-y-1.5">
        <label htmlFor="order-symbol" className="text-xs font-medium text-gray-400">
          Sembol
        </label>
        <select
          id="order-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500"
        >
          {stocks.length === 0 && <option value="">İzleme listesi boş</option>}
          {stocks.map((s) => (
            <option key={s.symbol} value={s.symbol}>
              {s.symbol} — {s.name}
              {s.lastPrice ? ` (${formatCurrency(Number(s.lastPrice))})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Miktar */}
      <div className="space-y-1.5">
        <label htmlFor="order-quantity" className="text-xs font-medium text-gray-400">
          Miktar (lot)
        </label>
        <input
          id="order-quantity"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="Örn. 100"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500"
        />
        {quantity.trim() !== "" && !isValidQty && (
          <p className="text-xs text-rose-400">
            Miktar 1 veya daha büyük bir tamsayı olmalıdır.
          </p>
        )}
      </div>

      {/* Tahmini tutar */}
      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs">
        <div className="flex items-center justify-between text-gray-400">
          <span>Tahmini tutar</span>
          <span className="tabular-nums text-gray-200">
            {estimate === null ? "—" : formatCurrency(estimate)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-gray-400">
          <span>Komisyon (%{Number(commissionRatePercent).toLocaleString("tr-TR")})</span>
          <span className="tabular-nums text-gray-200">
            {commission === null ? "—" : formatCurrency(commission)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between border-t border-gray-800 pt-1.5 font-medium text-gray-300">
          <span>{side === "BUY" ? "Toplam maliyet" : "Net hasılat"}</span>
          <span className="tabular-nums">
            {totalEstimate === null ? "—" : formatCurrency(totalEstimate)}
          </span>
        </div>
      </div>

      {/* CANLI İŞLEM uyarısı + ekstra onay — yalnızca LIVE modda görünür. */}
      {isLive && (
        <div className="space-y-2 rounded-lg border border-amber-700 bg-amber-950/40 p-3">
          <div className="flex items-start gap-2 text-xs text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">CANLI İŞLEM MODU AKTİF</p>
              <p className="mt-1 text-amber-200/80">
                Bu emir DenizBank üzerinden <strong>gerçek para</strong> ile
                gerçekleştirilir. Emir verildiğinde iptal edilemez ve
                kur sapmasından doğan fark sizin sorumluluğunuzdadır.
              </p>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-100">
            <input
              type="checkbox"
              checked={liveConfirmed}
              onChange={(e) => setLiveConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
              aria-label="Canlı işlem risklerini onaylıyorum"
            />
            <span>
              Gerçek para ile işlem yapılacağını, işlemin geri alınamayacağını
              ve kur riskini onaylıyorum.
            </span>
          </label>
        </div>
      )}

      {/* Gönder */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors",
          side === "BUY"
            ? "bg-emerald-600 hover:bg-emerald-500"
            : "bg-rose-600 hover:bg-rose-500",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitting
          ? "Gönderiliyor..."
          : `${side === "BUY" ? "AL" : "SAT"} — ${symbol || "sembol seçin"}`}
      </button>

      {/* Sonuç mesajı */}
      {outcome.kind === "success" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-800 bg-emerald-950/60 p-3 text-xs text-emerald-200"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{outcome.message}</p>
            {outcome.idempotentReplay && (
              <p className="mt-1 text-emerald-300/70">
                Bu istek daha önce işlenmişti; mevcut emir aynen döndürüldü
                (idempotent tekrar).
              </p>
            )}
          </div>
        </div>
      )}
      {outcome.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{outcome.message}</p>
        </div>
      )}
    </form>
  );
}
