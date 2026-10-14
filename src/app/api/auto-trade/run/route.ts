import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runAutoTradeCycle } from "@/server/services/auto-trade-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/auto-trade/run
 * Bir tam otomatik döngüyü manuel tetikler (admin/test amaçlı).
 *
 * Scheduler'dan bağımsız çalışır: autoTradingEnabled=false olsa bile
 * manuel tetikleme GEÇERLİDİR (admin "Şimdi Çalıştır" butonunun anlamı
 * budur); motor içindeki guard'lar (PAPER modu, risk kuralları) yine
 * tam uygulanır. Döngü sonucu (kontroller, analizler, emirler, hatalar)
 * JSON olarak döner.
 *
 * İsteğe bağlı gövde: { "cycleId": "..." } — aynı cycleId ile tekrar
 * çağrı idempotent'tir (aynı clientRequestId'lere takılır, yeni emir
 * üretilmez).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = guardRequest(request, "auto-trade-run");
  if (guard) return guard;

  let cycleId: string | undefined;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (
      typeof body === "object" &&
      body !== null &&
      "cycleId" in body &&
      typeof (body as { cycleId: unknown }).cycleId === "string" &&
      (body as { cycleId: string }).cycleId.trim().length > 0
    ) {
      cycleId = (body as { cycleId: string }).cycleId.trim();
    }
  } catch {
    // Gövde opsiyoneldir — parse hatası cycleId'siz devam eder.
  }

  try {
    const result = await runAutoTradeCycle({ cycleId });
    return NextResponse.json(result);
  } catch (error: unknown) {
    // runAutoTradeCycle normalde asla fırlatmaz; bu katman son savunmadır.
    console.error("[auto-trade/run POST] Hata:", error);
    return NextResponse.json(
      { error: "Otomatik döngü çalıştırılamadı." },
      { status: 500 },
    );
  }
}
