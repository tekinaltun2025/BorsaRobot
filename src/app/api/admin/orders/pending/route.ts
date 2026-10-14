import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orders/pending
 * Bekleyen (PENDING_APPROVAL) emirleri listeler.
 */
export async function GET(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  try {
    const orders = await prisma.order.findMany({
      where: {
        status: "PENDING_APPROVAL",
      },
      include: { stock: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(orders);
  } catch (error: unknown) {
    console.error("[admin/orders/pending GET] Hata:", error);
    return NextResponse.json(
      { error: "Bekleyen emirler yüklenemedi." },
      { status: 500 }
    );
  }
}
