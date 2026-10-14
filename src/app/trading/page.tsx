import { FlaskConical } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getPortfolio } from "@/server/services/portfolio-service";
import { getAutoTradeStatus } from "@/server/services/auto-trade-service";
import { TradingDashboard } from "@/components/trading/TradingDashboard";
import { AutoTradeStatusCard } from "@/components/trading/AutoTradeStatusCard";
import type { OrderFormStock } from "@/components/trading/OrderForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Trading",
};

/**
 * /trading — Portföy dashboard'u (server component).
 *
 * Veri akışı: portfolio-service (özet + pozisyonlar) + izleme listesi
 * (sembol seçimi) + AdminSettings.commissionRate (form tahmini) →
 * TradingDashboard client kabuğuna props olarak iner.
 */
export default async function TradingPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; side?: string }>;
}) {
  const { symbol: querySymbol, side: querySide } = await searchParams;
  const [portfolio, watchlistStocks, settings, autoTradeStatus] = await Promise.all([
    getPortfolio(),
    prisma.watchlist.findMany({
      include: {
        stock: {
          select: { symbol: true, name: true, lastPrice: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.adminSettings.findUnique({
      where: { id: "singleton" },
      select: { commissionRate: true, tradingMode: true },
    }),
    getAutoTradeStatus(),
  ]);

  const stocks: OrderFormStock[] = watchlistStocks.map((w) => ({
    symbol: w.stock.symbol,
    name: w.stock.name,
    lastPrice: w.stock.lastPrice ? w.stock.lastPrice.toString() : null,
  }));

  const commissionRatePercent = (settings?.commissionRate ?? 0.1).toString();
  const isLive = settings?.tradingMode === "LIVE";

  // /stock/[symbol] hızlı Al/Sat yönlendirmesi: sembol listede varsa seçili.
  const defaultSymbol =
    querySymbol && stocks.some((s) => s.symbol === querySymbol.toUpperCase())
      ? querySymbol.toUpperCase()
      : stocks[0]?.symbol ?? "";
  const defaultSide = querySide === "SELL" ? "SELL" : "BUY";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Trading</h1>
          <span
            className={
              isLive
                ? "inline-flex items-center gap-1 rounded-full border border-rose-700 bg-rose-950 px-2.5 py-0.5 text-xs font-medium text-rose-300"
                : "inline-flex items-center gap-1 rounded-full border border-emerald-700 bg-emerald-950 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
            }
          >
            <FlaskConical className="h-3 w-3" aria-hidden />
            {isLive ? "Canlı Mod" : "Sanal (Paper) Mod"}
          </span>
        </div>
        <p className="max-w-2xl text-sm text-gray-400">
          Sanal bakiyenizle alım-satım yapın; pozisyonlarınız, gerçekleşen
          kâr/zararınız ve emir geçmişiniz gerçek zamanlı hesaplanır. Fiyatlar
          veri tabanındaki son fiyat üzerinden işlenir.
        </p>
      </section>

      <AutoTradeStatusCard status={autoTradeStatus} />

      <TradingDashboard
        portfolio={portfolio}
        stocks={stocks}
        commissionRatePercent={commissionRatePercent}
        defaultSymbol={defaultSymbol}
        defaultSide={defaultSide}
        tradingMode={isLive ? "LIVE" : "PAPER"}
      />
    </div>
  );
}
