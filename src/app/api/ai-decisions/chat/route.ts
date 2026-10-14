import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { chatHistoryQuerySchema } from "@/lib/validators/ai-decisions";
import {
  listChatMessages,
  AiDecisionServiceError,
} from "@/server/services/ai-decision-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai-decisions/chat?limit=100 — sohbet geçmişi (en yeniden eskiye).
 * Sayfa yenilendiğinde sohbet kaybolmasın diye kalıcı tablodan okunur.
 */
export async function GET(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = chatHistoryQuerySchema.safeParse(params);
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
    const messages = await listChatMessages(parsed.data.limit);
    return NextResponse.json({ messages });
  } catch (error: unknown) {
    if (error instanceof AiDecisionServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus },
      );
    }
    console.error("[ai-decisions/chat GET] Hata:", error);
    return NextResponse.json(
      { error: "Sohbet geçmişi yüklenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
