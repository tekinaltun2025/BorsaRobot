import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { marketTickSchema } from "@/lib/validators/watchlist";
import { runTickWithSource } from "@/server/services/price-source";

export const dynamic = "force-dynamic";

/**
 * POST /api/market/tick — seçili fiyat kaynağıyla bir tick çalıştırır.
 *
 * Fiyat kaynağı AdminSettings.priceSource ile belirlenir (Strategy Pattern):
 *  - YAHOO     → izleme listesi sembolleri için gerçek fiyatlar çekilir
 *                (Yahoo Finance), Stock.lastPrice + PriceHistory güncellenir.
 *  - SIMULATED → mevcut simülatör davranışı (random walk).
 * Yahoo başarısızsa otomatik simülatöre (yedek) düşülür; source.fallbackUsed
 * ile bildirilir.
 *
 * Dev/test amaçlıdır; scheduler (ADR-10 JobRun pattern) bu route'u periyodik
 * olarak çağırır. Gövde opsiyoneldir:
 *  - { seed?: number }        → deterministik PRNG (yalnızca SIMULATED).
 *  - { symbols?: string[] }   → yalnızca bu sembolleri işle (test).
 *
 * Yanıt: { processed, prices: {symbol: price}, tickedAt, source }.
 */
export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = marketTickSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Doğrulama hatası.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  try {
    const result = await runTickWithSource({
      seed: parsed.data.seed,
      symbols: parsed.data.symbols,
    });

    return NextResponse.json({
      processed: result.processed,
      prices: result.prices,
      tickedAt: result.tickedAt.toISOString(),
      source: result.source,
    });
  } catch (error: unknown) {
    console.error("[market/tick POST] Hata:", error);
    return NextResponse.json(
      { error: "Piyasa tick'i çalıştırılırken hata oluştu." },
      { status: 500 },
    );
  }
}
