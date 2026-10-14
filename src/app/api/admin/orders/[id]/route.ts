import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardRequest } from "@/lib/api-guard";
import { approveOrder, rejectOrder } from "@/server/services/trading-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/[id]/approve
 * Bekleyen emri onaylar ve gerçekleştirir.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  const { id } = await params;

  try {
    const order = await approveOrder(id);
    return NextResponse.json(order);
  } catch (error: unknown) {
    console.error("[admin/orders/approve POST] Hata:", error);
    const message = error instanceof Error ? error.message : "Emir onaylanamadı.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/orders/[id]/reject
 * Bekleyen emri reddeder.
 */
export async function PATCH(
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
    console.error("[admin/orders/reject PATCH] Hata:", error);
    const message = error instanceof Error ? error.message : "Emir reddedilemedi.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
