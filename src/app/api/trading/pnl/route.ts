import { NextResponse } from "next/server";
import { getPnlOverview } from "@/server/services/pnl-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/trading/pnl
 * Gerçekleşmiş K/Z analitiği: toplamlar, günlük grafik verisi
 * (histogram + kümülatif), hisse başına kırılım ve işlem listesi.
 * Sıfırlama damgasından sonraki emirler hesaba katılır.
 */
export async function GET() {
  try {
    const overview = await getPnlOverview();
    return NextResponse.json(overview);
  } catch (error: unknown) {
    console.error("[trading/pnl GET] Hata:", error);
    return NextResponse.json(
      { error: "K/Z verileri hesaplanamadı." },
      { status: 500 },
    );
  }
}
