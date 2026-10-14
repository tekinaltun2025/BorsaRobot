import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendPriceHistory, updateLastPrice } from "@/server/services/price-service";

/**
 * Piyasa simülatörü — Faz 3 fiyat üretim motoru.
 *
 * Gerçek borsa API'si bu fazda YOK (Faz 6'da değerlendirilecek); bu modül
 * izleme listesindeki hisseler için gerçekçi fiyat hareketi üretir:
 *
 *  - Random walk: son fiyattan hafif rastgele yürüyüş (geometrik Brownian
 *    hareketi basitleştirilmiş hali): next = last × (1 + drift + σ·N(0,1)).
 *  - Volatilite: tick başına ±%0,5 civarı (günlük ~%1-2 BIST gerçekliğine
 *    yakın ölçek; 5 sn'lik tick'te makul görünür hareket).
 *  - Deterministik mod: opsiyonel seed parametresi ile mulberry32 PRNG —
 *    aynı seed aynı fiyat serisini üretir (test edilebilirlik).
 *  - Her tick'te: Stock.lastPrice güncellenir + PriceHistory kaydı eklenir
 *    (open = önceki kapanış, high/low = tick aralığı, close = yeni fiyat).
 *
 * Mimari not: Bu modül servis katmanındadır ve yalnızca price-service'in
 * yazma portlarını kullanır (Bölüm 3.2 bağımlılık kuralı). İleride gerçek
 * sağlayıcı (IStockPriceProvider) devreye girdiğinde tick üretimi değişir,
 * PriceHistory yazma sözleşmesi aynı kalır.
 */

/** Tick başına taban volatilite (standart sapma kesri). */
const BASE_VOLATILITY = 0.005;

/** Hafif yukarı drift — uzun vadede enflasyon benzeri eğilim (opsiyonel). */
const DRIFT = 0.0001;

/** Fiyat alt sınırı — hisse fiyatı 0.01 TL'nin altına inmez. */
const MIN_PRICE = new Prisma.Decimal("0.01");

/** Tick sonucu — API yanıtına serileştirilir. */
export interface TickResult {
  /** İşlenen hisse sayısı. */
  processed: number;
  /** {sembol: yeniFiyat} haritası (string Decimal). */
  prices: Record<string, string>;
  /** Tick anı. */
  tickedAt: Date;
}

/**
 * Mulberry32 — hızlı, deterministik 32-bit PRNG.
 * seed verilirse tüm tick serisi öngörülebilir (test amaçlı).
 */
function createRng(seed?: number): () => number {
  if (seed === undefined) {
    // Üretim: crypto tabanlı tohum.
    let state =
      (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    return function next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller dönüşümü — [0,1) uniform çiftinden standart normal örnek.
 * rng() değerleri [0,1) aralığında; u1=0 log(0) üretmemesi için korunur.
 */
function normalSample(rng: () => number): number {
  let u1 = rng();
  if (u1 === 0) u1 = Number.EPSILON;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Tek hisse için bir tick'lik yeni fiyat üretir.
 *
 * Model: next = last × (1 + drift + volatility × N(0,1))
 * Fiyat 2 ondalığa yuvarlanır (BIST kuruş hassasiyeti).
 */
export function simulateNextPrice(
  lastPrice: Prisma.Decimal,
  rng: () => number,
  volatility: number = BASE_VOLATILITY,
): Prisma.Decimal {
  const shock = normalSample(rng) * volatility + DRIFT;
  const multiplier = new Prisma.Decimal(1 + shock);
  const next = lastPrice.mul(multiplier);
  const rounded = next.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return rounded.lessThan(MIN_PRICE) ? MIN_PRICE : rounded;
}

/**
 * Bir tick çalıştırır: izleme listesindeki TÜM aktif hisseler için yeni
 * fiyat üretir, Stock.lastPrice günceller ve PriceHistory kaydı ekler.
 *
 * @param options.seed   Deterministik PRNG tohumu (test).
 * @param options.symbols Belirli sembollerle sınırla (test); verilmezse
 *                       izleme listesinin tamamı işlenir.
 * @param options.timestamp Kayıt zamanı (test); verilmezse şimdi.
 */
export async function runMarketTick(options?: {
  seed?: number;
  symbols?: string[];
  timestamp?: Date;
}): Promise<TickResult> {
  const rng = createRng(options?.seed);
  const timestamp = options?.timestamp ?? new Date();

  // İşlenecek hisseler: izleme listesindekiler (opsiyonel sembol filtresiyle).
  const watchlist = await prisma.watchlist.findMany({
    include: { stock: true },
    orderBy: { createdAt: "asc" },
  });

  const targets = watchlist.filter((w) => {
    if (!w.stock.isActive) return false;
    if (options?.symbols && options.symbols.length > 0) {
      return options.symbols.includes(w.stock.symbol);
    }
    return true;
  });

  const prices: Record<string, string> = {};

  for (const entry of targets) {
    const stock = entry.stock;
    // Fiyatı olmayan hisse atlanır (seed edilmemiş/manuel eklenmiş olabilir).
    if (stock.lastPrice === null) continue;

    const last = stock.lastPrice;
    const next = simulateNextPrice(last, rng);

    // Tick aralığı mumu: open = önceki kapanış, close = yeni fiyat.
    const open = last;
    const high = Prisma.Decimal.max(open, next);
    const low = Prisma.Decimal.min(open, next);

    await appendPriceHistory({
      stockId: stock.id,
      timestamp,
      open,
      high,
      low,
      close: next,
    });
    await updateLastPrice(stock.id, next);

    prices[stock.symbol] = next.toString();
  }

  return {
    processed: Object.keys(prices).length,
    prices,
    tickedAt: timestamp,
  };
}
