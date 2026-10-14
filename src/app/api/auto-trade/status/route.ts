import { NextResponse } from "next/server";
import {
  getAutoTradeStatus,
  listRecentAutoTradeRuns,
} from "@/server/services/auto-trade-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/auto-trade/status
 * Otomatik motor durumunu döner: anahtar, aralık, scheduler durumu,
 * son döngü özeti ve son N döngü kaydı (admin paneli + trading kartı).
 *
 * Query: ?runs=5 (son döngü sayısı; 1–50).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const runsParam = Number(url.searchParams.get("runs") ?? "5");
  const runs = Number.isFinite(runsParam) ? Math.min(50, Math.max(1, Math.floor(runsParam))) : 5;

  try {
    const [status, recentRuns] = await Promise.all([
      getAutoTradeStatus(),
      listRecentAutoTradeRuns(runs),
    ]);
    return NextResponse.json({ ...status, recentRuns });
  } catch (error: unknown) {
    console.error("[auto-trade/status GET] Hata:", error);
    return NextResponse.json(
      { error: "Otomatik motor durumu yüklenemedi." },
      { status: 500 },
    );
  }
}
