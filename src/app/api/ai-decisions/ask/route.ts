import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { askDecisionSchema } from "@/lib/validators/ai-decisions";
import {
  askDecisionQuestion,
  AiDecisionServiceError,
} from "@/server/services/ai-decision-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai-decisions/ask — kullanıcı sorusunu AI kararları bağlamında
 * yanıtlar; soruyu ve yanıtı AiDecisionChat'e kalıcı yazar.
 *
 * Gövde: { question, decisionContextCount? } (Zod doğrulamalı).
 *
 * Hata sözleşmesi:
 *  - 400: geçersiz JSON gövdesi.
 *  - 422: doğrulama hatası (soru boş/kısa/uzun).
 *  - 400: AI sağlayıcı API key tanımlı değil (MISSING_API_KEY).
 *  - 502: sağlayıcı hatası / boş yanıt. 504: LLM timeout.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "ai-ask");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = askDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Doğrulama hatası.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  try {
    const result = await askDecisionQuestion(
      parsed.data.question,
      parsed.data.decisionContextCount ?? 12,
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AiDecisionServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[ai-decisions/ask POST] Hata:", error);
    return NextResponse.json(
      { error: "Sorunuz işlenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
