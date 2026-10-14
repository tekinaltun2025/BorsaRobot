import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { accountHistoryQuerySchema } from "@/lib/validators/trading";
import {
  getAccountSummary,
  listAccountTransactions,
} from "@/server/services/portfolio-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/trading/account — bakiye + işlem geçmişi (sayfalı).
 *
 * Sorgu: ?page=1&pageSize=20
 * Yanıt: { summary: AccountSummaryView, transactions: [...], total, page, pageSize }
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = accountHistoryQuerySchema.safeParse(params);
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
    const [summary, history] = await Promise.all([
      getAccountSummary(),
      listAccountTransactions(parsed.data),
    ]);
    return NextResponse.json({ summary, ...history });
  } catch (error: unknown) {
    console.error("[trading/account GET] Hata:", error);
    const message =
      error instanceof Error ? error.message : "Hesap bilgileri yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
