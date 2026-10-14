import { NextResponse } from "next/server";
import { yahooFinanceClient } from "@/server/providers/yahoo-finance-client";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/test-yahoo
 * Yahoo Finance bağlantısını test eder — THYAO.IS güncel fiyatı çekilir
 * (admin paneli "Bağlantıyı Test Et" butonu; test-ai deseni).
 *
 * Hata sözleşmesi:
 *  - 200: { ok, message } — test sonucu (başarısızsa da 200 + ok=false;
 *    bağlantı testi "çalıştı ve sonucu ölçtü" anlamına gelir).
 *  - 500: beklenmeyen hata (testConnection kendi hatalarını yakalar;
 *    bu dal pratikte oluşmaz).
 */
export async function POST() {
  try {
    const result = await yahooFinanceClient.testConnection();
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[admin/test-yahoo POST] Hata:", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Bağlantı testi sırasında beklenmeyen bir hata oluştu.",
      },
      { status: 500 },
    );
  }
}
