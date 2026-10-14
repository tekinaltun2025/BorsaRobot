import { NextResponse } from "next/server";
import { resetPnl } from "@/server/services/pnl-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/trading/pnl/reset
 * Gerçekleşmiş K/Z'yi sıfırlar: PnlReset damgasını şimdiye çeker.
 * Emir geçmişi ASLA silinmez — bu andan sonraki K/Z hesaplamaları
 * yalnızca yeni satımları kapsar (denetim izi korunur).
 */
export async function POST() {
  try {
    const result = await resetPnl();
    return NextResponse.json({
      message: "K/Z sıfırlandı. Bu andan sonraki işlemler hesaba katılacak.",
      resetAt: result.resetAt,
    });
  } catch (error: unknown) {
    console.error("[trading/pnl/reset POST] Hata:", error);
    return NextResponse.json(
      { error: "K/Z sıfırlanamadı." },
      { status: 500 },
    );
  }
}
