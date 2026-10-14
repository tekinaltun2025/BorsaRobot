import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * K/Z (kâr/zarar) analitiği servisi — gerçekleşmiş K/Z zaman serisi,
 * hisse başına kırılım ve sıfırlama.
 *
 * Veri kaynağı: SELL + FILLED + STOCK emirlerinin Order.realizedPnl alanı
 * (komisyon dahil net TL). Emirler ASLA silinmez; sıfırlama, PnlReset
 * singleton damgası üzerinden çalışır — resetAt'ten SONRA gerçekleşen
 * emirler hesaba katılır, öncesi grafiklerden ve toplamlardan düşer
 * (denetim izi Order tablosunda korunur).
 *
 * Tüm parasal hesaplar Prisma Decimal ile yapılır (ADR-8); Number'a çevrim
 * yalnızca grafik/API görünümünde yapılır.
 */

/** Tek gerçekleşmiş satım emrinin API görünümü (zaman serisi noktası). */
export interface PnlEventView {
  orderId: string;
  symbol: string;
  /** Net gerçekleşmiş K/Z (komisyon dahil, TL). */
  realizedPnl: string;
  /** Gerçekleşen toplam tutar (TL). */
  filledValue: string | null;
  quantity: string;
  commission: string | null;
  /** Emir zamanı (ISO). */
  at: string;
}

/** Günlük K/Z noktası — grafik histogram + kümülatif çizgi verisi. */
export interface PnlDailyPoint {
  /** UTC gün başlangıcı (saniye) — Lightweight Charts UTCTimestamp. */
  time: number;
  /** Gün (YYYY-MM-DD, UTC). */
  date: string;
  /** Günün net K/Z (TL). */
  pnl: number;
  /** Başlangıçtan bu güne kümülatif K/Z (TL). */
  cumulative: number;
  /** Gün içindeki satım işlemi sayısı. */
  count: number;
}

/** Hisse başına gerçekleşmiş K/Z kırılımı. */
export interface PnlBySymbol {
  symbol: string;
  /** Net gerçekleşmiş K/Z (TL). */
  realizedPnl: string;
  tradeCount: number;
  /** Son satım zamanı (ISO). */
  lastTradeAt: string;
}

/** K/Z analitiği görünümü — GET /api/trading/pnl yanıtı. */
export interface PnlOverview {
  /** Son sıfırlama zamanı (ISO) — sıfırlama yapılmadıysa null. */
  resetAt: string | null;
  /** Toplam net gerçekleşmiş K/Z (TL). */
  totalRealizedPnl: string;
  /** Pozitif işlemlerin toplamı (TL). */
  totalProfit: string;
  /** Negatif işlemlerin toplamı (TL, negatif değer). */
  totalLoss: string;
  /** Hesaba katılan satım işlemi sayısı. */
  tradeCount: number;
  /** Zaman sıralı işlem listesi. */
  events: PnlEventView[];
  /** Günlük bucket'lı grafik verisi (kümülatif dahil). */
  daily: PnlDailyPoint[];
  /** Hisse başına kırılım (K/Z'ye göre azalan). */
  bySymbol: PnlBySymbol[];
}

const ZERO = new Prisma.Decimal(0);

/**
 * Son K/Z sıfırlama zamanını okur. Kayıt yoksa null döner — tüm emirler
 * hesaba katılır (sıfırlama hiç yapılmamış başlangıç durumu).
 */
export async function getPnlResetAt(): Promise<Date | null> {
  const reset = await prisma.pnlReset.findUnique({
    where: { id: "singleton" },
  });
  return reset?.resetAt ?? null;
}

/** UTC gün anahtarı (YYYY-MM-DD) üretir. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * K/Z analitiğini hesaplar: son sıfırlamadan sonraki tüm gerçekleşmiş
 * hisse satımları; günlük bucket + kümülatif eğri + hisse kırılımı.
 */
export async function getPnlOverview(): Promise<PnlOverview> {
  const resetAt = await getPnlResetAt();

  const orders = await prisma.order.findMany({
    where: {
      side: "SELL",
      status: "FILLED",
      assetType: "STOCK",
      ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      symbol: true,
      realizedPnl: true,
      filledValue: true,
      quantity: true,
      commission: true,
      createdAt: true,
    },
  });

  // --- İşlem listesi + toplamlar (Decimal).
  const events: PnlEventView[] = [];
  let totalRealized = ZERO;
  let totalProfit = ZERO;
  let totalLoss = ZERO;

  for (const order of orders) {
    const pnl = order.realizedPnl ?? ZERO;
    totalRealized = totalRealized.add(pnl);
    if (pnl.greaterThanOrEqualTo(0)) {
      totalProfit = totalProfit.add(pnl);
    } else {
      totalLoss = totalLoss.add(pnl);
    }
    events.push({
      orderId: order.id,
      symbol: order.symbol,
      realizedPnl: pnl.toString(),
      filledValue: order.filledValue ? order.filledValue.toString() : null,
      quantity: order.quantity.toString(),
      commission: order.commission ? order.commission.toString() : null,
      at: order.createdAt.toISOString(),
    });
  }

  // --- Günlük bucket: aynı UTC günündeki emirler tek noktada toplanır
  // (Lightweight Charts aynı time'da birden fazla nokta kabul etmez).
  const dailyMap = new Map<
    string,
    { time: number; pnl: Prisma.Decimal; count: number }
  >();
  for (const order of orders) {
    const dayKey = utcDayKey(order.createdAt);
    const pnl = order.realizedPnl ?? ZERO;
    const existing = dailyMap.get(dayKey);
    if (existing) {
      existing.pnl = existing.pnl.add(pnl);
      existing.count += 1;
    } else {
      const dayStart = Date.parse(`${dayKey}T00:00:00.000Z`) / 1000;
      dailyMap.set(dayKey, { time: dayStart, pnl, count: 1 });
    }
  }

  // --- Kümülatif eğri: gün sıralı running total.
  const daily: PnlDailyPoint[] = [];
  let cumulative = ZERO;
  for (const dayKey of Array.from(dailyMap.keys()).sort()) {
    const bucket = dailyMap.get(dayKey);
    if (!bucket) continue;
    cumulative = cumulative.add(bucket.pnl);
    daily.push({
      time: bucket.time,
      date: dayKey,
      pnl: Number(bucket.pnl.toFixed(2)),
      cumulative: Number(cumulative.toFixed(2)),
      count: bucket.count,
    });
  }

  // --- Hisse başına kırılım.
  const symbolMap = new Map<
    string,
    { pnl: Prisma.Decimal; count: number; lastAt: Date }
  >();
  for (const order of orders) {
    const pnl = order.realizedPnl ?? ZERO;
    const existing = symbolMap.get(order.symbol);
    if (existing) {
      existing.pnl = existing.pnl.add(pnl);
      existing.count += 1;
      if (order.createdAt > existing.lastAt) existing.lastAt = order.createdAt;
    } else {
      symbolMap.set(order.symbol, {
        pnl,
        count: 1,
        lastAt: order.createdAt,
      });
    }
  }
  const bySymbol: PnlBySymbol[] = Array.from(symbolMap.entries())
    .map(([symbol, agg]) => ({
      symbol,
      realizedPnl: agg.pnl.toString(),
      tradeCount: agg.count,
      lastTradeAt: agg.lastAt.toISOString(),
    }))
    .sort((a, b) => Number(b.realizedPnl) - Number(a.realizedPnl));

  return {
    resetAt: resetAt ? resetAt.toISOString() : null,
    totalRealizedPnl: totalRealized.toString(),
    totalProfit: totalProfit.toString(),
    totalLoss: totalLoss.toString(),
    tradeCount: events.length,
    events,
    daily,
    bySymbol,
  };
}

/**
 * K/Z'yi sıfırlar: PnlReset damgasını şimdiye çeker. Emirler silinmez;
 * bu andan sonraki hesaplamalar yalnızca yeni satımları kapsar.
 * Idempotent değildir — her çağrı damgayı ilerletir (bilinçli davranış).
 */
export async function resetPnl(): Promise<{ resetAt: string }> {
  const now = new Date();
  await prisma.pnlReset.upsert({
    where: { id: "singleton" },
    update: { resetAt: now },
    create: { id: "singleton", resetAt: now },
  });
  return { resetAt: now.toISOString() };
}
