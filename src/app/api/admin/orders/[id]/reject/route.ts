import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRequest } from "@/lib/api-guard";
import { rejectOrder } from "@/server/services/trading-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/[id]/reject
 * Bekleyen emri reddeder.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  const { id } = await params;

  try {
    const { reason } = await request.json();
    const order = await rejectOrder(id, reason);
    return NextResponse.json(order);
  } catch (error: unknown) {
    console.error("[admin/orders/reject POST] Hata:", error);
    const message = error instanceof Error ? error.message : "Emir reddedilemedi.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
