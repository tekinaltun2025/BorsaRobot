import { NextResponse } from "next/server";
import {
  Bist100SyncError,
  getBist100SyncStatus,
  syncBist100ToWatchlist,
} from "@/server/services/bist100-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/watchlist/sync-bist100 — BIST 100 senkron durumunu döndürür.
 *
 * Yanıt: Bist100SyncStatus — çalışıyor mu, son senkron zamanı, çekilen/yeni
 * eklenen bileşen sayıları ve son hata (varsa).
 */
export async function GET() {
  try {
    const status = await getBist100SyncStatus();
    return NextResponse.json(status);
  } catch (error: unknown) {
    console.error("[watchlist/sync-bist100 GET] Hata:", error);
    return NextResponse.json(
      { error: "BIST 100 senkron durumu okunamadı." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/watchlist/sync-bist100 — BIST 100 listesini İş Yatırım
 * kaynağından ÇEKİP izleme listesiyle senkronize eder (manuel tetikleme).
 *
 * Kurallar:
 *  - Kaynaktan gelen bileşenler Stock + Watchlist'e eklenir (source=BIST100).
 *  - Endeksten çıkan yalnızca BIST100 kaynaklı kayıtlar listeden düşer;
 *    kullanıcı elle eklediği (MANUAL) kayıtlar korunur.
 *  - Senkron zaten çalışıyorsa 409 döner (çakışma koruması).
 */
export async function POST() {
  try {
    const result = await syncBist100ToWatchlist();
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof Bist100SyncError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[watchlist/sync-bist100 POST] Hata:", error);
    return NextResponse.json(
      { error: "BIST 100 senkronu tetiklenemedi." },
      { status: 500 },
    );
  }
}
