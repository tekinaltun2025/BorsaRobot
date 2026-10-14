import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decisionListQuerySchema } from "@/lib/validators/ai-decisions";
import {
  listDecisions,
  AiDecisionServiceError,
} from "@/server/services/ai-decision-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai-decisions — AI karar akışı (en yeniden eskiye).
 * Sorgu: ?limit=20&symbol=THYAO&action=BUY&cursor=<son kayıt id>
 *
 * Sözleşme:
 *  - 422: geçersiz sorgu parametreleri (Zod flatten detaylı).
 *  - 200: { decisions, hasMore, nextCursor, total }.
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = decisionListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Geçersiz sorgu parametreleri.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  try {
    const result = await listDecisions({
      limit: parsed.data.limit,
      symbol: parsed.data.symbol,
      action: parsed.data.action,
      cursor: parsed.data.cursor,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AiDecisionServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[ai-decisions GET] Hata:", error);
    return NextResponse.json(
      { error: "AI kararları yüklenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
