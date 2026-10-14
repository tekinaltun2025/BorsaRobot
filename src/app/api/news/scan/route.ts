import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { scanNewsForStock, NewsServiceError } from "@/server/services/news-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/news/scan?symbol=XXX
 * Belirtilen hisse için haber taraması çalıştırır (Google News RSS — key'siz),
 * yeni makaleleri kaydeder ve sonucu döndürür.
 *
 * Hata sözleşmesi:
 *  - 400: symbol parametresi eksik.
 *  - 404: hisse bulunamadı.
 *  - 200: tarama tamamlandı (network hatası olsa bile boş sonuçla — crash yok).
 */
export async function POST(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { error: "symbol sorgu parametresi zorunludur (örn. ?symbol=THYAO)." },
      { status: 400 },
    );
  }

  try {
    const result = await scanNewsForStock(symbol);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof NewsServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[news/scan POST] Hata:", error);
    return NextResponse.json(
      { error: "Haber taraması sırasında beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
