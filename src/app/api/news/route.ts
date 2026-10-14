import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listNewsForStock, NewsServiceError } from "@/server/services/news-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/news?symbol=XXX&page=1&pageSize=10
 * Hissenin makale listesi — tarih sıralı (yeniden eskiye), sayfalı.
 *
 * Hata sözleşmesi:
 *  - 400: symbol parametresi eksik / sayfalama parametreleri geçersiz.
 *  - 404: hisse bulunamadı.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { error: "symbol sorgu parametresi zorunludur (örn. ?symbol=THYAO)." },
      { status: 400 },
    );
  }

  const pageRaw = params.get("page");
  const pageSizeRaw = params.get("pageSize");
  const page = pageRaw !== null ? Number(pageRaw) : 1;
  const pageSize = pageSizeRaw !== null ? Number(pageSizeRaw) : 10;
  if (!Number.isFinite(page) || page < 1) {
    return NextResponse.json(
      { error: "page parametresi 1'den küçük olamaz." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    return NextResponse.json(
      { error: "pageSize parametresi 1'den küçük olamaz." },
      { status: 400 },
    );
  }

  try {
    const result = await listNewsForStock(symbol, page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof NewsServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[news GET] Hata:", error);
    return NextResponse.json(
      { error: "Haber listesi yüklenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
