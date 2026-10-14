import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  addToWatchlistSchema,
  removeFromWatchlistSchema,
} from "@/lib/validators/watchlist";
import {
  listWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  WatchlistError,
} from "@/server/services/watchlist-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/watchlist — izleme listesi (fiyat görünümüyle).
 *
 * Yanıt: WatchlistPriceView[] — /api/market/prices ile aynı sözleşme
 * (tek kaynak: price-service.getWatchlistPrices).
 */
export async function GET() {
  try {
    const items = await listWatchlist();
    return NextResponse.json({ items });
  } catch (error: unknown) {
    console.error("[watchlist GET] Hata:", error);
    return NextResponse.json(
      { error: "İzleme listesi yüklenemedi." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/watchlist — izleme listesine hisse ekle.
 *
 * Gövde: { symbol, name?, sector? } (Zod doğrulamalı).
 * Stock kaydı yoksa oluşturulur; zaten listedeyse idempotent döner.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = addToWatchlistSchema.safeParse(body);
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
    const item = await addToWatchlist(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof WatchlistError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[watchlist POST] Hata:", error);
    return NextResponse.json(
      { error: "Hisse izleme listesine eklenemedi." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/watchlist — izleme listesinden hisse çıkar.
 *
 * Gövde: { symbol }. Yalnızca Watchlist kaydı silinir; Stock kaydı ve
 * emir/portföy geçmişi korunur. Listede olmayan sembol idempotent'tir.
 */
export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = removeFromWatchlistSchema.safeParse(body);
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
    await removeFromWatchlist(parsed.data.symbol);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof WatchlistError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error("[watchlist DELETE] Hata:", error);
    return NextResponse.json(
      { error: "Hisse izleme listesinden çıkarılamadı." },
      { status: 500 },
    );
  }
}
