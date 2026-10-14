import { prisma } from "@/lib/prisma";
import type { WatchlistPriceView } from "@/lib/types";
import { getWatchlistPrices } from "@/server/services/price-service";

/**
 * İzleme listesi servisi — Watchlist kayıtlarının iş kuralı sahibi
 * (Bölüm 3.1 StockService'in izleme listesi yarısı).
 *
 * Mimari kural (Bölüm 3.2): app katmanı doğrudan Prisma'ya dokunmaz;
 * tüm Watchlist işlemleri bu servisten geçer.
 *
 * Kurallar:
 *  - Ekleme: sembol BIST formatında (3-5 harf) olmalı; Stock kaydı yoksa
 *    otomatik oluşturulur (name = sembol, sektör bilinmiyor); zaten listede
 *    ise hata değil, mevcut kayıt döner (idempotent).
 *  - Çıkarma: Watchlist kaydı silinir; Stock kaydı korunur (emir/portföy
 *    geçmişi bozulmaz).
 */

/** Kullanıcıya dönük, bilinen iş kuralı ihlali — API katmanı 4xx'e map eder. */
export class WatchlistError extends Error {
  constructor(
    message: string,
    readonly code: "VALIDATION" | "NOT_FOUND" | "DUPLICATE",
    readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "WatchlistError";
  }
}

/** İzleme listesi öğesi görünümü. */
export interface WatchlistItemView {
  watchlistId: string;
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  lastPrice: string | null;
  autoAnalyze: boolean;
  addedAt: string;
}

/** İzleme listesini (fiyat görünümüyle) listeler — GET /api/watchlist. */
export async function listWatchlist(): Promise<WatchlistPriceView[]> {
  return getWatchlistPrices();
}

/**
 * İzleme listesine hisse ekler — POST /api/watchlist.
 *
 * Stock kaydı yoksa oluşturulur (lastPrice null — simülatör ilk tick'te
 * fiyat yazana kadar emir verilemez; UI bunu "fiyat bekleniyor" olarak
 * gösterir). Zaten listede olan sembol idempotent biçimde döner.
 */
export async function addToWatchlist(input: {
  symbol: string;
  name?: string;
  sector?: string;
}): Promise<WatchlistItemView> {
  const symbol = input.symbol.toUpperCase();

  const stock = await prisma.stock.upsert({
    where: { symbol },
    update: {
      // Kullanıcı ad/sektör verdiyse zenginleştir; vermediyse dokunma.
      ...(input.name ? { name: input.name } : {}),
      ...(input.sector ? { sector: input.sector } : {}),
    },
    create: {
      symbol,
      name: input.name ?? symbol,
      sector: input.sector ?? null,
      isActive: true,
    },
  });

  const existing = await prisma.watchlist.findUnique({
    where: { stockId: stock.id },
  });

  const entry =
    existing ??
    (await prisma.watchlist.create({
      data: { stockId: stock.id, autoAnalyze: true },
    }));

  return {
    watchlistId: entry.id,
    stockId: stock.id,
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    lastPrice: stock.lastPrice ? stock.lastPrice.toString() : null,
    autoAnalyze: entry.autoAnalyze,
    addedAt: entry.createdAt.toISOString(),
  };
}

/**
 * İzleme listesinden hisse çıkarır — DELETE /api/watchlist.
 *
 * Yalnızca Watchlist kaydı silinir; Stock kaydı ve onun emir/portföy
 * geçmişi korunur (Bölüm 3.2 veri bütünlüğü).
 */
export async function removeFromWatchlist(symbol: string): Promise<void> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new WatchlistError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const existing = await prisma.watchlist.findUnique({
    where: { stockId: stock.id },
  });
  if (!existing) {
    // İdempotent: listede olmayan sembolu çıkarmak hata değil.
    return;
  }

  await prisma.watchlist.delete({ where: { stockId: stock.id } });
}

/** Sembolün izleme listesinde olup olmadığını döner. */
export async function isInWatchlist(symbol: string): Promise<boolean> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true },
  });
  if (!stock) return false;
  const entry = await prisma.watchlist.findUnique({
    where: { stockId: stock.id },
    select: { id: true },
  });
  return entry !== null;
}
