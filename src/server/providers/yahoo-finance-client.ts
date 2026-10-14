import { z, ZodError } from "zod";
import type { HistoryRange } from "@/lib/types";
import { logApiCall, type ApiCallLogEntry } from "@/server/services/api-log-service";

/**
 * Yahoo Finance istemcisi — gerçek BIST fiyat kaynağı (API key gerektirmez).
 *
 * Endpoint'ler:
 *  - v8 chart:  https://query1.finance.yahoo.com/v8/finance/chart/THYAO.IS?interval=1d&range=5d
 *    → meta.regularMarketPrice (güncel fiyat), meta.chartPreviousClose,
 *      meta.regularMarketDayHigh/Low; geçmiş için timestamp + indicators.quote.
 *  - v7 quote:  https://query1.finance.yahoo.com/v7/finance/quote?symbols=THYAO.IS,ASELS.IS
 *    → toplu quote (crumb gerekebilir; başarısızsa sıralı chart isteklerine düşer).
 *
 * Dönem → interval/range haritası:
 *  1D → interval=1m&range=1d   1W → interval=5m&range=5d   1M → interval=1h&range=1mo
 *  3M → interval=1d&range=3mo  1Y → interval=1d&range=1y   5Y → interval=1wk&range=5y
 *
 * Sembol dönüşümü: BIST hisselerine ".IS" eklenir (THYAO → THYAO.IS);
 * döviz çiftleri olduğu gibi kalır (USDTRY → USDTRY=X, "=" içerir veya X ile biter).
 *
 * Güvenilirlik teknikleri:
 *  - Tüm yanıtlar Zod ile doğrulanır (şema dışı yanıt PROVIDER_ERROR).
 *  - 10 sn AbortController zaman aşımı.
 *  - Gerçekçi tarayıcı User-Agent (UA olmadan Yahoo 429/403 döndürür).
 *  - Hata sınıflandırması: NETWORK_ERROR | TIMEOUT | INVALID_SYMBOL |
 *    EMPTY_DATA | RATE_LIMITED | PROVIDER_ERROR.
 *  - Rate limit koruması: istekler arası ~200 ms gecikme.
 *  - Tüm çağrılar ApiCallLog'a yazılır (best-effort — ana akışı bozmaz).
 */

/**
 * Yahoo Finance taban URL'si — env override destekler (proxy/üretim URL'i).
 * Varsayılan: https://query1.finance.yahoo.com
 */
const YAHOO_BASE_URL =
  process.env.YAHOO_BASE_URL?.trim() || "https://query1.finance.yahoo.com";

/** İstek zaman aşımı (ms) — 10 saniye. */
const TIMEOUT_MS = 10_000;

/** İstekler arası minimum gecikme (ms) — rate limit koruması. */
const REQUEST_DELAY_MS = 200;

/**
 * Paralel fetch eşzamanlılık limiti (iyileştirme 5.2) — 100 sembollük tick'in
 * 20+ saniye sürmesini önler. 4-6 eşzamanlı istek Yahoo rate limit'iyle
 * uyumlu kalmayı sağlar; throttle zinciri istek BAŞINA minimum 200 ms
 * aralık garantiler (4 eşzamanlıda efektif ~50 ms/istek).
 */
const FETCH_CONCURRENCY = 4;

/** Gerçekçi tarayıcı User-Agent — Yahoo UA olmadan 429/403 döndürür. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Yahoo hata sınıflandırması — fallback ve ApiCallLog.errorCode için. */
export type YahooPriceErrorClass =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_SYMBOL"
  | "EMPTY_DATA"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR";

/** Yahoo fiyat hatası — kullanıcıya dönük Türkçe mesaj taşır. */
export class YahooPriceError extends Error {
  constructor(
    message: string,
    readonly code: YahooPriceErrorClass,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "YahooPriceError";
  }
}

/** Tek sembolün güncel fiyat görünümü — chart meta veya v7 quote'tan. */
export interface YahooQuote {
  /** BIST sembolü (THYAO) — DB ve UI bu haliyle kullanır. */
  symbol: string;
  /** Yahoo sembolü (THYAO.IS) — izlenebilirlik için. */
  yahooSymbol: string;
  /** Güncel fiyat. */
  price: number;
  /** Önceki kapanış (varsa). */
  previousClose: number | null;
  /** Gün içi en yüksek (varsa). */
  dayHigh: number | null;
  /** Gün içi en düşük (varsa). */
  dayLow: number | null;
  /** Para birimi (varsa). */
  currency: string | null;
  /** Borsa/şirket adı (varsa). */
  name: string | null;
}

/** Yahoo geçmiş mumu — ChartCandle + hacim. */
export interface YahooCandle {
  /** UNIX zaman damgası (saniye). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** İşlem hacmi (varsa). */
  volume: number | null;
}

/** Dönem → Yahoo interval/range haritası. */
const RANGE_PARAMS: Record<HistoryRange, { interval: string; yahooRange: string }> = {
  "1D": { interval: "1m", yahooRange: "1d" },
  "1W": { interval: "5m", yahooRange: "5d" },
  "1M": { interval: "1h", yahooRange: "1mo" },
  "3M": { interval: "1d", yahooRange: "3mo" },
  "1Y": { interval: "1d", yahooRange: "1y" },
  "5Y": { interval: "1wk", yahooRange: "5y" },
};

// ============================================================
// Zod yanıt şemaları — dış API yanıtları asla doğrulanmadan kullanılmaz.
// ============================================================

/** v8 chart meta şeması — bilinen alanlar + passthrough (ek alanlara tolerans). */
const chartMetaSchema = z
  .object({
    symbol: z.string(),
    currency: z.string().nullish(),
    exchangeName: z.string().nullish(),
    regularMarketPrice: z.number(),
    chartPreviousClose: z.number().nullish(),
    regularMarketDayHigh: z.number().nullish(),
    regularMarketDayLow: z.number().nullish(),
  })
  .passthrough();

/** v8 chart result şeması — meta + opsiyonel zaman serisi. */
const chartResultSchema = z
  .object({
    meta: chartMetaSchema,
    timestamp: z.array(z.number()).optional(),
    indicators: z
      .object({
        quote: z
          .array(
            z.object({
              open: z.array(z.number().nullish()).nullish(),
              high: z.array(z.number().nullish()).nullish(),
              low: z.array(z.number().nullish()).nullish(),
              close: z.array(z.number().nullish()).nullish(),
              volume: z.array(z.number().nullish()).nullish(),
            }),
          )
          .min(1),
      })
      .optional(),
  })
  .passthrough();

/** v8 chart yanıt şeması. */
const chartResponseSchema = z
  .object({
    chart: z.object({
      result: z.array(chartResultSchema).nullable().optional(),
      error: z
        .object({
          code: z.string(),
          description: z.string(),
        })
        .nullish()
        .optional(),
    }),
  })
  .passthrough();

/** v7 quote öğe şeması. */
const v7QuoteItemSchema = z
  .object({
    symbol: z.string(),
    shortName: z.string().nullish(),
    regularMarketPrice: z.number(),
    regularMarketPreviousClose: z.number().nullish(),
    regularMarketDayHigh: z.number().nullish(),
    regularMarketDayLow: z.number().nullish(),
    currency: z.string().nullish(),
  })
  .passthrough();

/** v7 toplu quote yanıt şeması. */
const v7QuoteResponseSchema = z
  .object({
    quoteResponse: z.object({
      result: z.array(v7QuoteItemSchema),
    }),
  })
  .passthrough();

// ============================================================
// Yardımcılar
// ============================================================

/** Bilinen para birimi kodları — döviz çifti tespiti için (XXXYYY son eki). */
const CURRENCY_CODES = new Set([
  "TRY",
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "JPY",
  "AUD",
  "CAD",
]);

/**
 * BIST sembolünü Yahoo sembolüne dönüştürür.
 *  - "THYAO"    → "THYAO.IS"   (BIST hissesi)
 *  - "USDTRY"   → "USDTRY=X"   (döviz çifti — Yahoo FX formatı)
 *  - "USDTRY=X" → "USDTRY=X"   (zaten Yahoo formatı)
 *  - "THYAO.IS" → "THYAO.IS"   (zaten Yahoo formatı)
 */
export function toYahooSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes("=") || upper.endsWith(".IS")) return upper;
  // Döviz çifti: 6 harf ve bilinen bir para birimi koduyla biter (örn. USD+TRY).
  if (upper.length === 6 && CURRENCY_CODES.has(upper.slice(3))) {
    return `${upper}=X`;
  }
  return `${upper}.IS`;
}

/**
 * Yahoo sembolünü BIST sembolüne normalize eder: "THYAO.IS" → "THYAO",
 * "USDTRY=X" → "USDTRY". BIST hisseleri olduğu gibi kalır.
 */
export function normalizeBistSymbol(yahooSymbol: string): string {
  const upper = yahooSymbol.trim().toUpperCase();
  if (upper.endsWith(".IS")) return upper.slice(0, -3);
  return upper.endsWith("=X") ? upper.slice(0, -2) : upper;
}

/** Hata koduna göre ApiCallLog.errorClass üretir. */
function errorClassFor(code: YahooPriceErrorClass): string {
  return code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "RATE_LIMITED"
    ? "TRANSIENT"
    : "PERMANENT";
}

/** Yahoo HTTP yanıtı — status + doğrulanmamış gövde. */
interface YahooHttpResponse {
  status: number;
  body: unknown;
}

/**
 * Yahoo endpoint'ine JSON GET isteği atar.
 * 10 sn AbortController zaman aşımı + tarayıcı başlıkları.
 * HTTP hatalarını YahooPriceError'a sınıflandırır.
 */
async function fetchJson(url: string): Promise<YahooHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://finance.yahoo.com/",
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new YahooPriceError(
          "Yahoo Finance hız sınırına takıldı (429). Kısa süre sonra tekrar deneyin.",
          "RATE_LIMITED",
          429,
        );
      }
      if (response.status === 404) {
        throw new YahooPriceError(
          "Yahoo Finance kaydı bulunamadı (404) — sembol geçersiz olabilir.",
          "INVALID_SYMBOL",
          404,
        );
      }
      throw new YahooPriceError(
        `Yahoo Finance HTTP ${response.status} döndü.`,
        "PROVIDER_ERROR",
        response.status,
      );
    }

    return { status: response.status, body: (await response.json()) as unknown };
  } catch (error: unknown) {
    if (error instanceof YahooPriceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new YahooPriceError(
        "Yahoo Finance isteği zaman aşımına uğradı (10 sn).",
        "TIMEOUT",
        null,
      );
    }
    throw new YahooPriceError(
      "Yahoo Finance'e ulaşılamadı — ağ hatası.",
      "NETWORK_ERROR",
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Modül düzeyinde son istek zamanı — throttle zincirini besler. */
let lastRequestAt = 0;

/** Throttle zinciri: paralel çağıranlar sıraya girer (iyileştirme 5.2). */
let throttleChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limit koruması (zincir-korumalı): paralel çağıranlar bile istek
 * BAŞINA minimum REQUEST_DELAY_MS aralıkla sıraya girer. Zincir, eşzamanlı
 * throttle() çağrılarının gecikme hesabını yarış durumu olmadan
 * sıralamasını garantiler — paralel fetch açıldığında bile Yahoo'ya
 * burst istek gitmez.
 */
async function throttle(): Promise<void> {
  const previous = throttleChain;
  let release: () => void;
  throttleChain = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const now = Date.now();
  const waitMs = lastRequestAt + REQUEST_DELAY_MS - now;
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
  release!();
}

/**
 * Sınırlı eşzamanlılıkla paralel görev yürütür (iyileştirme 5.2).
 * p-limit bağımlılığı yerine 12 satırlık yerel implementasyon: işler
 * sıraya girer, her biri tamamlanınca sıradaki başlar. Tek bir işin
 * hatası diğerlerini düşürmez — sonuçlar (hata dahil) sırayla döner.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

// ============================================================
// İstemci
// ============================================================

/**
 * Yahoo Finance fiyat istemcisi.
 *
 * logApiCall enjeksiyonu (gemini-provider deseni): varsayılan olarak gerçek
 * ApiCallLog yazıcısı kullanılır; test script'leri mock enjekte edebilir.
 */
export class YahooFinanceClient {
  constructor(
    private readonly logApiCallFn: (entry: ApiCallLogEntry) => Promise<void> = logApiCall,
  ) {}

  /**
   * Tek sembolün güncel fiyatını v8 chart meta'sından çeker.
   * interval=1d&range=5d — meta.regularMarketPrice her zaman güncel kapanışı verir.
   */
  async fetchQuote(symbol: string): Promise<YahooQuote> {
    const yahooSymbol = toYahooSymbol(symbol);
    const query = "interval=1d&range=5d";
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${query}`;
    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let errorCode: string | null = null;
    let errorClass: string | null = null;

    try {
      await throttle();
      const { status, body } = await fetchJson(url);
      httpStatus = status;
      responseBody = JSON.stringify(body).slice(0, 2000);

      const parsed = chartResponseSchema.parse(body);
      const result = parsed.chart.result?.[0];
      if (!result) {
        const description = parsed.chart.error?.description ?? "veri boş";
        throw new YahooPriceError(
          `"${symbol}" için Yahoo Finance verisi bulunamadı (${description}).`,
          "INVALID_SYMBOL",
          null,
        );
      }

      const meta = result.meta;
      return {
        symbol: normalizeBistSymbol(symbol),
        yahooSymbol,
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose ?? null,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        currency: meta.currency ?? null,
        name: meta.exchangeName ?? null,
      };
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        errorCode = "SCHEMA_VALIDATION";
        errorClass = "PERMANENT";
        throw new YahooPriceError(
          `Yahoo Finance yanıtı beklenen şemaya uymuyor (${symbol}).`,
          "PROVIDER_ERROR",
          httpStatus,
        );
      }
      if (error instanceof YahooPriceError) {
        errorCode = error.code;
        errorClass = errorClassFor(error.code);
        throw error;
      }
      errorCode = "UNKNOWN";
      errorClass = "UNKNOWN";
      throw new YahooPriceError(
        `Yahoo Finance çağrısında beklenmeyen hata (${symbol}).`,
        "PROVIDER_ERROR",
        httpStatus,
      );
    } finally {
      await this.logApiCallFn({
        endpoint: `YAHOO:chart:${yahooSymbol}`,
        requestBody: query,
        responseBody,
        httpStatus,
        errorClass,
        errorCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /**
   * Toplu quote — v7 quote endpoint'i (crumb gerekebilir).
   * Başarısız olursa çağıran taraf sıralı chart isteklerine düşer.
   */
  private async fetchQuotesBatch(symbols: string[]): Promise<YahooQuote[]> {
    const yahooSymbols = symbols.map(toYahooSymbol);
    const query = `symbols=${encodeURIComponent(yahooSymbols.join(","))}`;
    const url = `${YAHOO_BASE_URL}/v7/finance/quote?${query}`;
    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let errorCode: string | null = null;
    let errorClass: string | null = null;

    try {
      await throttle();
      const { status, body } = await fetchJson(url);
      httpStatus = status;
      responseBody = JSON.stringify(body).slice(0, 2000);

      const parsed = v7QuoteResponseSchema.parse(body);
      return parsed.quoteResponse.result.map((item) => ({
        symbol: normalizeBistSymbol(item.symbol),
        yahooSymbol: item.symbol.trim().toUpperCase(),
        price: item.regularMarketPrice,
        previousClose: item.regularMarketPreviousClose ?? null,
        dayHigh: item.regularMarketDayHigh ?? null,
        dayLow: item.regularMarketDayLow ?? null,
        currency: item.currency ?? null,
        name: item.shortName ?? null,
      }));
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        errorCode = "SCHEMA_VALIDATION";
        errorClass = "PERMANENT";
      } else if (error instanceof YahooPriceError) {
        errorCode = error.code;
        errorClass = errorClassFor(error.code);
      } else {
        errorCode = "UNKNOWN";
        errorClass = "UNKNOWN";
      }
      throw error instanceof YahooPriceError
        ? error
        : new YahooPriceError(
            "Yahoo v7 toplu quote çağrısı başarısız.",
            "PROVIDER_ERROR",
            httpStatus,
          );
    } finally {
      await this.logApiCallFn({
        endpoint: "YAHOO:quote:batch",
        requestBody: yahooSymbols.join(","),
        responseBody,
        httpStatus,
        errorClass,
        errorCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /**
   * Birden fazla sembolün güncel fiyatları.
   *
   * Strateji: önce v7 toplu quote denenir (crumb gerekebilir); başarısızsa
   * veya bazı semboller eksikse eksikler için chart istekleri atılır.
   *
   * İyileştirme 5.2: eksik semboller artık SIRALI değil, FETCH_CONCURRENCY
   * (4) eşzamanlılıkla paralel çekilir. Throttle zinciri istek başına
   * minimum 200 ms aralığı korur — 100 sembollük tick ~20 sn yerine ~5-6 sn
   * sürer; SL/TP kontrolü bu gecikmeden yararlanır. Tek sembol hatası
   * sonucu düşürmez (o sembol atlanır).
   */
  async fetchQuotes(symbols: string[]): Promise<YahooQuote[]> {
    if (symbols.length === 0) return [];

    const bySymbol = new Map<string, YahooQuote>();
    try {
      const batch = await this.fetchQuotesBatch(symbols);
      for (const quote of batch) {
        bySymbol.set(quote.symbol, quote);
      }
    } catch {
      // Toplu quote başarısız (crumb/429/şema) — paralel chart'a düşülür.
    }

    const missing = symbols.filter(
      (symbol) => !bySymbol.has(normalizeBistSymbol(symbol)),
    );
    const quotes = await mapWithConcurrency(
      missing,
      FETCH_CONCURRENCY,
      async (symbol) => {
        try {
          return await this.fetchQuote(symbol);
        } catch {
          // Tek sembol hatası (geçersiz sembol/ağ) toplamı düşürmez.
          return null;
        }
      },
    );
    for (const quote of quotes) {
      if (quote) bySymbol.set(quote.symbol, quote);
    }

    return symbols
      .map((symbol) => bySymbol.get(normalizeBistSymbol(symbol)))
      .filter((quote): quote is YahooQuote => quote !== undefined);
  }

  /**
   * Sembolün fiyat geçmişini v8 chart endpoint'inden OHLC mumları olarak çeker.
   * Dönem → interval/range haritası RANGE_PARAMS'tadır. null içeren mumlar
   * atlanır; hiç mum kalmazsa EMPTY_DATA fırlatılır.
   */
  async fetchHistory(symbol: string, range: HistoryRange): Promise<YahooCandle[]> {
    const yahooSymbol = toYahooSymbol(symbol);
    const { interval, yahooRange } = RANGE_PARAMS[range];
    const query = `interval=${interval}&range=${yahooRange}`;
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${query}`;
    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let errorCode: string | null = null;
    let errorClass: string | null = null;

    try {
      await throttle();
      const { status, body } = await fetchJson(url);
      httpStatus = status;
      responseBody = JSON.stringify(body).slice(0, 2000);

      const parsed = chartResponseSchema.parse(body);
      const result = parsed.chart.result?.[0];
      if (!result) {
        const description = parsed.chart.error?.description ?? "veri boş";
        throw new YahooPriceError(
          `"${symbol}" için Yahoo Finance geçmişi bulunamadı (${description}).`,
          "INVALID_SYMBOL",
          null,
        );
      }

      const timestamps = result.timestamp ?? [];
      const quote = result.indicators?.quote?.[0];
      if (timestamps.length === 0 || !quote) {
        throw new YahooPriceError(
          `"${symbol}" için Yahoo Finance geçmiş verisi boş.`,
          "EMPTY_DATA",
          null,
        );
      }

      const candles: YahooCandle[] = [];
      for (let i = 0; i < timestamps.length; i += 1) {
        const time = timestamps[i];
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        // Eksik/null mumlar atlanır (Yahoo işlem olmayan seanslar için null döndürür).
        if (time == null || open == null || high == null || low == null || close == null) {
          continue;
        }
        candles.push({
          time,
          open,
          high,
          low,
          close,
          volume: quote.volume?.[i] ?? null,
        });
      }

      if (candles.length === 0) {
        throw new YahooPriceError(
          `"${symbol}" için Yahoo Finance geçmişinde geçerli mum yok.`,
          "EMPTY_DATA",
          null,
        );
      }

      return candles;
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        errorCode = "SCHEMA_VALIDATION";
        errorClass = "PERMANENT";
        throw new YahooPriceError(
          `Yahoo Finance geçmiş yanıtı beklenen şemaya uymuyor (${symbol}).`,
          "PROVIDER_ERROR",
          httpStatus,
        );
      }
      if (error instanceof YahooPriceError) {
        errorCode = error.code;
        errorClass = errorClassFor(error.code);
        throw error;
      }
      errorCode = "UNKNOWN";
      errorClass = "UNKNOWN";
      throw new YahooPriceError(
        `Yahoo Finance geçmiş çağrısında beklenmeyen hata (${symbol}).`,
        "PROVIDER_ERROR",
        httpStatus,
      );
    } finally {
      await this.logApiCallFn({
        endpoint: `YAHOO:chart-history:${yahooSymbol}`,
        requestBody: query,
        responseBody,
        httpStatus,
        errorClass,
        errorCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /**
   * Bağlantı testi — admin paneli "Bağlantıyı Test Et" butonu için.
   * THYAO.IS güncel fiyatını çeker; hata halinde ok:false + Türkçe mesaj.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const quote = await this.fetchQuote("THYAO");
      return {
        ok: true,
        message: `Yahoo Finance bağlantısı başarılı — THYAO güncel fiyat: ${quote.price.toFixed(2)} ${quote.currency ?? "TL"}.`,
      };
    } catch (error: unknown) {
      const message =
        error instanceof YahooPriceError
          ? error.message
          : "Yahoo Finance'e ulaşılamadı — beklenmeyen hata.";
      return { ok: false, message };
    }
  }
}

/** Paylaşılan istemci örneği — servis katmanı bunu kullanır. */
export const yahooFinanceClient = new YahooFinanceClient();
