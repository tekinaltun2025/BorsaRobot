import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { approveOrder } from "@/server/services/trading-service";
import { TradingError } from "@/server/services/trading-error";

/**
 * POST /api/admin/orders/[id]/approve
 * Onay bekleyen bir emri gerçekleştirir.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    if (!orderId) {
      return NextResponse.json(
        { error: "Emir ID sağlanmadı." },
        { status: 400 }
      );
    }

    const approvedOrder = await approveOrder(orderId);

    return NextResponse.json(approvedOrder);
  } catch (error: unknown) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus }
      );
    }

    console.error("Onaylama hatası:", error);
    return NextResponse.json(
      { error: "Emir onaylanırken beklenmedik bir hata oluştu." },
      { status: 500 }
    );
  }
}
