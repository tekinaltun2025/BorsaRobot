import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/app-error";
import type {
  ChartCandle,
  HistoryRange,
  StockStats,
  WatchlistPriceView,
} from "@/lib/types";

/**
 * Fiyat servisi — PriceHistory kayıtlarının tek sahibi (Bölüm 3.1 StockService
 * fiyat kayıt sorumluluğunun Faz 3 uygulaması).
 *
 * Sorumluluklar:
 *  - Sembol bazlı, zaman aralıklı PriceHistory sorguları.
 *  - Son fiyat okuma (Stock.lastPrice + PriceHistory'den günlük açılış referansı).
 *  - Fiyat geçmişi ekleme (simülatör ve ilerideki gerçek sağlayıcı için).
 *  - PriceHistory kayıtlarını Lightweight Charts uyumlu {time, open, high, low,
 *    close} mumlarına dönüştürme (close bazlı seriden OHLC üretimi dahil).
 *
 * ADR-8: Parasal hesaplar Prisma Decimal ile yapılır; Number'a çevrim yalnızca
 * grafik görünümünde (lightweight-charts number sözleşmesi) yapılır.
 */

/** Kullanıcıya dönük, bilinen iş kuralı ihlali — API katmanı 4xx'e map eder. */
export class PriceServiceError extends AppError {
  constructor(
    message: string,
    code: "NOT_FOUND" | "VALIDATION",
    httpStatus: number = 400,
  ) {
    super(message, code, httpStatus);
  }
}

/** Dönem → gün cinsinden süre haritası. */
const RANGE_DAYS: Record<HistoryRange, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  "5Y": 1825,
};

/**
 * Grafik sorgusu başına maksimum kayıt (iyileştirme 5.1): 1Y/5Y aralığında
 * binlerce PriceHistory satırının JS'e taşınmasını sınırlar. Kayıtlar
 * bucket'lama sonrası çok daha az muma indirgendiğinden, en yeni N kayıt
 * görsel sadakati korurken bellek/RTT'yi sabitler. En yeni kayıtların
 * korunması için sorgu DESC çekilip ASC'e çevrilir.
 */
const CHART_QUERY_LIMIT = 5_000;

/** Dönem → mum gruplama penceresi (saniye). */
const RANGE_BUCKET_SECONDS: Record<HistoryRange, number> = {
  "1D": 60, // 1 dakikalık mumlar
  "1W": 5 * 60, // 5 dakikalık mumlar
  "1M": 60 * 60, // 1 saatlik mumlar
  "3M": 6 * 60 * 60, // 6 saatlik mumlar
  "1Y": 24 * 60 * 60, // günlük mumlar
  "5Y": 7 * 24 * 60 * 60, // haftalık mumlar
};

/** Dönemin başlangıç zamanını döndürür. */
export function rangeStartDate(range: HistoryRange, now: Date = new Date()): Date {
  return new Date(now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
}

/**
 * Sembolün fiyat geçmişini Lightweight Charts mumlarına dönüştürür.
 *
 * PriceHistory kayıtları zaten OHLC alanlıdır; ancak simülatörün tek-nokta
 * tick'leri (open=high=low=close) mumları düzleştirir. Bu yüzden kayıtlar
 * dönem penceresine göre BUCKETS'a gruplanır: her kovada ilk kayıt open,
 * son kayıt close, en yüksek/en düşük değerler high/low olur. Böylece her
 * range anlamlı mum serisi üretir.
 */
export async function getChartCandles(
  symbol: string,
  range: HistoryRange,
): Promise<ChartCandle[]> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new PriceServiceError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const from = rangeStartDate(range);
  // İyileştirme 5.1: en yeni CHART_QUERY_LIMIT kayıt — DESC çek + ters çevir,
  // böylece eski (bucket dışı kalan) kayıtlar taşınmaz.
  const records = await prisma.priceHistory.findMany({
    where: { stockId: stock.id, timestamp: { gte: from } },
    orderBy: { timestamp: "desc" },
    take: CHART_QUERY_LIMIT,
  });
  records.reverse();

  if (records.length === 0) {
    // Geçmiş yoksa: tek nokta olarak son fiyatı döndür (grafik boş kalmasın).
    if (stock.lastPrice) {
      const price = Number(stock.lastPrice);
      return [
        {
          time: Math.floor(Date.now() / 1000),
          open: price,
          high: price,
          low: price,
          close: price,
        },
      ];
    }
    return [];
  }

  const bucketSeconds = RANGE_BUCKET_SECONDS[range];
  const buckets = new Map<number, { open: number; high: number; low: number; close: number }>();

  for (const record of records) {
    const time = Math.floor(record.timestamp.getTime() / 1000);
    const bucketTime = Math.floor(time / bucketSeconds) * bucketSeconds;
    const open = Number(record.open);
    const high = Number(record.high);
    const low = Number(record.low);
    const close = Number(record.close);

    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { open, high, low, close });
    } else {
      buckets.set(bucketTime, {
        open: existing.open,
        high: Math.max(existing.high, high),
        low: Math.min(existing.low, low),
        close,
      });
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, ohlc]) => ({ time, ...ohlc }));
}

/**
 * Dönem istatistikleri — en yüksek, en düşük ve ortalama kapanış.
 * Grafik altındaki istatistik kartlarını besler.
 */
export async function getStockStats(
  symbol: string,
  range: HistoryRange,
): Promise<StockStats> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new PriceServiceError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const from = rangeStartDate(range);
  const [agg, count] = await Promise.all([
    prisma.priceHistory.aggregate({
      where: { stockId: stock.id, timestamp: { gte: from } },
      _max: { high: true },
      _min: { low: true },
      _avg: { close: true },
    }),
    prisma.priceHistory.count({
      where: { stockId: stock.id, timestamp: { gte: from } },
    }),
  ]);

  return {
    high: agg._max.high ? agg._max.high.toString() : null,
    low: agg._min.low ? agg._min.low.toString() : null,
    average: agg._avg.close ? agg._avg.close.toString() : null,
    sampleCount: count,
  };
}

/**
 * İzleme listesindeki hisselerin son fiyat görünümü — GET /api/market/prices.
 *
 * Günlük değişim referansı: günün ilk PriceHistory kaydı (dayOpen). Kayıt
 * yoksa (simülatör henüz çalışmamışsa) değişim alanları null döner; UI "—"
 * gösterir. Tek sorguda tüm izleme listesi çözülür (N+1 yok).
 */
export async function getWatchlistPrices(): Promise<WatchlistPriceView[]> {
  const watchlist = await prisma.watchlist.findMany({
    include: { stock: true },
    orderBy: { createdAt: "asc" },
  });

  if (watchlist.length === 0) return [];

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const dayOpens = await prisma.priceHistory.findMany({
    where: {
      stockId: { in: watchlist.map((w) => w.stockId) },
      timestamp: { gte: dayStart },
    },
    orderBy: { timestamp: "asc" },
    distinct: ["stockId"],
    select: { stockId: true, open: true },
  });

  const dayOpenByStock = new Map<string, Prisma.Decimal>(
    dayOpens.map((d) => [d.stockId, d.open]),
  );

  return watchlist.map((w) => {
    const lastPrice = w.stock.lastPrice;
    const dayOpen = dayOpenByStock.get(w.stockId) ?? null;
    const change =
      lastPrice !== null && dayOpen !== null ? lastPrice.sub(dayOpen) : null;
    const changePercent =
      change !== null && dayOpen !== null && dayOpen.greaterThan(0)
        ? change.div(dayOpen).mul(100)
        : null;

    return {
      stockId: w.stockId,
      symbol: w.stock.symbol,
      name: w.stock.name,
      source: w.source === "BIST100" ? "BIST100" : "MANUAL",
      lastPrice: lastPrice ? lastPrice.toString() : null,
      dayOpen: dayOpen ? dayOpen.toString() : null,
      change: change ? change.toFixed(4) : null,
      changePercent: changePercent ? changePercent.toFixed(4) : null,
      updatedAt: w.stock.updatedAt.toISOString(),
    };
  });
}

/**
 * Tek hissenin günlük özet görünümü — /stock/[symbol] başlığı.
 * Değişim referansı günün ilk kaydı; gün içi en yüksek/en düşük son 24 saatten.
 */
export async function getStockDailySummary(
  symbol: string,
): Promise<{
  lastPrice: string | null;
  change: string | null;
  changePercent: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  updatedAt: string | null;
}> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new PriceServiceError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [firstToday, dayAgg] = await Promise.all([
    prisma.priceHistory.findFirst({
      where: { stockId: stock.id, timestamp: { gte: dayStart } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.priceHistory.aggregate({
      where: { stockId: stock.id, timestamp: { gte: dayStart } },
      _max: { high: true },
      _min: { low: true },
    }),
  ]);

  const lastPrice = stock.lastPrice;
  const dayOpen = firstToday?.open ?? null;
  const change =
    lastPrice !== null && dayOpen !== null ? lastPrice.sub(dayOpen) : null;
  const changePercent =
    change !== null && dayOpen !== null && dayOpen.greaterThan(0)
      ? change.div(dayOpen).mul(100)
      : null;

  return {
    lastPrice: lastPrice ? lastPrice.toString() : null,
    change: change ? change.toFixed(4) : null,
    changePercent: changePercent ? changePercent.toFixed(4) : null,
    dayHigh: dayAgg._max.high ? dayAgg._max.high.toString() : null,
    dayLow: dayAgg._min.low ? dayAgg._min.low.toString() : null,
    updatedAt: stock.updatedAt.toISOString(),
  };
}

/**
 * Fiyat geçmişi ekler — simülatör ve ilerideki gerçek sağlayıcının yazma portu.
 *
 * Aynı saniyede birden fazla kayıt gelirse (paralel tick) en sonuncu kazanır;
 * çağıran taraf timestamp'i monoton artırmakla sorumludur.
 */
export async function appendPriceHistory(input: {
  stockId: string;
  timestamp: Date;
  open: Prisma.Decimal;
  high: Prisma.Decimal;
  low: Prisma.Decimal;
  close: Prisma.Decimal;
  volume?: Prisma.Decimal | null;
}): Promise<void> {
  await prisma.priceHistory.create({
    data: {
      stockId: input.stockId,
      timestamp: input.timestamp,
      open: input.open,
      high: input.high,
      low: input.low,
      close: input.close,
      volume: input.volume ?? null,
    },
  });
}

/**
 * Son fiyatı günceller — simülatörün Stock.lastPrice yazma portu.
 * updatedAt @updatedAt ile otomatik yenilenir.
 */
export async function updateLastPrice(
  stockId: string,
  price: Prisma.Decimal,
): Promise<void> {
  await prisma.stock.update({
    where: { id: stockId },
    data: { lastPrice: price },
  });
}
