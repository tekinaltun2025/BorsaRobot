import { NextResponse } from "next/server";
import { getWatchlistPrices } from "@/server/services/price-service";
import { resolvePriceSourceKind } from "@/server/services/price-source";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/prices — izleme listesindeki hisselerin son fiyatları.
 *
 * Yanıt: WatchlistPricesResponse — { prices: WatchlistPriceView[], source }.
 *
 * Fiyatlar Stock.lastPrice'tan okunur; seçili kaynak (AdminSettings.priceSource)
 * tick sırasında gerçek (Yahoo) veya simüle fiyatları DB'ye yazdığı için bu
 * endpoint her iki modda da güncel veriyi sunar. Source durumu UI rozetini
 * besler ("Gerçek Veri (Yahoo Finance)" / "Simüle Veri").
 *
 * Değişim referansı günün ilk PriceHistory kaydıdır (dayOpen); kayıt yoksa
 * change alanları null döner.
 */
export async function GET() {
  try {
    const [prices, selected] = await Promise.all([
      getWatchlistPrices(),
      resolvePriceSourceKind(),
    ]);
    return NextResponse.json({
      prices,
      source: {
        selected,
        effective: selected,
        fallbackUsed: false,
        fallbackReason: null,
      },
    });
  } catch (error: unknown) {
    console.error("[market/prices GET] Hata:", error);
    return NextResponse.json(
      { error: "Fiyat listesi yüklenemedi." },
      { status: 500 },
    );
  }
}
