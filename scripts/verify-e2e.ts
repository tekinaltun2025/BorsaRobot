/**
 * Faz 6 uçtan uca doğrulama scripti — tam sistem senaryosu (mock banka).
 *
 * Kullanım: npx tsx scripts/verify-e2e.ts  (veya npm run verify:e2e)
 *
 * Kanıtlanan uçtan uca akış:
 *  tick → haber → AI analizi → otomatik döngü → portföy →
 *  LIVE'a geçiş → canlı mod guard'ı → mock ile canlı döviz emri →
 *  mutabakat alanları (TransactionID/SessionID) → PAPER'a dönüş.
 *
 * Güvenlik: DENIZBANK_APP_KEY tanımlıysa (gerçek banka riski) script
 * KENDİNİ DURDURUR — tüm canlı emirler deterministik mock transport
 * üzerinden gider; gerçek para hareketi asla gerçekleşmez.
 *
 * İzolasyon: script kendi sembollerini (E2ETK/E2ETS), kendi PAPER ve
 * LIVE hesaplarını, kendi haber makalesini ve cycleId'lerini
 * (e2e-test-*) oluşturur. Mevcut watchlist autoAnalyze bayrakları
 * test süresince kapatılır ve koşu sonunda geri yüklenir; mevcut
 * pozisyonların değişmediği hem ön kontrolle hem koşu sonrası
 * assert'le kanıtlanır. Sonunda tüm test verileri temizlenir.
 *
 * Not: Haber adımı için izole makale doğrudan DB'ye enjekte edilir —
 * scanNewsForStock gerçek Google News ağ çağrısı yapar ve testler
 * ağ bağımlı olmamalıdır. Makalenin analiz context'ine girişi
 * getRecentNewsForAnalysis okuma portu üzerinden kanıtlanır.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { runMarketTick } from "../src/server/services/market-simulator";
import { analyzeStock } from "../src/server/services/analysis-service";
import {
  AUTO_TRADE_JOB_TYPE,
  runAutoTradeCycle,
} from "../src/server/services/auto-trade-service";
import { placeOrder, TradingError } from "../src/server/services/trading-service";
import {
  getAccountSummary,
  getPortfolio,
} from "../src/server/services/portfolio-service";
import { getRecentNewsForAnalysis } from "../src/server/services/news-service";
import { getBankClient } from "../src/server/providers/provider-factory";
import type { ILlmProvider } from "../src/server/providers/llm-provider";
import type { AiProvider } from "../src/lib/types";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-trading.ts deseni. */
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
 * Mock LLM provider — yalnızca bu script'te tanımlıdır (verify-auto-trade
 * deseni). Kuyruktan sırayla önceden belirlenmiş ham yanıtlar döndürür;
 * ILlmProvider sözleşmesini birebir uygular.
 */
class MockLlmProvider implements ILlmProvider {
  readonly providerId: AiProvider = "GEMINI";
  readonly model = "mock-e2e-model";
  private readonly queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async generateStructured(
    _prompt: string,
    _systemPrompt: string,
  ): Promise<string> {
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("Mock yanıt kuyruğu tükendi — beklenmedik ek LLM çağrısı.");
    }
    return next;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock sağlayıcı: bağlantı her zaman başarılı." };
  }
}

// --- Sabitler ve temizlik durumu (her çıkış yolunda geri yüklenir).
const TEST_SYMBOL = "E2ETK";        // tick → haber → AI → otomatik döngü sembolü
const LIVE_STOCK_SYMBOL = "E2ETS";  // LIVE'da STOCK reddi testi sembolü
const REQ_PREFIX = "e2e-test-";
const CYCLE_PREFIX = "e2e-test-cycle";
const MOCK_TRY_ACCOUNT = "1234567"; // mock transport TRY hesap numarası
const MOCK_USD_ACCOUNT = "7654321"; // mock transport USD hesap numarası

const DENIZBANK_ENDPOINTS = [
  "GetAccountList",
  "GetAccountDetail",
  "GetCurrencyRateList",
  "ChangeExchange",
  "GetTransactionDetail",
] as const;

let testStart = new Date(0);
const testStockIds: string[] = [];
const testAccountIds: string[] = [];
let originalWatchlist: { id: string; autoAnalyze: boolean }[] = [];
let originalSettings: {
  tradingMode: string;
  liveModeConfirmedAt: Date | null;
  autoTradingEnabled: boolean;
  stopLossPercent: Prisma.Decimal;
  takeProfitPercent: Prisma.Decimal;
  minConfidenceThreshold: Prisma.Decimal;
  maxPositionValue: Prisma.Decimal;
  maxOpenPositions: number;
  dailyOrderBudget: Prisma.Decimal;
  cooldownMinutes: number;
  commissionRate: Prisma.Decimal;
} | null = null;

/** Test verilerini siler, ayarları ve watchlist bayraklarını geri yükler. */
async function cleanup(): Promise<void> {
  try {
    // Bekleyen ApiCallLog yazımlarını tamamla (fire-and-forget kuyruk) —
    // drain edilmezse kayıtlar silme işleminden sonra yazılıp kalabilir.
    await getBankClient().drainPendingLogs();

    // Emirler: CURRENCY emirlerinin stockId'si null'dur — clientRequestId
    // öneki onları yakalar; otomatik motor emirleri ("auto-e2e-test-…")
    // stockId üzerinden yakalanır (OR ile ikisi de kapsanır).
    await prisma.order.deleteMany({
      where: {
        OR: [
          { clientRequestId: { startsWith: REQ_PREFIX } },
          { stockId: { in: testStockIds } },
        ],
      },
    });

    for (const stockId of testStockIds) {
      await prisma.aiAnalysisLog.deleteMany({ where: { stockId } });
      await prisma.aiDecisionLog.deleteMany({ where: { stockId } });
      await prisma.newsArticle.deleteMany({ where: { stockId } });
      await prisma.priceHistory.deleteMany({ where: { stockId } });
      await prisma.watchlist.deleteMany({ where: { stockId } });
      await prisma.portfolio.deleteMany({ where: { stockId } });
    }
    if (testStockIds.length > 0) {
      await prisma.stock.deleteMany({ where: { id: { in: testStockIds } } });
    }

    for (const accountId of testAccountIds) {
      await prisma.accountTransaction.deleteMany({ where: { accountId } });
    }
    if (testAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: testAccountIds } } });
    }

    // Test döngüsü JobRun kayıtları (cycleId önekiyle ayıklanır).
    await prisma.jobRun.deleteMany({
      where: {
        jobType: AUTO_TRADE_JOB_TYPE,
        resultSummary: { contains: CYCLE_PREFIX },
      },
    });

    // Bu koşunun ürettiği DenizBank denetim kayıtları (mock çağrılar).
    await prisma.apiCallLog.deleteMany({
      where: {
        endpoint: { in: [...DENIZBANK_ENDPOINTS] },
        createdAt: { gte: testStart },
      },
    });

    for (const w of originalWatchlist) {
      await prisma.watchlist.update({
        where: { id: w.id },
        data: { autoAnalyze: w.autoAnalyze },
      });
    }

    if (originalSettings !== null) {
      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: originalSettings,
      });
    }
    console.log(
      "\nTemizlik: test sembolleri/hesapları/emirleri silindi, ayarlar geri yüklendi.",
    );
  } catch (error: unknown) {
    console.error("Temizlik sırasında hata:", errBrief(error));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("=== FAZ 6 — UÇTAN UCA SİSTEM SENARYOSU (mock banka) ===\n");
  testStart = new Date();

  // ============================================================
  // 0) Ortam temizliği: önceki (yarıda kalmış) koşu artıkları.
  // ============================================================
  for (const symbol of [TEST_SYMBOL, LIVE_STOCK_SYMBOL]) {
    const stale = await prisma.stock.findUnique({ where: { symbol } });
    if (stale) {
      await prisma.order.deleteMany({ where: { stockId: stale.id } });
      await prisma.aiAnalysisLog.deleteMany({ where: { stockId: stale.id } });
      await prisma.newsArticle.deleteMany({ where: { stockId: stale.id } });
      await prisma.priceHistory.deleteMany({ where: { stockId: stale.id } });
      await prisma.watchlist.deleteMany({ where: { stockId: stale.id } });
      await prisma.portfolio.deleteMany({ where: { stockId: stale.id } });
      await prisma.stock.delete({ where: { id: stale.id } });
    }
  }
  await prisma.order.deleteMany({
    where: { clientRequestId: { startsWith: REQ_PREFIX } },
  });
  const stalePaperAccounts = await prisma.account.findMany({
    where: {
      accountType: "PAPER",
      createdAt: { lt: new Date("2001-01-01T00:00:00.000Z") },
    },
    select: { id: true },
  });
  const staleLiveAccounts = await prisma.account.findMany({
    where: {
      accountType: "LIVE",
      bankAccountNumber: { in: [MOCK_TRY_ACCOUNT, MOCK_USD_ACCOUNT] },
    },
    select: { id: true },
  });
  for (const stale of [...stalePaperAccounts, ...staleLiveAccounts]) {
    await prisma.accountTransaction.deleteMany({ where: { accountId: stale.id } });
    await prisma.account.delete({ where: { id: stale.id } });
  }
  await prisma.jobRun.deleteMany({
    where: {
      jobType: AUTO_TRADE_JOB_TYPE,
      resultSummary: { contains: CYCLE_PREFIX },
    },
  });

  // ============================================================
  // 1) AdminSettings yedekle + test değerlerine ayarla.
  // ============================================================
  const settingsBefore = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  assert(settingsBefore !== null, "AdminSettings kaydı yok — önce seed çalıştırın.");
  originalSettings = {
    tradingMode: settingsBefore.tradingMode,
    liveModeConfirmedAt: settingsBefore.liveModeConfirmedAt,
    autoTradingEnabled: settingsBefore.autoTradingEnabled,
    stopLossPercent: settingsBefore.stopLossPercent,
    takeProfitPercent: settingsBefore.takeProfitPercent,
    minConfidenceThreshold: settingsBefore.minConfidenceThreshold,
    maxPositionValue: settingsBefore.maxPositionValue,
    maxOpenPositions: settingsBefore.maxOpenPositions,
    dailyOrderBudget: settingsBefore.dailyOrderBudget,
    cooldownMinutes: settingsBefore.cooldownMinutes,
    commissionRate: settingsBefore.commissionRate,
  };

  // Test eşikleri: SL %50 / TP %1000 — mevcut pozisyonların tetiklenmeyeceği
  // geniş sınırlar (aşağıdaki ön kontrol bunu garanti eder). TP %1000, gerçek
  // portföylerdeki olağan kâr oranlarının çok üzerinde bir üst sınırdır.
  // Damga bilinçli null'a çekilir: canlı mod guard testi damgasız ortam ister.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: {
      tradingMode: "PAPER",
      liveModeConfirmedAt: null,
      autoTradingEnabled: true,
      stopLossPercent: 50,
      takeProfitPercent: 1000,
      minConfidenceThreshold: 0.7,
      maxPositionValue: 20_000,
      maxOpenPositions: 20,
      dailyOrderBudget: 200_000,
      cooldownMinutes: 0,
      commissionRate: 0.1,
    },
  });

  // ============================================================
  // 2) Watchlist autoAnalyze bayraklarını yedekle + test süresince kapat.
  //    (Motor autoAnalyze=true olan TÜM kayıtları analiz eder; mock kuyruğu
  //    yalnızca test sembolü için yanıt içerir.)
  // ============================================================
  originalWatchlist = await prisma.watchlist.findMany({
    select: { id: true, autoAnalyze: true },
  });
  await prisma.watchlist.updateMany({ data: { autoAnalyze: false } });

  // ============================================================
  // 3) İzolasyon ön kontrolü: mevcut pozisyonlar test eşiklerini
  //    (SL 50 / TP 100) tetiklememeli — aksi halde koşu durdurulur.
  // ============================================================
  const existingPositions = await prisma.portfolio.findMany({
    where: { quantity: { gt: 0 } },
    select: { id: true, stockId: true, quantity: true, avgCost: true, totalCost: true },
  });
  for (const pos of existingPositions) {
    if (pos.avgCost.lessThanOrEqualTo(0)) continue;
    const stock = await prisma.stock.findUnique({
      where: { id: pos.stockId },
      select: { lastPrice: true },
    });
    if (stock === null || stock.lastPrice === null) continue;
    const change = stock.lastPrice.sub(pos.avgCost).div(pos.avgCost).mul(100);
    assert(
      change.greaterThan(-50) && change.lessThan(1000),
      `İzolasyon ön kontrolü: mevcut pozisyon (stockId=${pos.stockId}) ` +
        `%${change.toFixed(2)} değişimle test eşiklerini (SL 50/TP 1000) tetiklerdi — ` +
        "koşu durduruldu (kullanıcı verisi korunuyor).",
    );
  }

  // ============================================================
  // 4) Banka istemcisi: mock mod garantisi (gerçek bankaya istek YOK).
  // ============================================================
  const bankClient = getBankClient();
  const mockTransport = bankClient.mockTransport;
  assert(
    bankClient.isMockMode && mockTransport !== null,
    "DenizBank istemcisi mock modda DEĞİL — DENIZBANK_APP_KEY tanımlı görünüyor. " +
      "Bu script yalnızca mock modda çalışır; gerçek banka hesabına asla dokunmaz. " +
      "Test için .env içinde DENIZBANK_APP_KEY'i boş bırakın.",
  );
  mockTransport.reset(); // sayaçlar 0'dan → TransactionID'ler öngörülebilir.
  check(
    "Ortam: DenizBank istemcisi mock modda",
    true,
    "isMockMode=true — canlı emirler deterministik mock transport üzerinden gider",
  );

  // ============================================================
  // 5) Test ortamı: izole PAPER hesabı + izole semboller + izole haber.
  // ============================================================
  const paperAccount = await prisma.account.create({
    data: { accountType: "PAPER", currency: "TRY", balance: 100_000, totalBalance: 100_000 },
  });
  testAccountIds.push(paperAccount.id);
  // Servisler findFirst orderBy createdAt asc ile hesap seçer — test hesabı
  // en eski tarihle öne çekilir (verify-trading.ts deseni).
  await prisma.account.update({
    where: { id: paperAccount.id },
    data: { createdAt: new Date("2000-01-01T00:00:00.000Z") },
  });
  const summaryProbe = await getAccountSummary();
  assert(
    summaryProbe.accountId === paperAccount.id,
    "Test PAPER hesabı servis tarafından seçilmedi (createdAt sıralaması).",
  );

  const mainStock = await prisma.stock.create({
    data: {
      symbol: TEST_SYMBOL,
      name: "E2E Test Hisse",
      sector: "E2ETest",
      lastPrice: 100,
      isActive: true, // tick motoru yalnızca aktif hisseleri işler
    },
  });
  const liveStock = await prisma.stock.create({
    data: {
      symbol: LIVE_STOCK_SYMBOL,
      name: "E2E Live Stock Reddi",
      sector: "E2ETest",
      lastPrice: 100,
      isActive: false, // tick/analiz kapsamı dışında
    },
  });
  testStockIds.push(mainStock.id, liveStock.id);

  await prisma.watchlist.create({
    data: { stockId: mainStock.id, autoAnalyze: true },
  });

  const newsArticle = await prisma.newsArticle.create({
    data: {
      title: "E2E Test: şirketten güçlü bilanço beklentisi",
      summary: "İzole test makalesi — analiz promptuna taşınması beklenir.",
      url: "https://e2e.test/haber-1",
      urlHash: createHash("sha256").update("https://e2e.test/haber-1").digest("hex"),
      source: "E2E-Test",
      publishedAt: new Date(),
      stockId: mainStock.id,
    },
  });

  // ============================================================
  // 6) TİCK — deterministik fiyat üretimi (seed'li PRNG).
  // ============================================================
  const tick1 = await runMarketTick({ seed: 424_242, symbols: [TEST_SYMBOL] });
  const tick2 = await runMarketTick({ seed: 424_242, symbols: [TEST_SYMBOL] });
  assert(tick1.processed === 1 && tick2.processed === 1, "Her tick 1 hisse işlemeli.");
  const stockAfterTicks = await prisma.stock.findUnique({
    where: { id: mainStock.id },
  });
  assert(
    stockAfterTicks !== null && stockAfterTicks.lastPrice !== null,
    "Tick sonrası güncel fiyat bulunamadı.",
  );
  const candles = await prisma.priceHistory.findMany({
    where: { stockId: mainStock.id },
    orderBy: { timestamp: "asc" },
  });
  const lastCandle = candles[candles.length - 1];
  assert(lastCandle !== undefined, "PriceHistory kaydı oluşmadı.");
  assert(
    stockAfterTicks !== null &&
      stockAfterTicks.lastPrice !== null &&
      lastCandle.close.equals(stockAfterTicks.lastPrice),
    "Son mum kapanışı Stock.lastPrice ile tutarlı olmalı.",
  );
  check(
    "Piyasa tick'i: fiyat + PriceHistory üretimi",
    candles.length === 2,
    `2 tick → ${candles.length} mum, son fiyat=${stockAfterTicks?.lastPrice?.toString() ?? "?"} TL`,
  );

  // ============================================================
  // 7) HABER — izole makale analiz context'ine girer.
  // ============================================================
  const newsForAnalysis = await getRecentNewsForAnalysis(mainStock.id, 10);
  const newsOk =
    newsForAnalysis.length >= 1 && newsForAnalysis.some((n) => n.id === newsArticle.id);
  check(
    "Haber akışı: makale analiz context'ine girer",
    newsOk,
    newsOk
      ? `"${(newsForAnalysis[0]?.title ?? "").slice(0, 40)}…" analiz promptuna taşınır`
      : "makale analiz context'inde bulunamadı",
  );

  // ============================================================
  // 8) AI ANALİZİ — mock LLM → AiAnalysisLog kaydı.
  // ============================================================
  const analysisMock = new MockLlmProvider([
    '{"action":"BUY","confidence":0.9,"reasoning":"E2E mock: güçlü alım sinyali."}',
  ]);
  const analysis = await analyzeStock(TEST_SYMBOL, {
    skipCooldown: true,
    llmProvider: analysisMock,
  });
  assert(analysis.action === "BUY", "Mock analiz BUY dönmeli.");
  assert(
    new Prisma.Decimal(analysis.confidence).equals(new Prisma.Decimal("0.9")),
    "Mock analiz güven skoru 0.9 olmalı.",
  );
  check(
    "AI analizi: LLM kararı AiAnalysisLog'a yazılır",
    true,
    `action=${analysis.action}, güven=${analysis.confidence}, model=${analysis.model}`,
  );

  // ============================================================
  // 9) OTOMATİK DÖNGÜ — AI BUY sinyali → emir → pozisyon.
  // ============================================================
  const MAIN_CYCLE_ID = `${CYCLE_PREFIX}-main`;
  const cycleMock = new MockLlmProvider([
    '{"action":"BUY","confidence":0.9,"reasoning":"E2E döngü: alım sinyali."}',
  ]);
  const cycle = await runAutoTradeCycle({
    cycleId: MAIN_CYCLE_ID,
    llmProvider: cycleMock,
    skipCooldown: true,
  });
  const cs = cycle.summary;
  assert(!cs.skipped, "Ana döngü skipped olmamalı.");
  assert(cycle.status === "SUCCESS", "Ana döngü SUCCESS olmalı.");
  assert(cs.analysesRun === 1, "Döngü yalnızca E2ETK'i analiz etmeli (1 analiz).");
  assert(cs.ordersPlaced === 1 && cs.ordersFilled === 1, "Döngü 1 emir verip doldurmalı.");
  assert(
    cs.stopLossTriggered === 0 && cs.takeProfitTriggered === 0,
    "Test eşiklerinde SL/TP tetiklenmemeli.",
  );
  assert(cs.errors.length === 0, `Döngü hata üretmemeli: ${cs.errors.join(" | ")}`);

  const autoOrder = await prisma.order.findFirst({
    where: { stockId: mainStock.id, source: "AUTO_ENGINE" },
  });
  assert(autoOrder !== null, "Otomatik emir kaydı bulunamadı.");
  assert(autoOrder.status === "FILLED", "Otomatik emir FILLED olmalı.");
  assert(autoOrder.analysisLogId !== null, "Otomatik emir analiz kaydına bağlı olmalı.");
  const autoPosition = await prisma.portfolio.findUnique({
    where: { stockId: mainStock.id },
  });
  assert(
    autoPosition !== null && autoPosition.quantity.greaterThan(0),
    "AI BUY sonrası pozisyon açılmalı.",
  );
  check(
    "Otomatik döngü: AI sinyali → emir → pozisyon",
    true,
    `${autoPosition?.quantity.toFixed(0)} lot, source=AUTO_ENGINE, analysisLogId bağlı`,
  );

  // ============================================================
  // 10) PORTFÖY — pozisyon + bakiye görünümü.
  // ============================================================
  const portfolio = await getPortfolio();
  const e2ePosition = portfolio.positions.find((p) => p.symbol === TEST_SYMBOL);
  assert(e2ePosition !== undefined, "Portföy görünümünde E2ETK pozisyonu olmalı.");
  const summaryAfterCycle = await getAccountSummary();
  const cashAfterCycle = new Prisma.Decimal(summaryAfterCycle.cashBalance);
  assert(
    cashAfterCycle.lessThan(new Prisma.Decimal(100_000)),
    "Otomatik alım bakiyeyi düşürmeli.",
  );
  check(
    "Portföy görünümü: pozisyon + bakiye",
    true,
    `pozisyon=${e2ePosition?.quantity} lot, kalan bakiye=${cashAfterCycle.toFixed(2)} TL`,
  );

  // ============================================================
  // 11) LIVE'A GEÇİŞ — canlı mod guard'ı (damga yokken reddi).
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "LIVE" },
  });

  let guardRejected = false;
  let guardMessage = "";
  try {
    await placeOrder({
      side: "BUY",
      assetType: "CURRENCY",
      symbol: "USD",
      quantity: 1,
      clientRequestId: `${REQ_PREFIX}guard`,
    });
  } catch (error: unknown) {
    if (error instanceof TradingError && error.code === "LIVE_MODE_NOT_CONFIRMED") {
      guardRejected = true;
      guardMessage = error.message;
    } else {
      throw error;
    }
  }
  assert(guardRejected, "Damgasız canlı emir LIVE_MODE_NOT_CONFIRMED ile reddedilmeli.");
  const guardOrderCount = await prisma.order.count({
    where: { clientRequestId: `${REQ_PREFIX}guard` },
  });
  assert(guardOrderCount === 0, "Guard reddinde emir KAYDI oluşmamalı.");
  check(
    "Canlı mod guard'ı: liveModeConfirmedAt olmadan emir reddi",
    true,
    `403 LIVE_MODE_NOT_CONFIRMED — "${guardMessage.slice(0, 50)}…"`,
  );

  // ============================================================
  // 12) LIVE'da otomatik döngü — güvenlik gereği atlanır.
  // ============================================================
  const liveCycle = await runAutoTradeCycle({
    cycleId: `${CYCLE_PREFIX}-live`,
  });
  assert(liveCycle.summary.skipped, "LIVE modda otomatik döngü atlanmalı.");
  assert(
    (liveCycle.summary.skipReason ?? "").includes("LIVE"),
    "Atlama nedeni LIVE mod kısıtını belirtmeli.",
  );
  check(
    "LIVE modda otomatik döngü devre dışı",
    true,
    `skipReason="${(liveCycle.summary.skipReason ?? "").slice(0, 60)}…"`,
  );

  // ============================================================
  // 13) Canlı onay damgası + LIVE hesapları.
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { liveModeConfirmedAt: new Date() },
  });

  const liveTryAccount = await prisma.account.create({
    data: {
      accountType: "LIVE",
      currency: "TRY",
      balance: 50_000,
      totalBalance: 50_000,
      bankAccountNumber: MOCK_TRY_ACCOUNT,
    },
  });
  const liveUsdAccount = await prisma.account.create({
    data: {
      accountType: "LIVE",
      currency: "USD",
      balance: 2_000,
      totalBalance: 2_000,
      bankAccountNumber: MOCK_USD_ACCOUNT,
    },
  });
  testAccountIds.push(liveTryAccount.id, liveUsdAccount.id);

  // ============================================================
  // 14) LIVE'da STOCK emri — bankada endpoint yok → REJECTED.
  // ============================================================
  const liveStockOrder = await placeOrder({
    side: "BUY",
    symbol: LIVE_STOCK_SYMBOL,
    quantity: 1,
    clientRequestId: `${REQ_PREFIX}live-stock`,
  });
  assert(liveStockOrder.order.status === "REJECTED", "LIVE'da STOCK emri reddedilmeli.");
  const liveStockRow = await prisma.order.findUnique({
    where: { clientRequestId: `${REQ_PREFIX}live-stock` },
  });
  assert(
    liveStockRow !== null && liveStockRow.errorCode === "LIVE_STOCK_NOT_SUPPORTED",
    "STOCK reddi LIVE_STOCK_NOT_SUPPORTED kodunu taşımalı.",
  );
  check(
    "LIVE'da hisse emri desteklenmez",
    true,
    `REJECTED — ${liveStockRow?.errorCode}: banka yalnızca ChangeExchange sunar`,
  );

  // ============================================================
  // 15) CANLI ALIM — 100 USD @ 34.50 (mock satış kuru) = 3.450 TL.
  // ============================================================
  const liveBuy = await placeOrder({
    side: "BUY",
    assetType: "CURRENCY",
    symbol: "USD",
    quantity: 100,
    clientRequestId: `${REQ_PREFIX}live-buy`,
  });
  assert(liveBuy.order.status === "FILLED", "Canlı USD alımı FILLED olmalı.");
  const liveBuyRow = await prisma.order.findUnique({
    where: { clientRequestId: `${REQ_PREFIX}live-buy` },
  });
  assert(liveBuyRow !== null, "Canlı alım emri kaydı bulunamadı.");
  assert(liveBuyRow.assetType === "CURRENCY", "Canlı emir CURRENCY türünde olmalı.");
  assert(liveBuyRow.stockId === null, "CURRENCY emrinin stockId'si null olmalı.");
  assert(liveBuyRow.symbol === "USD", "Denormalize sembol USD olmalı.");
  assert(
    liveBuyRow.transactionId === "MOCKTX000001",
    `Mutabakat TransactionID beklenen=MOCKTX000001, gelen=${liveBuyRow.transactionId ?? "yok"}`,
  );
  assert(
    liveBuyRow.sessionId === "MOCKSS000001",
    `Mutabakat SessionID beklenen=MOCKSS000001, gelen=${liveBuyRow.sessionId ?? "yok"}`,
  );
  assert(
    liveBuyRow.filledPrice !== null &&
      liveBuyRow.filledPrice.equals(new Prisma.Decimal("34.5")),
    "Alım fiyatı mock satış kuru 34.50 olmalı.",
  );
  assert(
    liveBuyRow.filledValue !== null &&
      liveBuyRow.filledValue.equals(new Prisma.Decimal("3450")),
    "Alım tutarı 3.450 TL olmalı.",
  );
  assert(
    liveBuyRow.commission !== null && liveBuyRow.commission.equals(new Prisma.Decimal(0)),
    "Canlı döviz işleminde komisyon 0 olmalı.",
  );
  check(
    "Canlı ALIM (USD): FILLED + mutabakat alanları",
    true,
    `TX=${liveBuyRow.transactionId}, SS=${liveBuyRow.sessionId}, ` +
      `fiyat=${liveBuyRow.filledPrice?.toString()}, tutar=${liveBuyRow.filledValue?.toString()} TL`,
  );

  // --- Muhasebe: DB LIVE hesapları + mock banka bakiyeleri + hareketler.
  const dbTryAfterBuy = await prisma.account.findUnique({
    where: { id: liveTryAccount.id },
  });
  const dbUsdAfterBuy = await prisma.account.findUnique({
    where: { id: liveUsdAccount.id },
  });
  assert(dbTryAfterBuy !== null && dbUsdAfterBuy !== null, "LIVE hesapları bulunamadı.");
  assert(
    dbTryAfterBuy.balance.equals(new Prisma.Decimal("46550")),
    `DB TRY bakiye 46.550 olmalı, gelen=${dbTryAfterBuy.balance.toString()}`,
  );
  assert(
    dbUsdAfterBuy.balance.equals(new Prisma.Decimal("2100")),
    `DB USD bakiye 2.100 olmalı, gelen=${dbUsdAfterBuy.balance.toString()}`,
  );
  const mockAccountsAfterBuy = mockTransport.getAccounts();
  const mockTryAfterBuy = mockAccountsAfterBuy.find((a) => a.CurrencyCode === "TRY");
  const mockUsdAfterBuy = mockAccountsAfterBuy.find((a) => a.CurrencyCode === "USD");
  assert(mockTryAfterBuy !== undefined && mockUsdAfterBuy !== undefined, "Mock hesapları eksik.");
  const mockAccountingOk =
    Math.abs(mockTryAfterBuy.AvailableBalance - 46_550) < 0.01 &&
    Math.abs(mockUsdAfterBuy.AvailableBalance - 2_100) < 0.01;
  assert(mockAccountingOk, "Mock banka bakiyeleri alım sonrası tutarlı değil.");
  const liveTxnsAfterBuy = await prisma.accountTransaction.count({
    where: { orderId: liveBuyRow.id },
  });
  assert(liveTxnsAfterBuy === 2, "Alım 2 hesap hareketi üretmeli (TRY − ve USD +).");
  check(
    "Canlı ALIM muhasebesi: DB + mock bakiye + hareket kayıtları",
    true,
    `DB TRY=${dbTryAfterBuy.balance.toString()}, USD=${dbUsdAfterBuy.balance.toString()}; ` +
      `mock TRY=${mockTryAfterBuy.AvailableBalance}, USD=${mockUsdAfterBuy.AvailableBalance}`,
  );

  // ============================================================
  // 16) CANLI SATIM — 50 USD @ 34.20 (mock alış kuru) = 1.710 TL.
  // ============================================================
  const liveSell = await placeOrder({
    side: "SELL",
    assetType: "CURRENCY",
    symbol: "USD",
    quantity: 50,
    clientRequestId: `${REQ_PREFIX}live-sell`,
  });
  assert(liveSell.order.status === "FILLED", "Canlı USD satımı FILLED olmalı.");
  const liveSellRow = await prisma.order.findUnique({
    where: { clientRequestId: `${REQ_PREFIX}live-sell` },
  });
  assert(liveSellRow !== null, "Canlı satım emri kaydı bulunamadı.");
  assert(
    liveSellRow.transactionId === "MOCKTX000002" && liveSellRow.sessionId === "MOCKSS000002",
    "Satım mutabakat referansları MOCKTX000002/MOCKSS000002 olmalı.",
  );
  assert(
    liveSellRow.filledValue !== null &&
      liveSellRow.filledValue.equals(new Prisma.Decimal("1710")),
    "Satım tutarı 1.710 TL olmalı.",
  );
  const dbTryAfterSell = await prisma.account.findUnique({
    where: { id: liveTryAccount.id },
  });
  const dbUsdAfterSell = await prisma.account.findUnique({
    where: { id: liveUsdAccount.id },
  });
  assert(dbTryAfterSell !== null && dbUsdAfterSell !== null, "LIVE hesapları bulunamadı.");
  assert(
    dbTryAfterSell.balance.equals(new Prisma.Decimal("48260")),
    `DB TRY bakiye satım sonrası 48.260 olmalı, gelen=${dbTryAfterSell.balance.toString()}`,
  );
  assert(
    dbUsdAfterSell.balance.equals(new Prisma.Decimal("2050")),
    `DB USD bakiye satım sonrası 2.050 olmalı, gelen=${dbUsdAfterSell.balance.toString()}`,
  );
  check(
    "Canlı SATIM (USD): FILLED + mutabakat + muhasebe",
    true,
    `TX=${liveSellRow.transactionId}, DB TRY=${dbTryAfterSell.balance.toString()}, ` +
      `USD=${dbUsdAfterSell.balance.toString()}`,
  );

  // ============================================================
  // 17) APICALLLOG — canlı emirlerin denetim izi.
  // ============================================================
  // Fire-and-forget log kuyruğu: sayım öncesi yazımların bitmesini bekle.
  await bankClient.drainPendingLogs();
  const changeExchangeLogs = await prisma.apiCallLog.count({
    where: { endpoint: "ChangeExchange", createdAt: { gte: testStart } },
  });
  assert(changeExchangeLogs >= 2, "Canlı emirler ApiCallLog'a yazılmalı (≥2 ChangeExchange).");
  check(
    "ApiCallLog denetim izi",
    true,
    `${changeExchangeLogs} ChangeExchange kaydı (AppKey maskelemesi verify-denizbank kapsamı)`,
  );

  // ============================================================
  // 18) PAPER'A DÖNÜŞ — paper motor yeniden devrede.
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "PAPER" },
  });

  const paperReturn = await placeOrder({
    side: "SELL",
    symbol: TEST_SYMBOL,
    quantity: 10,
    clientRequestId: `${REQ_PREFIX}paper-return`,
  });
  assert(paperReturn.order.status === "FILLED", "PAPER'a dönüş satımı FILLED olmalı.");
  assert(
    paperReturn.order.commission !== null &&
      new Prisma.Decimal(paperReturn.order.commission).greaterThan(0),
    "Paper emirde komisyon > 0 olmalı (canlıda 0'dı) — motor ayrımı kanıtı.",
  );
  check(
    "PAPER'a dönüş: paper motor yeniden aktif",
    true,
    `10 lot satım FILLED, komisyon=${paperReturn.order.commission} TL (canlıda 0 idi)`,
  );

  // ============================================================
  // 19) İzolasyon kanıtı: mevcut pozisyonlar değişmedi.
  // ============================================================
  const existingAfter = await prisma.portfolio.findMany({
    where: { id: { in: existingPositions.map((p) => p.id) } },
    select: { id: true, quantity: true, avgCost: true, totalCost: true },
  });
  const isolationOk = existingPositions.every((before) => {
    const after = existingAfter.find((p) => p.id === before.id);
    return (
      after !== undefined &&
      after.quantity.equals(before.quantity) &&
      after.avgCost.equals(before.avgCost) &&
      after.totalCost.equals(before.totalCost)
    );
  });
  assert(isolationOk, "Mevcut pozisyonlar E2E koşusundan etkilenmemeli.");
  check(
    "İzolasyon: mevcut pozisyonlar değişmedi",
    true,
    `${existingPositions.length} mevcut pozisyon sabit kaldı`,
  );

  // ============================================================
  // Özet rapor.
  // ============================================================
  console.log("\n--- ÖZET ---");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} doğrulama başarılı.`);
  if (failed.length > 0) {
    console.log("Başarısız doğrulamalar:");
    for (const f of failed) {
      console.log(`  ✗ ${f.name} — ${f.detail}`);
    }
    throw new Error(`${failed.length} doğrulama başarısız.`);
  }
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("\nDOĞRULAMA BAŞARISIZ:", errBrief(error));
    await cleanup();
    process.exit(1);
  });
