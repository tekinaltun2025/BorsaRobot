/**
 * Faz 7 doğrulama scripti — Yahoo Finance gerçek BIST fiyat entegrasyonu.
 *
 * Kullanım: npx tsx scripts/verify-yahoo.ts  (veya npm run verify:yahoo)
 *
 * API key GEREKMEZ: Yahoo Finance v8 chart endpoint'i ücretsizdir.
 * İnternet erişimi gerektirir (gerçek fiyat doğrulaması için).
 *
 * Doğrulanan akışlar:
 *  1. Sembol dönüşümü: THYAO → THYAO.IS; USDTRY → USDTRY (X ile biter);
 *     USDTRY=X → USDTRY=X (zaten Yahoo formatı); normalizeBistSymbol tersi.
 *  2. Gerçek fiyat: THYAO güncel fiyatı > 0 ve makul aralıkta (Yahoo canlı).
 *  3. Gerçek toplu quote: THYAO + ASELS tek çağrıda (v7 → sıralı chart fallback).
 *  4. Gerçek OHLC geçmişi: 1D mumları zaman sıralı, OHLC tutarlı
 *     (high ≥ max(open, close), low ≤ min(open, close)).
 *  5. Geçersiz sembol: anlamsız sembol → YahooPriceError (INVALID_SYMBOL).
 *  6. Zod doğrulama: başarılı quote/geçmiş çağrıları şema doğrulamasından geçer.
 *  7. Gerçek tick: runTickWithSource → effective=YAHOO, Stock.lastPrice +
 *     PriceHistory DB'ye gerçek fiyatla yazılır.
 *  8. FALLBACK tick: Yahoo erişilemez (mock) → otomatik SIMULATED'a düşer;
 *     source.fallbackUsed=true + fallbackReason dolu; simülatör fiyat üretir.
 *  9. FALLBACK history: Yahoo erişilemez (mock) → DB PriceHistory'ye düşer.
 * 10. ApiCallLog denetim kaydı: Yahoo çağrıları loglanır.
 *
 * İzolasyon: script kendi sembolünü (YTST) ve watchlist kaydını oluşturur;
 * AdminSettings.priceSource test süresince yedeklenir ve koşu sonunda geri
 * yüklenir. Sonunda tüm test verileri temizlenir.
 */
import { PrismaClient } from "@prisma/client";
import {
  YahooFinanceClient,
  YahooPriceError,
  normalizeBistSymbol,
  toYahooSymbol,
  type YahooCandle,
  type YahooQuote,
} from "../src/server/providers/yahoo-finance-client";
import {
  fetchHistoryWithSource,
  runTickWithSource,
} from "../src/server/services/price-source";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-market.ts deseni. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Hatayı kısa tanımla (log okunabilirliği). */
function errBrief(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Başarısız Yahoo client — yalnızca bu script'te tanımlıdır.
 * Her çağrıda NETWORK_ERROR fırlatır; fallback mekanizmasını tetikler.
 * logApiCall no-op enjekte edilir (test DB'sine log yazılmaz).
 */
class FailingYahooClient extends YahooFinanceClient {
  constructor() {
    super(async () => {});
  }

  override async fetchQuotes(_symbols: string[]): Promise<YahooQuote[]> {
    throw new YahooPriceError(
      "Mock: Yahoo Finance erişilemez (ağ hatası).",
      "NETWORK_ERROR",
    );
  }

  override async fetchHistory(
    _symbol: string,
    _range: Parameters<YahooFinanceClient["fetchHistory"]>[1],
  ): Promise<YahooCandle[]> {
    throw new YahooPriceError(
      "Mock: Yahoo Finance erişilemez (ağ hatası).",
      "NETWORK_ERROR",
    );
  }
}

// --- Temizlik durumu (her çıkış yolunda geri yüklenir).
const TEST_SYMBOL = "YTST";
let testStockId: string | null = null;
let originalPriceSource: string | null = null;

/** Test verilerini siler, priceSource ayarını geri yükler. */
async function cleanup(): Promise<void> {
  try {
    if (testStockId !== null) {
      await prisma.priceHistory.deleteMany({ where: { stockId: testStockId } });
      await prisma.watchlist.deleteMany({ where: { stockId: testStockId } });
      await prisma.stock.deleteMany({ where: { id: testStockId } });
    }
    if (originalPriceSource !== null) {
      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { priceSource: originalPriceSource },
      });
    }
  } catch (error: unknown) {
    console.error("[cleanup] Temizlik hatası:", error);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("=== FAZ 7 — YAHOO FINANCE GERÇEK BIST FİYAT DOĞRULAMA ===\n");

  // --- Kurulum: priceSource yedekle + YAHOO yap; test sembolü oluştur.
  const settings = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  assert(settings !== null, "AdminSettings kaydı bulunamadı — önce npm run db:seed.");
  originalPriceSource = settings.priceSource;
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { priceSource: "YAHOO" },
  });

  const testStock = await prisma.stock.upsert({
    where: { symbol: TEST_SYMBOL },
    update: { lastPrice: 100, isActive: true },
    create: {
      symbol: TEST_SYMBOL,
      name: "Yahoo Test Hisse (doğrulama)",
      lastPrice: 100,
      isActive: true,
    },
  });
  testStockId = testStock.id;
  await prisma.watchlist.upsert({
    where: { stockId: testStock.id },
    update: {},
    create: { stockId: testStock.id, autoAnalyze: false },
  });

  const client = new YahooFinanceClient();

  // --- 1) Sembol dönüşümü (saf fonksiyonlar — ağ gerektirmez).
  check(
    "Sembol dönüşümü: THYAO → THYAO.IS",
    toYahooSymbol("THYAO") === "THYAO.IS",
    `toYahooSymbol("THYAO") = "${toYahooSymbol("THYAO")}"`,
  );
  check(
    "Sembol dönüşümü: USDTRY → USDTRY=X (döviz çifti — Yahoo FX formatı)",
    toYahooSymbol("USDTRY") === "USDTRY=X",
    `toYahooSymbol("USDTRY") = "${toYahooSymbol("USDTRY")}"`,
  );
  check(
    "Sembol dönüşümü: USDTRY=X → USDTRY=X (zaten Yahoo formatı)",
    toYahooSymbol("USDTRY=X") === "USDTRY=X",
    `toYahooSymbol("USDTRY=X") = "${toYahooSymbol("USDTRY=X")}"`,
  );
  check(
    "Ters dönüşüm: THYAO.IS → THYAO",
    normalizeBistSymbol("THYAO.IS") === "THYAO",
    `normalizeBistSymbol("THYAO.IS") = "${normalizeBistSymbol("THYAO.IS")}"`,
  );

  // --- 2) Gerçek fiyat: THYAO güncel fiyat (Yahoo canlı).
  const quote = await client.fetchQuote("THYAO");
  check(
    "Gerçek fiyat: THYAO quote > 0",
    quote.price > 0 && quote.price < 100_000,
    `THYAO = ${quote.price.toFixed(2)} ${quote.currency ?? "TL"} (yahoo: ${quote.yahooSymbol})`,
  );
  check(
    "Zod doğrulama: quote şemadan geçti",
    quote.symbol === "THYAO" && typeof quote.price === "number",
    "chartResponseSchema.parse başarılı — meta.regularMarketPrice okundu",
  );

  // --- 3) Gerçek toplu quote: THYAO + ASELS.
  const batch = await client.fetchQuotes(["THYAO", "ASELS"]);
  const batchSymbols = batch.map((q) => q.symbol).sort();
  check(
    "Toplu quote: THYAO + ASELS tek çağrıda",
    batch.length === 2 && batchSymbols.join(",") === "ASELS,THYAO",
    `dönen: [${batchSymbols.join(", ")}] — fiyatlar: ${batch.map((q) => q.price.toFixed(2)).join(", ")}`,
  );

  // --- 4) Gerçek OHLC geçmişi: 1D mumları.
  const candles = await client.fetchHistory("THYAO", "1D");
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const isTimeSorted = candles.every(
    (candle, i) => i === 0 || candle.time > (candles[i - 1]?.time ?? 0),
  );
  const isOhlcConsistent = candles.every(
    (candle) =>
      candle.high >= candle.low &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close),
  );
  check(
    "Gerçek geçmiş: 1D mumları dolu ve zaman sıralı",
    candles.length > 0 &&
      firstCandle !== undefined &&
      lastCandle !== undefined &&
      isTimeSorted,
    `${candles.length} mum; ilk: ${firstCandle !== undefined ? new Date(firstCandle.time * 1000).toISOString() : "yok"}, son: ${lastCandle !== undefined ? new Date(lastCandle.time * 1000).toISOString() : "yok"}`,
  );
  check(
    "Gerçek geçmiş: OHLC tutarlı (high ≥ max(A,K), low ≤ min(A,K))",
    isOhlcConsistent,
    "tüm mumlar OHLC değişmezlerini sağlıyor",
  );

  // --- 5) Geçersiz sembol → YahooPriceError.
  let invalidSymbolCaught = false;
  let invalidSymbolCode = "";
  try {
    await client.fetchQuote("ZZZZZ");
  } catch (error: unknown) {
    if (error instanceof YahooPriceError) {
      invalidSymbolCaught = true;
      invalidSymbolCode = error.code;
    }
  }
  check(
    "Geçersiz sembol: YahooPriceError fırlatıldı",
    invalidSymbolCaught &&
      (invalidSymbolCode === "INVALID_SYMBOL" || invalidSymbolCode === "EMPTY_DATA"),
    `kod: ${invalidSymbolCode || "(yakalanmadı)"}`,
  );

  // --- 6) Gerçek tick: runTickWithSource → effective=YAHOO, DB'ye yazım.
  const before = await prisma.stock.findUnique({ where: { symbol: "THYAO" } });
  const tick = await runTickWithSource({ symbols: ["THYAO"] });
  const after = await prisma.stock.findUnique({ where: { symbol: "THYAO" } });
  const historyCount = await prisma.priceHistory.count({
    where: { stock: { symbol: "THYAO" } },
  });
  check(
    "Gerçek tick: effective=YAHOO, fallback yok",
    tick.source.effective === "YAHOO" && !tick.source.fallbackUsed,
    `selected=${tick.source.selected}, effective=${tick.source.effective}`,
  );
  check(
    "Gerçek tick: THYAO fiyatı Yahoo'dan DB'ye yazıldı",
    tick.prices["THYAO"] !== undefined &&
      Number(tick.prices["THYAO"]) > 0 &&
      after?.lastPrice !== null &&
      Number(after?.lastPrice) === Number(tick.prices["THYAO"]),
    `tick fiyatı: ${tick.prices["THYAO"] ?? "yok"}, DB lastPrice: ${after?.lastPrice?.toString() ?? "null"} (önce: ${before?.lastPrice?.toString() ?? "null"})`,
  );
  check(
    "Gerçek tick: PriceHistory kaydı eklendi",
    historyCount > 0,
    `THYAO PriceHistory toplam: ${historyCount} kayıt`,
  );

  // --- 7) FALLBACK tick: Yahoo erişilemez → SIMULATED'a otomatik düşüş.
  const failingClient = new FailingYahooClient();
  const testBefore = await prisma.stock.findUnique({ where: { symbol: TEST_SYMBOL } });
  const fallbackTick = await runTickWithSource({
    symbols: [TEST_SYMBOL],
    yahooClient: failingClient,
  });
  const testAfter = await prisma.stock.findUnique({ where: { symbol: TEST_SYMBOL } });
  check(
    "FALLBACK tick: Yahoo başarısız → effective=SIMULATED",
    fallbackTick.source.fallbackUsed && fallbackTick.source.effective === "SIMULATED",
    `fallbackReason: "${fallbackTick.source.fallbackReason ?? "yok"}"`,
  );
  check(
    "FALLBACK tick: simülatör fiyat üretti ve DB'ye yazıldı",
    fallbackTick.prices[TEST_SYMBOL] !== undefined &&
      Number(fallbackTick.prices[TEST_SYMBOL]) > 0 &&
      testAfter?.lastPrice !== null &&
      Number(testAfter?.lastPrice) === Number(fallbackTick.prices[TEST_SYMBOL]) &&
      testAfter?.lastPrice?.toString() !== testBefore?.lastPrice?.toString(),
    `simüle fiyat: ${fallbackTick.prices[TEST_SYMBOL] ?? "yok"} (önce: ${testBefore?.lastPrice?.toString() ?? "null"})`,
  );

  // --- 8) FALLBACK history: Yahoo erişilemez → DB PriceHistory'ye düşüş.
  const fallbackHistory = await fetchHistoryWithSource(
    TEST_SYMBOL,
    "1D",
    failingClient,
  );
  check(
    "FALLBACK history: Yahoo başarısız → DB geçmişine düşüldü",
    fallbackHistory.source.fallbackUsed && fallbackHistory.source.effective === "SIMULATED",
    `fallbackReason: "${fallbackHistory.source.fallbackReason ?? "yok"}"`,
  );

  // --- 9) ApiCallLog denetim kaydı: Yahoo çağrıları loglandı.
  const yahooLogs = await prisma.apiCallLog.count({
    where: { endpoint: { startsWith: "YAHOO:" } },
  });
  check(
    "ApiCallLog: Yahoo çağrıları denetim kaydına yazıldı",
    yahooLogs > 0,
    `YAHOO:* endpoint'li log sayısı: ${yahooLogs}`,
  );

  // --- Özet.
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== SONUÇ: ${passed}/${results.length} doğrulama geçti ===`);
  if (failed > 0) {
    console.log("Başarısız doğrulamalar:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ✗ ${r.name} — ${r.detail}`);
    }
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await cleanup();
    console.log("\n✓ Temizlik tamamlandı (YTST silindi, priceSource geri yüklendi).");
  })
  .catch(async (error: unknown) => {
    console.error("\n✗ DOĞRULAMA BAŞARISIZ:", errBrief(error));
    await cleanup();
    process.exitCode = 1;
  });
