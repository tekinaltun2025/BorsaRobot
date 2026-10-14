import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  placeOrderSchema,
  orderHistoryQuerySchema,
} from "@/lib/validators/trading";
import {
  placeOrder,
  listOrders,
  TradingError,
} from "@/server/services/trading-service";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/trading/order — emir ver (BUY/SELL).
 *
 * Sözleşme:
 *  - Gövde: { side, symbol, quantity, clientRequestId } (Zod doğrulamalı).
 *  - Idempotent: aynı clientRequestId ile tekrar → 200 + idempotentReplay:true
 *    + mevcut emir (yeni işlem ÜRETİLMEZ).
 *  - REJECTED emirler 200 döner (emir kaydı tutarlı biçimde reddedilmiştir);
 *    hata sınıfları (doğrulama/risk/bulunamadı) 4xx döner.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "trading-write");
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

  const parsed = placeOrderSchema.safeParse(body);
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
    const result = await placeOrder(parsed.data);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[trading/order POST] Hata:", error);
    return NextResponse.json(
      { error: "Emir işlenirken beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}

/**
 * GET /api/trading/order — emir geçmişi (sayfalı).
 * Sorgu: ?page=1&pageSize=20&side=BUY&status=FILLED
 */
export async function GET(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = orderHistoryQuerySchema.safeParse(params);
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
    const result = await listOrders(parsed.data);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[trading/order GET] Hata:", error);
    return NextResponse.json(
      { error: "Emir geçmişi yüklenemedi." },
      { status: 500 },
    );
  }
}
