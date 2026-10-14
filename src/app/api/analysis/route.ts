import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  analyzeStock,
  listAnalysesForStock,
  AnalysisServiceError,
} from "@/server/services/analysis-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/analysis?symbol=XXX&page=1&pageSize=10
 * Sembolün analiz geçmişi — yeniden eskiye, sayfalı.
 */
export async function GET(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

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
    const result = await listAnalysesForStock(symbol, page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AnalysisServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[analysis GET] Hata:", error);
    return NextResponse.json(
      { error: "Analiz geçmişi yüklenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/analysis?symbol=XXX
 * Sembol için yeni analiz tetikler (LLM çağrısı).
 *
 * Hata sözleşmesi:
 *  - 400: symbol eksik veya API key tanımlı değil (yönlendirici TR mesaj).
 *  - 404: hisse bulunamadı.
 *  - 429: cooldown ihlali (aynı sembol için minimum analiz aralığı).
 *  - 502: sağlayıcı hatası / parse hatası. 504: LLM timeout.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "ai-analysis");
  if (guard) return guard;

  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { error: "symbol sorgu parametresi zorunludur (örn. ?symbol=THYAO)." },
      { status: 400 },
    );
  }

  try {
    const analysis = await analyzeStock(symbol);
    return NextResponse.json(analysis);
  } catch (error: unknown) {
    if (error instanceof AnalysisServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[analysis POST] Hata:", error);
    return NextResponse.json(
      { error: "Analiz sırasında beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
