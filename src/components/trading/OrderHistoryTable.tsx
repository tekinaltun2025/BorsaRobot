import { Bot, History, User } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { PlaceOrderResult } from "@/server/services/trading-service";

/** Emir durumuna göre rozet sınıfı ve etiketi. */
const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  FILLED: { label: "Gerçekleşti", className: "bg-emerald-950 text-emerald-300 border-emerald-800" },
  REJECTED: { label: "Reddedildi", className: "bg-rose-950 text-rose-300 border-rose-800" },
  PENDING: { label: "Bekliyor", className: "bg-amber-950 text-amber-300 border-amber-800" },
  EXECUTING: { label: "İşleniyor", className: "bg-amber-950 text-amber-300 border-amber-800" },
  PENDING_RECONCILIATION: {
    label: "Mutabakat",
    className: "bg-amber-950 text-amber-300 border-amber-800",
  },
  FAILED: { label: "Başarısız", className: "bg-rose-950 text-rose-300 border-rose-800" },
  CANCELLED: { label: "İptal", className: "bg-gray-800 text-gray-300 border-gray-700" },
};

/**
 * Emir kaynağı rozetleri (Faz 5) — otomatik motor emirleri mor/robot
 * ikonlu "Otomatik", manuel emirler gri "Manuel" olarak işaretlenir.
 */
const SOURCE_BADGES: Record<
  string,
  { label: string; className: string; icon: typeof Bot }
> = {
  AUTO_ENGINE: {
    label: "Otomatik",
    className: "bg-purple-950 text-purple-300 border-purple-800",
    icon: Bot,
  },
  MANUAL: {
    label: "Manuel",
    className: "bg-gray-800 text-gray-300 border-gray-700",
    icon: User,
  },
  RISK_RULE: {
    label: "Kural",
    className: "bg-amber-950 text-amber-300 border-amber-800",
    icon: Bot,
  },
};

/**
 * Emir geçmişi tablosu — sembol, yön, adet, fiyat, tutar, komisyon, K/Z,
 * durum ve zaman. Sayfalama kontrolleri içerir.
 */
export function OrderHistoryTable({
  orders,
  total,
  page,
  pageSize,
  onPageChange,
}: {
  orders: PlaceOrderResult["order"][];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
        <History className="h-8 w-8 text-gray-600" aria-hidden />
        <p className="text-sm font-medium text-gray-300">Henüz emir yok</p>
        <p className="text-xs text-gray-500">
          Verdiğiniz alım/satım emirleri burada listelenir.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/80 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Zaman</th>
              <th className="px-4 py-3 font-medium">Sembol</th>
              <th className="px-4 py-3 font-medium">Yön</th>
              <th className="px-4 py-3 text-right font-medium">Adet</th>
              <th className="px-4 py-3 text-right font-medium">Fiyat</th>
              <th className="px-4 py-3 text-right font-medium">Tutar</th>
              <th className="px-4 py-3 text-right font-medium">Komisyon</th>
              <th className="px-4 py-3 text-right font-medium">K/Z</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">Kaynak</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const badge = STATUS_BADGES[o.status] ?? {
                label: o.status,
                className: "bg-gray-800 text-gray-300 border-gray-700",
              };
              const pnl = o.realizedPnl === null ? null : Number(o.realizedPnl);
              return (
                <tr
                  key={o.id}
                  className="border-b border-gray-800/60 transition-colors last:border-b-0 hover:bg-gray-900/60"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                    {formatDate(o.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-100">{o.symbol}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        o.side === "BUY"
                          ? "font-medium text-emerald-400"
                          : "font-medium text-rose-400"
                      }
                    >
                      {o.side === "BUY" ? "AL" : "SAT"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {Number(o.quantity).toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {o.filledPrice === null ? "—" : formatCurrency(Number(o.filledPrice))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                    {o.filledValue === null ? "—" : formatCurrency(Number(o.filledValue))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {o.commission === null ? "—" : formatCurrency(Number(o.commission))}
                  </td>
                  <td
                    className={
                      pnl === null
                        ? "px-4 py-3 text-right text-gray-500"
                        : `px-4 py-3 text-right tabular-nums ${
                            pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-rose-400" : "text-gray-300"
                          }`
                    }
                  >
                    {pnl === null ? "—" : formatCurrency(pnl)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      title={o.errorMessage ?? undefined}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const source = SOURCE_BADGES[o.source] ?? {
                        label: o.source,
                        className: "bg-gray-800 text-gray-300 border-gray-700",
                        icon: User,
                      };
                      const Icon = source.icon;
                      return (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${source.className}`}
                          title={`Emir kaynağı: ${o.source}`}
                        >
                          <Icon className="h-3 w-3" aria-hidden />
                          {source.label}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          Toplam {total} emir · Sayfa {page}/{totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-gray-700 px-3 py-1 font-medium transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Önceki
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-gray-700 px-3 py-1 font-medium transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      </div>
    </div>
  );
}
