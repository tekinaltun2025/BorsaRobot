import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveLlmProvider } from "@/server/providers/llm-provider-factory";
import { LlmConfigError } from "@/server/providers/llm-provider";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/test-ai
 * Aktif AI sağlayıcının bağlantısını test eder — basit ping promptu ile
 * sağlayıcının gerçekten çalıştığını doğrular (admin paneli "Test Et").
 *
 * Hata sözleşmesi:
 *  - 400: API key tanımlı değil (yönlendirici TR mesaj).
 *  - 200: { ok, message } — test sonucu (başarısızsa da 200 + ok=false;
 *    bağlantı testi "çalıştı ve sonucu ölçtü" anlamına gelir).
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "admin-test-ai");
  if (guard) return guard;

  try {
    const provider = await resolveLlmProvider();
    const result = await provider.testConnection();
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof LlmConfigError) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 400 },
      );
    }
    console.error("[admin/test-ai POST] Hata:", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Bağlantı testi sırasında beklenmeyen bir hata oluştu.",
      },
      { status: 500 },
    );
  }
}
