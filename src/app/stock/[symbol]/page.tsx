import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { StockDetailView } from "@/lib/types";
import {
  getStockDailySummary,
  getStockStats,
} from "@/server/services/price-service";
import { fetchHistoryWithSource } from "@/server/services/price-source";
import { isInWatchlist } from "@/server/services/watchlist-service";
import { StockDetailClient } from "@/components/stock/StockDetailClient";

export const dynamic = "force-dynamic";

/**
 * /stock/[symbol] — Hisse detay sayfası (server component).
 *
 * İlk render verisi: günlük özet + 1D mumlar + istatistikler + izleme
 * listesi üyeliği. Canlı güncelleme (polling, dönem değişimi, crosshair)
 * StockDetailClient'a aittir.
 */
export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();

  const stock = await prisma.stock.findUnique({
    where: { symbol },
  });
  if (!stock) {
    notFound();
  }

  const [daily, history, stats, inWatchlist] = await Promise.all([
    getStockDailySummary(symbol),
    fetchHistoryWithSource(symbol, "1D"),
    getStockStats(symbol, "1D"),
    isInWatchlist(symbol),
  ]);
  const candles = history.candles;

  const view: StockDetailView = {
    stockId: stock.id,
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    lastPrice: daily.lastPrice,
    change: daily.change,
    changePercent: daily.changePercent,
    dayHigh: daily.dayHigh,
    dayLow: daily.dayLow,
    updatedAt: daily.updatedAt,
    inWatchlist,
  };

  return (
    <StockDetailClient
      stock={view}
      initialCandles={candles}
      initialStats={stats}
      initialSource={history.source}
    />
  );
}
