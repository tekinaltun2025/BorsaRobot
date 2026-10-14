import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  ChartCandle,
  HistoryRange,
  PriceSourceKind,
  PriceSourceStatus,
} from "@/lib/types";
import {
  appendPriceHistory,
  getChartCandles,
  updateLastPrice,
} from "@/server/services/price-service";
import { getOrCreateAdminSettings } from "@/server/services/settings-service";
import {
  yahooFinanceClient,
  toYahooSymbol,
  type YahooCandle,
  type YahooQuote,
  type YahooFinanceClient,
} from "@/server/providers/yahoo-finance-client";

/**
 * Fiyat kaynağı soyutlaması — Strategy Pattern (Bölüm 3.1 fiyat katmanı).
 *
 * İki somut strateji:
 *  - YahooFinancePriceSource: gerçek BIST fiyatları (Yahoo Finance v8/v7).
 *  - SimulatedPriceSource: yedek simülatör — mevcut market-simulator.ts
 *    mantığını sarmalar (simülatör kodu KORUNUR; bu modül yalnızca portlar).
 *
 * Kaynak seçimi: AdminSettings.priceSource önceliklidir; ayar okunamazsa
 * PRICE_SOURCE env değişkenine, o da yoksa "YAHOO"ya düşülür.
 *
 * Fallback kuralı: YAHOO seçiliyken Yahoo çağrısı başarısız olursa otomatik
 * olarak SIMULATED'a düşülür; durum PriceSourceStatus ile UI'a taşınır
 * (fallbackUsed + fallbackReason → "simüle veri" bilgi rozeti).
 */

/** Fiyat kaynağı sözleşmesi — her iki strateji de bunu uygular. */
export interface IPriceSource {
  /** Strateji kimliği — AdminSettings.priceSource ile eşleşir. */
  readonly kind: PriceSourceKind;
  /** Sembollerin güncel fiyatları (YahooQuote görünümü — ortak sözleşme). */
  fetchQuotes(symbols: string[]): Promise<YahooQuote[]>;
  /** Sembolün OHLC fiyat geçmişi (YahooCandle görünümü — ortak sözleşme). */
  fetchHistory(symbol: string, range: HistoryRange): Promise<YahooCandle[]>;
}

/**
 * Gerçek fiyat kaynağı — Yahoo Finance istemcisini IPriceSource'a uyarlar.
 */
export class YahooFinancePriceSource implements IPriceSource {
  readonly kind: PriceSourceKind = "YAHOO";

  async fetchQuotes(symbols: string[]): Promise<YahooQuote[]> {
    return yahooFinanceClient.fetchQuotes(symbols);
  }

  async fetchHistory(symbol: string, range: HistoryRange): Promise<YahooCandle[]> {
    return yahooFinanceClient.fetchHistory(symbol, range);
  }
}

/**
 * Yedek fiyat kaynağı — mevcut simülatör verisini IPriceSource'a uyarlar.
 *
 *  - fetchQuotes: Stock.lastPrice'tan (DB) son bilinen fiyatlar okunur.
 *  - fetchHistory: PriceHistory kayıtlarından (DB) OHLC mumları üretilir
 *    (price-service getChartCandles — simülatörün yazdığı veri).
 */
export class SimulatedPriceSource implements IPriceSource {
  readonly kind: PriceSourceKind = "SIMULATED";

  async fetchQuotes(symbols: string[]): Promise<YahooQuote[]> {
    const upper = symbols.map((s) => s.trim().toUpperCase());
    const stocks = await prisma.stock.findMany({
      where: { symbol: { in: upper } },
    });

    return stocks
      .filter((stock) => stock.lastPrice !== null)
      .map((stock) => ({
        symbol: stock.symbol,
        yahooSymbol: toYahooSymbol(stock.symbol),
        price: Number(stock.lastPrice),
        previousClose: null,
        dayHigh: null,
        dayLow: null,
        currency: "TRY",
        name: stock.name,
      }));
  }

  async fetchHistory(symbol: string, range: HistoryRange): Promise<YahooCandle[]> {
    const candles = await getChartCandles(symbol, range);
    return candles.map((candle) => ({ ...candle, volume: null }));
  }
}

/** Paylaşılan strateji örnekleri. */
export const yahooPriceSource = new YahooFinancePriceSource();
export const simulatedPriceSource = new SimulatedPriceSource();

/**
 * Seçili fiyat kaynağını çözümler: AdminSettings.priceSource önceliklidir;
 * ayar okunamazsa PRICE_SOURCE env'e, o da yoksa "YAHOO"ya düşer.
 */
export async function resolvePriceSourceKind(): Promise<PriceSourceKind> {
  try {
    const settings = await getOrCreateAdminSettings();
    if (settings.priceSource === "YAHOO" || settings.priceSource === "SIMULATED") {
      return settings.priceSource;
    }
  } catch {
    // Ayar okunamadı — env'e düşülür (aşağıda).
  }
  return process.env.PRICE_SOURCE?.trim().toUpperCase() === "SIMULATED"
    ? "SIMULATED"
    : "YAHOO";
}

/** Başarılı çağrı için source durumu üretir. */
function successStatus(selected: PriceSourceKind): PriceSourceStatus {
  return {
    selected,
    effective: selected,
    fallbackUsed: false,
    fallbackReason: null,
  };
}

/** Fallback sonrası source durumu üretir. */
function fallbackStatus(reason: string): PriceSourceStatus {
  return {
    selected: "YAHOO",
    effective: "SIMULATED",
    fallbackUsed: true,
    fallbackReason: reason,
  };
}

/** Tick sonucu — source durumuyla birlikte (TickResultView'a serileştirilir). */
export interface TickWithSourceResult {
  processed: number;
  prices: Record<string, string>;
  tickedAt: Date;
  source: PriceSourceStatus;
}

/**
 * Yahoo quote'unu simülatörle aynı DB yazma desenine çevirir:
 * appendPriceHistory (open/high/low/close) + updateLastPrice.
 *
 * Gerçek gün verisi: open = önceki kapanış (yoksa mevcut lastPrice),
 * high/low = gün içi ekstremeler (yoksa open/close aralığı), close = güncel fiyat.
 */
async function persistYahooQuote(
  stockId: string,
  symbol: string,
  quote: YahooQuote,
  currentLastPrice: Prisma.Decimal | null,
  timestamp: Date,
): Promise<string> {
  const price = new Prisma.Decimal(quote.price.toFixed(4));

  // Fiyat değişmediyse (pazar kapalı / seans dışı) yeni kayıt eklenmez —
  // DB şişmesi önlenir; mevcut lastPrice zaten aynıdır.
  if (currentLastPrice !== null && currentLastPrice.equals(price)) {
    return price.toString();
  }

  const previousClose =
    quote.previousClose !== null
      ? new Prisma.Decimal(quote.previousClose.toFixed(4))
      : (currentLastPrice ?? price);
  const dayHigh =
    quote.dayHigh !== null ? new Prisma.Decimal(quote.dayHigh.toFixed(4)) : null;
  const dayLow =
    quote.dayLow !== null ? new Prisma.Decimal(quote.dayLow.toFixed(4)) : null;

  const open = previousClose;
  const high = dayHigh !== null ? Prisma.Decimal.max(open, dayHigh) : Prisma.Decimal.max(open, price);
  const low = dayLow !== null ? Prisma.Decimal.min(open, dayLow) : Prisma.Decimal.min(open, price);

  await appendPriceHistory({
    stockId,
    timestamp,
    open,
    high,
    low,
    close: price,
  });
  await updateLastPrice(stockId, price);

  console.log(
    `[price-source] ${symbol} gerçek fiyat işlendi: ${price.toFixed(2)} (kaynak: Yahoo Finance)`,
  );
  return price.toString();
}

/**
 * Bir tick çalıştırır — seçili fiyat kaynağına göre:
 *  - SIMULATED → mevcut runMarketTick davranışı (değişmedi).
 *  - YAHOO → izleme listesi sembolleri için gerçek fiyatlar çekilir,
 *    Stock.lastPrice güncellenir + PriceHistory kaydı eklenir (simülatörle
 *    aynı yazma deseni). Yahoo başarısızsa otomatik simülatöre düşülür.
 */
export async function runTickWithSource(options?: {
  seed?: number;
  symbols?: string[];
  timestamp?: Date;
  /** Test enjeksiyonu — verify script'leri mock/başarısız client enjekte eder. */
  yahooClient?: YahooFinanceClient;
}): Promise<TickWithSourceResult> {
  const selected = await resolvePriceSourceKind();
  const timestamp = options?.timestamp ?? new Date();
  const client = options?.yahooClient ?? yahooFinanceClient;

  if (selected === "SIMULATED") {
    const result = await runSimulatedTick(options, timestamp);
    return { ...result, source: successStatus("SIMULATED") };
  }

  // YAHOO: işlenecek hisseler — izleme listesindekiler (opsiyonel sembol filtresiyle).
  const watchlist = await prisma.watchlist.findMany({
    include: { stock: true },
    orderBy: { createdAt: "asc" },
  });
  const targets = watchlist.filter((entry) => {
    if (!entry.stock.isActive) return false;
    if (options?.symbols && options.symbols.length > 0) {
      return options.symbols.includes(entry.stock.symbol);
    }
    return true;
  });
  const symbols = targets.map((entry) => entry.stock.symbol);

  try {
    const quotes = await client.fetchQuotes(symbols);
    const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const prices: Record<string, string> = {};

    for (const entry of targets) {
      const stock = entry.stock;
      const quote = quoteBySymbol.get(stock.symbol);
      if (!quote) continue; // Yahoo bu sembol için veri döndürmedi.

      prices[stock.symbol] = await persistYahooQuote(
        stock.id,
        stock.symbol,
        quote,
        stock.lastPrice,
        timestamp,
      );
    }

    return {
      processed: Object.keys(prices).length,
      prices,
      tickedAt: timestamp,
      source: successStatus("YAHOO"),
    };
  } catch (error: unknown) {
    // FALLBACK: Yahoo başarısız → simülatör + log + UI bilgilendirmesi.
    const reason =
      error instanceof Error ? error.message : "Yahoo Finance çağrısı başarısız.";
    console.warn(
      "[price-source] Yahoo Finance başarısız — simülatöre (yedek) düşülüyor:",
      reason,
    );
    const result = await runSimulatedTick(options, timestamp);
    return { ...result, source: fallbackStatus(reason) };
  }
}

/** Simülatör tick'i — runMarketTick'i çağırır (mevcut davranış korunur). */
async function runSimulatedTick(
  options: { seed?: number; symbols?: string[] } | undefined,
  timestamp: Date,
): Promise<{ processed: number; prices: Record<string, string>; tickedAt: Date }> {
  const { runMarketTick } = await import("@/server/services/market-simulator");
  const result = await runMarketTick({ ...options, timestamp });
  return {
    processed: result.processed,
    prices: result.prices,
    tickedAt: result.tickedAt,
  };
}

/**
 * Yahoo geçmiş mumlarını PriceHistory'ye yazar — sembol başına bir kez:
 * Yahoo mumlarının zaman aralığında zaten kayıt varsa yalnızca eksikler eklenir
 * (upsert benzeri; tekrar yazım yok). Hisse DB'de yoksa yazım atlanır.
 */
async function persistYahooHistory(
  symbol: string,
  candles: YahooCandle[],
): Promise<void> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) return; // Watchlist dışı/DB dışı sembol — geçmiş yazılmaz.

  const times = candles.map((candle) => candle.time);
  const minTime = Math.min(...times) * 1000;
  const maxTime = Math.max(...times) * 1000;

  const existing = await prisma.priceHistory.findMany({
    where: {
      stockId: stock.id,
      timestamp: { gte: new Date(minTime), lte: new Date(maxTime) },
    },
    select: { timestamp: true },
  });
  const existingTimes = new Set(existing.map((record) => record.timestamp.getTime()));

  const rows = candles
    .filter((candle) => !existingTimes.has(candle.time * 1000))
    .map((candle) => ({
      stockId: stock.id,
      timestamp: new Date(candle.time * 1000),
      open: new Prisma.Decimal(candle.open.toFixed(4)),
      high: new Prisma.Decimal(candle.high.toFixed(4)),
      low: new Prisma.Decimal(candle.low.toFixed(4)),
      close: new Prisma.Decimal(candle.close.toFixed(4)),
      volume:
        candle.volume !== null
          ? new Prisma.Decimal(Math.round(candle.volume))
          : null,
    }));

  if (rows.length === 0) return;
  await prisma.priceHistory.createMany({ data: rows });
  console.log(
    `[price-source] ${symbol} Yahoo geçmişi PriceHistory'ye yazıldı: ${rows.length} mum.`,
  );
}

/** History sonucu — source durumuyla birlikte (HistoryResponse'a serileştirilir). */
export interface HistoryWithSourceResult {
  candles: ChartCandle[];
  source: PriceSourceStatus;
}

/**
 * Sembolün fiyat geçmişini seçili kaynağa göre getirir:
 *  - SIMULATED → DB PriceHistory'den mumlar (mevcut davranış).
 *  - YAHOO → gerçek OHLC Yahoo'dan çekilir ve PriceHistory'ye yazılır
 *    (sembol başına bir kez); başarısızsa DB PriceHistory'ye düşülür.
 */
export async function fetchHistoryWithSource(
  symbol: string,
  range: HistoryRange,
  /** Test enjeksiyonu — verify script'leri mock/başarısız client enjekte eder. */
  yahooClient?: YahooFinanceClient,
): Promise<HistoryWithSourceResult> {
  const selected = await resolvePriceSourceKind();
  const client = yahooClient ?? yahooFinanceClient;

  if (selected === "SIMULATED") {
    const candles = await getChartCandles(symbol, range);
    return { candles, source: successStatus("SIMULATED") };
  }

  try {
    const yahooCandles = await client.fetchHistory(symbol, range);
    const candles: ChartCandle[] = yahooCandles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    await persistYahooHistory(symbol, yahooCandles);
    return { candles, source: successStatus("YAHOO") };
  } catch (error: unknown) {
    // FALLBACK: DB PriceHistory + log + UI bilgilendirmesi.
    const reason =
      error instanceof Error
        ? error.message
        : "Yahoo Finance geçmiş çağrısı başarısız.";
    console.warn(
      "[price-source] Yahoo history başarısız — DB geçmişine (yedek) düşülüyor:",
      reason,
    );
    const candles = await getChartCandles(symbol, range);
    return { candles, source: fallbackStatus(reason) };
  }
}
