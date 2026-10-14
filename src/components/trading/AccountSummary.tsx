import { FlaskConical, Layers, PiggyBank, Scale } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { AccountSummaryView } from "@/server/services/portfolio-service";

/**
 * Hesap özeti kartları — nakit bakiye, pozisyon değeri, toplam varlık, K/Z.
 * Parasal alanlar string (Decimal serileştirme) gelir; gösterim için
 * Number'a çevrilir (ADR-8: Number yalnızca gösterimde).
 */
export function AccountSummary({ summary }: { summary: AccountSummaryView }) {
  const cash = Number(summary.cashBalance);
  const positionsValue = Number(summary.positionsValue);
  const totalAssets = Number(summary.totalAssets);
  const realizedPnl = Number(summary.realizedPnl);
  const unrealizedPnl = Number(summary.unrealizedPnl);
  const totalPnl = Number(summary.totalPnl);

  const cards = [
    {
      label: "Nakit Bakiye",
      value: formatCurrency(cash),
      icon: PiggyBank,
      hint: "Sanal hesabın kullanılabilir bakiyesi",
      tone: "neutral" as const,
    },
    {
      label: "Pozisyon Değeri",
      value: formatCurrency(positionsValue),
      icon: Layers,
      hint: `${summary.openPositionCount} açık pozisyonun piyasa değeri`,
      tone: "neutral" as const,
    },
    {
      label: "Toplam Varlık",
      value: formatCurrency(totalAssets),
      icon: FlaskConical,
      hint: "Nakit bakiye + pozisyon değeri",
      tone: "neutral" as const,
    },
    {
      label: "Toplam K/Z",
      value: formatCurrency(totalPnl),
      icon: Scale,
      hint: `Gerçekleşen ${formatCurrency(realizedPnl)} · Açık ${formatCurrency(unrealizedPnl)}`,
      tone: totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "neutral",
    },
  ] as const;

  return (
    <section
      aria-label="Hesap özeti"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {card.label}
            </span>
            <card.icon className="h-4 w-4 text-blue-500" aria-hidden />
          </div>
          <p
            className={
              card.tone === "positive"
                ? "mt-3 text-2xl font-semibold tabular-nums text-emerald-400"
                : card.tone === "negative"
                  ? "mt-3 text-2xl font-semibold tabular-nums text-rose-400"
                  : "mt-3 text-2xl font-semibold tabular-nums"
            }
          >
            {card.value}
          </p>
          <p className="mt-1 text-xs text-gray-500">{card.hint}</p>
        </div>
      ))}
    </section>
  );
}
