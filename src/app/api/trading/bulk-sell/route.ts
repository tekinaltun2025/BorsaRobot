import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { bulkSellSchema } from "@/lib/validators/trading";
import { bulkSell, TradingError } from "@/server/services/trading-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/trading/bulk-sell — toplu satış (birden fazla pozisyon tek istekte).
 *
 * Sözleşme:
 *  - Gövde: { items: [{ symbol, quantity }], confirmLive?: boolean }
 *    (Zod doğrulamalı; en az 1, en fazla 50 öğe).
 *  - Hata izolasyonu: bir semboldeki hata (yetersiz lot, pozisyon yok) diğer
 *    öğeleri durdurmaz; yanıt özeti succeeded/failed listelerini içerir.
 *  - Yanıt: { succeeded: [{ symbol, quantity, realizedPnl, orderId }],
 *    failed: [{ symbol, quantity, error }], totalRealizedPnl } — HTTP 200.
 *    Kısmi başarı da 200'dür (başarısız öğeler failed listesinde raporlanır).
 *  - LIVE modda: liveModeConfirmedAt damgası + confirmLive=true zorunludur;
 *    eksikse 403 (LIVE_MODE_NOT_CONFIRMED). Doğrulama hataları 422 döner.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "trading-write");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = bulkSellSchema.safeParse(body);
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
    const result = await bulkSell(parsed.data.items, {
      confirmLive: parsed.data.confirmLive,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[trading/bulk-sell POST] Hata:", error);
    return NextResponse.json(
      { error: "Toplu satış işlenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
