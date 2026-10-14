import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { historyQuerySchema } from "@/lib/validators/watchlist";
import { getStockStats, PriceServiceError } from "@/server/services/price-service";
import { fetchHistoryWithSource } from "@/server/services/price-source";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/history?symbol=XXX&range=1D|1W|1M|3M|1Y
 *
 * Sembolün fiyat geçmişi — Lightweight Charts uyumlu
 * { time, open, high, low, close } mumları (ChartCandle[]).
 *
 * Fiyat kaynağı AdminSettings.priceSource ile belirlenir (Strategy Pattern):
 *  - YAHOO     → gerçek OHLC Yahoo Finance'ten çekilir ve PriceHistory'ye
 *                yazılır (sembol başına bir kez; mevcut zamanlar atlanır).
 *  - SIMULATED → DB PriceHistory kayıtları dönem penceresine göre
 *                kovalara gruplanarak anlamlı mumlar üretilir.
 * Yahoo başarısızsa DB geçmişine (yedek) düşülür; source.fallbackUsed ile
 * bildirilir. Geçmiş hiç yoksa son fiyat tek mum olarak döner.
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = historyQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Geçersiz sorgu parametreleri.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const { symbol, range } = parsed.data;

  try {
    const [history, stats] = await Promise.all([
      fetchHistoryWithSource(symbol, range),
      getStockStats(symbol, range),
    ]);

    return NextResponse.json({
      symbol,
      range,
      candles: history.candles,
      stats,
      source: history.source,
    });
  } catch (error: unknown) {
    if (error instanceof PriceServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[market/history GET] Hata:", error);
    return NextResponse.json(
      { error: "Fiyat geçmişi yüklenemedi." },
      { status: 500 },
    );
  }
}
