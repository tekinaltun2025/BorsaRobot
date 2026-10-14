import { NextResponse } from "next/server";
import { getPortfolio } from "@/server/services/portfolio-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/trading/portfolio — pozisyonlar + hesap özeti (tek yanıtta).
 *
 * Yanıt: { summary: AccountSummaryView, positions: PositionView[] }
 * Tüm parasal alanlar string olarak döner (Decimal serileştirme, ADR-8).
 */
export async function GET() {
  try {
    const portfolio = await getPortfolio();
    return NextResponse.json(portfolio);
  } catch (error: unknown) {
    console.error("[trading/portfolio GET] Hata:", error);
    const message =
      error instanceof Error ? error.message : "Portföy yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
