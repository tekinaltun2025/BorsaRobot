/**
 * Faz 5 uçtan uca doğrulama scripti — Otomatik Alım-Satım Motoru (mock LLM).
 *
 * Kullanım: npx tsx scripts/verify-auto-trade.ts  (veya npm run verify:auto-trade)
 *
 * API key GEREKMEZ: tüm AI analiz çağrıları bu script içinde tanımlı mock
 * LLM provider ile simüle edilir (mock yalnızca test script'inde yaşar —
 * production koduna girmez).
 *
 * Doğrulanan akışlar:
 *  1. autoTradingEnabled=false → döngü no-op (skipped + neden, emir yok).
 *  2. tradingMode=LIVE → otomatik döngü güvenlik gereği atlanır (Faz 5 kısıtı).
 *  3. Stop-loss tetikleme: eşik aşımı → otomatik SATIM (tüm lot).
 *  4. Take-profit tetikleme: eşik aşımı → otomatik SATIM (tüm lot).
 *  5. AI BUY sinyali (güven 0.9 ≥ eşik 0.7) → otomatik ALIM (risk limitli lot).
 *  6. Eşik altı güven (0.3 < 0.7) → emir üretilmez.
 *  7. HOLD kararı → emir üretilmez.
 *  8. Order.source ayrımı: manuel emirler MANUAL, motor emirleri AUTO_ENGINE.
 *  9. JobRun denetim kaydı: status + resultSummary istatistikleri.
 * 10. Idempotency: aynı cycleId ile ikinci koşu → clientRequestId replay;
 *     yeni emir/pozisyon/bakiye değişimi YOK.
 * 11. listRecentAutoTradeRuns: son döngüler özetle listelenir.
 *
 * İzolasyon: script kendi sembollerini (ATSL/ATPP/ATBUY/ATLOW/ATHLD/ATID),
 * kendi PAPER hesabını ve kendi cycleId'lerini (at-test-cycle-*) oluşturur.
 * Mevcut watchlist autoAnalyze bayrakları test süresince kapatılır ve koşu
 * sonunda geri yüklenir; mevcut pozisyonların değişmediği hem ön kontrolle
 * hem koşu sonrası assert'le kanıtlanır. Sonunda tüm test verileri temizlenir.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  AUTO_TRADE_JOB_TYPE,
  listRecentAutoTradeRuns,
  runAutoTradeCycle,
} from "../src/server/services/auto-trade-service";
import { placeOrder } from "../src/server/services/trading-service";
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
 * Mock LLM provider — yalnızca bu script'te tanımlıdır.
 * Kuyruktan sırayla önceden belirlenmiş ham yanıtlar döndürür;
 * ILlmProvider sözleşmesini birebir uygular (verify-ai.ts deseni).
 */
class MockLlmProvider implements ILlmProvider {
  readonly providerId: AiProvider = "GEMINI";
  readonly model = "mock-auto-trade-model";
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

// --- Temizlik durumu (her çıkış yolunda geri yüklenir).
const TEST_SYMBOLS = ["ATSL", "ATPP", "ATBUY", "ATLOW", "ATHLD", "ATID"] as const;
const TEST_CYCLE_PREFIX = "at-test-cycle";

const testStockIds: string[] = [];
const testAccountIds: string[] = [];
let originalWatchlist: { id: string; autoAnalyze: boolean }[] = [];
let originalSettings: {
  tradingMode: "PAPER" | "LIVE";
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
    for (const stockId of testStockIds) {
      await prisma.order.deleteMany({ where: { stockId } });
      await prisma.aiAnalysisLog.deleteMany({ where: { stockId } });
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
      await prisma.account.deleteMany({ where: { id: accountId } });
    }

    // Test döngüsü JobRun kayıtları (cycleId önekine göre ayıklanır).
    await prisma.jobRun.deleteMany({
      where: {
        jobType: AUTO_TRADE_JOB_TYPE,
        resultSummary: { contains: TEST_CYCLE_PREFIX },
      },
    });

    // Test döngüsünün ürettiği AI karar kayıtları (AT* test sembolleri).
    // Bu kayıtlar silinmezse verify:ai-decisions'ın "bağlam karar sayısı"
    // kontrolü (contextCount === 4) kalan kayıtlar yüzünden kırılıyordu.
    await prisma.aiDecisionLog.deleteMany({
      where: { symbol: { startsWith: "AT" } },
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
      "\nTemizlik: test sembolleri/hesabı/döngü kayıtları silindi, ayarlar geri yüklendi.",
    );
  } catch (error: unknown) {
    console.error("Temizlik sırasında hata:", errBrief(error));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("=== FAZ 5 — OTOMATİK ALIM-SATIM MOTORU DOĞRULAMA (mock) ===\n");

  // ============================================================
  // 0) Ortam temizliği: önceki (yarıda kalmış) koşu artıkları.
  // ============================================================
  for (const symbol of TEST_SYMBOLS) {
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
  const staleAccounts = await prisma.account.findMany({
    where: {
      accountType: "PAPER",
      createdAt: { lt: new Date("2001-01-01T00:00:00.000Z") },
    },
    select: { id: true },
  });
  for (const stale of staleAccounts) {
    await prisma.accountTransaction.deleteMany({ where: { accountId: stale.id } });
    await prisma.account.delete({ where: { id: stale.id } });
  }
  await prisma.jobRun.deleteMany({
    where: {
      jobType: AUTO_TRADE_JOB_TYPE,
      resultSummary: { contains: TEST_CYCLE_PREFIX },
    },
  });

  // ============================================================
  // 1) AdminSettings yedekle + test değerlerine ayarla.
  // ============================================================
  const settingsBefore = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  assert(settingsBefore !== null, "AdminSettings kaydı yok — önce seed çalıştırın.");
  assert(
    settingsBefore.tradingMode === "PAPER" || settingsBefore.tradingMode === "LIVE",
    `Beklenmedik tradingMode değeri: ${settingsBefore.tradingMode}`,
  );
  originalSettings = {
    tradingMode: settingsBefore.tradingMode,
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
  // portföylerdeki olağan kâr oranlarının çok üzerinde bir üst sınırdır;
  // SL %50 de olağan zararların altında kalır.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: {
      tradingMode: "PAPER",
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
  //    yalnızca test sembolleri için yanıt içerir.)
  // ============================================================
  originalWatchlist = await prisma.watchlist.findMany({
    select: { id: true, autoAnalyze: true },
  });
  await prisma.watchlist.updateMany({ data: { autoAnalyze: false } });

  // ============================================================
  // 3) İzolasyon: mevcut pozisyonların anlık görüntüsü + ön kontrol.
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
  // 4) Test ortamı: izole PAPER hesabı + izole semboller.
  // ============================================================
  const account = await prisma.account.create({
    data: { accountType: "PAPER", currency: "TRY", balance: 100_000, totalBalance: 100_000 },
  });
  testAccountIds.push(account.id);
  // Servisler findFirst orderBy createdAt asc ile hesap seçer — test hesabı
  // en eski tarihle öne çekilir (verify-trading.ts deseni).
  await prisma.account.update({
    where: { id: account.id },
    data: { createdAt: new Date("2000-01-01T00:00:00.000Z") },
  });

  const stockDefs: { symbol: string; name: string }[] = [
    { symbol: "ATSL", name: "Auto Test Stop-Loss" },
    { symbol: "ATPP", name: "Auto Test Take-Profit" },
    { symbol: "ATBUY", name: "Auto Test AI Buy" },
    { symbol: "ATLOW", name: "Auto Test Low Confidence" },
    { symbol: "ATHLD", name: "Auto Test Hold" },
    { symbol: "ATID", name: "Auto Test Idempotency" },
  ];
  const stockIdBySymbol: Record<string, string> = {};
  for (const def of stockDefs) {
    const stock = await prisma.stock.create({
      data: {
        symbol: def.symbol,
        name: def.name,
        sector: "OtomatikTest",
        lastPrice: 100,
        isActive: false,
      },
    });
    stockIdBySymbol[def.symbol] = stock.id;
    testStockIds.push(stock.id);
  }
  // Record index erişimi TS'te string | undefined döner — assert ile sabitlenir.
  const stockId = (symbol: string): string => {
    const id = stockIdBySymbol[symbol];
    assert(id !== undefined, `Test sembolü ${symbol} oluşturulamadı.`);
    return id;
  };
  const allTestStockIds = Object.values(stockIdBySymbol);

  // Watchlist: analiz senaryoları autoAnalyze=true; SL/TP/idempotency
  // sembolleri false (mock kuyruğu yalnızca analiz sembolleri için).
  for (const symbol of ["ATSL", "ATPP", "ATID"]) {
    await prisma.watchlist.create({
      data: { stockId: stockId(symbol), autoAnalyze: false },
    });
  }
  for (const symbol of ["ATBUY", "ATLOW", "ATHLD"]) {
    await prisma.watchlist.create({
      data: { stockId: stockId(symbol), autoAnalyze: true },
    });
  }

  // ============================================================
  // 5) Manuel pozisyonlar (placeOrder ile — source=MANUAL kanıtı).
  //    100 lot × 100 TL = 10.000 TL + %0,1 komisyon.
  // ============================================================
  for (const symbol of ["ATSL", "ATPP", "ATID"]) {
    const buy = await placeOrder({
      side: "BUY",
      symbol,
      quantity: 100,
      clientRequestId: `at-test-manual-${symbol}`,
    });
    assert(buy.order.status === "FILLED", `${symbol} manuel alımı gerçekleşmeli.`);
    assert(buy.order.source === "MANUAL", `${symbol} manuel emri MANUAL kaynaklı olmalı.`);
  }

  // Fiyat senaryoları:
  //  ATSL 100 → 40   (-%60 ≤ -%50 → SL tetikler)
  //  ATPP 100 → 1200 (+%1100 ≥ +%1000 → TP tetikler)
  //  ATID 100 → 40   (-%60 → SL tetikler; idempotency döngüsü)
  //  ATBUY/ATLOW/ATHLD 100 kalır (AI alım/skip senaryoları).
  await prisma.stock.update({ where: { id: stockIdBySymbol["ATSL"] }, data: { lastPrice: 40 } });
  await prisma.stock.update({ where: { id: stockIdBySymbol["ATPP"] }, data: { lastPrice: 1200 } });
  await prisma.stock.update({ where: { id: stockIdBySymbol["ATID"] }, data: { lastPrice: 40 } });

  // ============================================================
  // TEST 1 — autoTradingEnabled=false → döngü no-op.
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { autoTradingEnabled: false },
  });
  const disabledResult = await runAutoTradeCycle({
    cycleId: `${TEST_CYCLE_PREFIX}-disabled`,
  });
  assert(disabledResult.summary.skipped, "Kapalı motorda döngü atlanmalı.");
  assert(
    (disabledResult.summary.skipReason ?? "").includes("autoTradingEnabled"),
    "Atlama nedeni autoTradingEnabled'i belirtmeli.",
  );
  const ordersAfterDisabled = await prisma.order.count({
    where: { stockId: { in: allTestStockIds } },
  });
  assert(ordersAfterDisabled === 3, "Kapalı motorda yeni emir oluşmamalı (3 manuel alım).");
  check(
    "Kapalı motor (autoTradingEnabled=false) → döngü no-op",
    true,
    `skipReason="${disabledResult.summary.skipReason}", toplam emir=${ordersAfterDisabled}`,
  );

  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { autoTradingEnabled: true },
  });

  // ============================================================
  // TEST 2 — tradingMode=LIVE → güvenlik gereği atlanır (Faz 5 kısıtı).
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "LIVE" },
  });
  const liveResult = await runAutoTradeCycle({
    cycleId: `${TEST_CYCLE_PREFIX}-live`,
  });
  assert(liveResult.summary.skipped, "LIVE modda otomatik döngü atlanmalı.");
  assert(
    (liveResult.summary.skipReason ?? "").includes("LIVE"),
    "Atlama nedeni LIVE mod kısıtını belirtmeli.",
  );
  check(
    "LIVE mod → otomatik döngü güvenlik gereği atlanır",
    true,
    `skipReason="${(liveResult.summary.skipReason ?? "").slice(0, 70)}…"`,
  );

  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "PAPER" },
  });

  // ============================================================
  // TEST 3 — Ana döngü: SL + TP + AI BUY + eşik altı + HOLD.
  // ============================================================
  const MAIN_CYCLE_ID = `${TEST_CYCLE_PREFIX}-main`;
  // Mock kuyruğu watchlist createdAt asc sırasına göre: ATBUY, ATLOW, ATHLD.
  const mainMock = new MockLlmProvider([
    '{"action":"BUY","confidence":0.9,"reasoning":"Güçlü alım sinyali — mock analiz."}',
    '{"action":"BUY","confidence":0.3,"reasoning":"Zayıf sinyal — eşik altı güven."}',
    '{"action":"HOLD","confidence":0.9,"reasoning":"Beklemede kal — mock analiz."}',
  ]);
  const mainResult = await runAutoTradeCycle({
    cycleId: MAIN_CYCLE_ID,
    llmProvider: mainMock,
  });
  const ms = mainResult.summary;
  assert(!ms.skipped, "Ana döngü skipped olmamalı.");
  assert(mainResult.status === "SUCCESS", "Ana döngü SUCCESS olmalı.");

  // --- Stop-loss: ATSL tüm lotu satıldı.
  const atslPos = await prisma.portfolio.findUnique({
    where: { stockId: stockIdBySymbol["ATSL"] },
  });
  assert(atslPos !== null && atslPos.quantity.equals(0), "ATSL pozisyonu SL ile kapanmalı.");
  check(
    "Stop-loss tetikleme: ATSL otomatik satıldı",
    true,
    `SL sayacı=${ms.stopLossTriggered}, pozisyon=0 lot`,
  );

  // --- Take-profit: ATPP tüm lotu satıldı.
  const atppPos = await prisma.portfolio.findUnique({
    where: { stockId: stockIdBySymbol["ATPP"] },
  });
  assert(atppPos !== null && atppPos.quantity.equals(0), "ATPP pozisyonu TP ile kapanmalı.");
  check(
    "Take-profit tetikleme: ATPP otomatik satıldı",
    true,
    `TP sayacı=${ms.takeProfitTriggered}, pozisyon=0 lot`,
  );

  // --- AI BUY: ATBUY risk limiti içinde alındı (20.000 TL / 100 TL = 200 lot).
  const atbuyPos = await prisma.portfolio.findUnique({
    where: { stockId: stockIdBySymbol["ATBUY"] },
  });
  assert(
    atbuyPos !== null && atbuyPos.quantity.equals(200),
    `ATBUY pozisyonu AI sinyaliyle 200 lot açılmalı (gelen: ${atbuyPos?.quantity.toString() ?? "yok"}).`,
  );
  const atbuyAutoOrders = await prisma.order.count({
    where: { stockId: stockIdBySymbol["ATBUY"], side: "BUY", source: "AUTO_ENGINE" },
  });
  assert(atbuyAutoOrders === 1, "ATBUY için tek otomatik alım emri olmalı.");
  check(
    "AI BUY sinyali (güven 0.9 ≥ eşik 0.7) → otomatik alım",
    true,
    "200 lot alındı (maxPositionValue=20.000 TL limiti içinde)",
  );

  // --- Eşik altı güven: ATLOW için emir yok.
  const atlowAutoOrders = await prisma.order.count({
    where: { stockId: stockIdBySymbol["ATLOW"], source: "AUTO_ENGINE" },
  });
  assert(atlowAutoOrders === 0, "Eşik altı güven (0.3) emir üretmemeli.");
  check("Eşik altı güven (0.3 < 0.7) → emir yok", true, "ATLOW için otomatik emir 0");

  // --- HOLD kararı: ATHLD için emir yok.
  const athldAutoOrders = await prisma.order.count({
    where: { stockId: stockIdBySymbol["ATHLD"], source: "AUTO_ENGINE" },
  });
  assert(athldAutoOrders === 0, "HOLD kararı emir üretmemeli.");
  check("HOLD kararı → emir yok", true, "ATHLD için otomatik emir 0");

  // --- Döngü özet istatistikleri.
  assert(
    ms.positionsChecked === existingPositions.length + 3,
    `Taranan pozisyon=${ms.positionsChecked} olmalı (3 test + ${existingPositions.length} mevcut).`,
  );
  assert(ms.stopLossTriggered === 2, "2 SL tetiklenmeli (ATSL + ATID).");
  assert(ms.takeProfitTriggered === 1, "1 TP tetiklenmeli (ATPP).");
  assert(ms.analysesRun === 3, "3 AI analiz çalışmalı (ATBUY/ATLOW/ATHLD).");
  assert(ms.ordersPlaced === 4, "4 emir verilmeli (2 SL + 1 TP + 1 AI BUY).");
  assert(ms.ordersFilled === 4, "4 emir FILLED olmalı.");
  assert(ms.errors.length === 0, "Ana döngüde hata olmamalı.");
  check(
    "Döngü özet istatistikleri doğru",
    true,
    `pozisyon=${ms.positionsChecked}, SL=${ms.stopLossTriggered}, TP=${ms.takeProfitTriggered}, ` +
      `analiz=${ms.analysesRun}, emir=${ms.ordersPlaced} (FILLED=${ms.ordersFilled}), hata=${ms.errors.length}`,
  );

  // --- JobRun denetim kaydı.
  const mainJobRun = await prisma.jobRun.findUnique({
    where: { id: mainResult.jobRunId },
  });
  assert(mainJobRun !== null, "Ana döngü JobRun kaydı bulunmalı.");
  assert(mainJobRun.jobType === AUTO_TRADE_JOB_TYPE, "JobRun türü AUTO_TRADE_CYCLE olmalı.");
  assert(mainJobRun.status === "SUCCESS", "JobRun durumu SUCCESS olmalı.");
  assert(mainJobRun.finishedAt !== null, "JobRun bitiş zamanı yazılmalı.");
  const mainRunSummary = JSON.parse(mainJobRun.resultSummary ?? "{}") as {
    cycleId?: string;
    ordersFilled?: number;
  };
  assert(mainRunSummary.cycleId === MAIN_CYCLE_ID, "resultSummary içinde cycleId olmalı.");
  assert(mainRunSummary.ordersFilled === 4, "resultSummary istatistiği doğru olmalı.");
  check(
    "JobRun denetim kaydı yazılır (status + resultSummary)",
    true,
    `jobType=${mainJobRun.jobType}, status=${mainJobRun.status}, cycleId=${mainRunSummary.cycleId}`,
  );

  // --- Order.source ayrımı.
  const manualCount = await prisma.order.count({
    where: { stockId: { in: allTestStockIds }, source: "MANUAL" },
  });
  const autoCount = await prisma.order.count({
    where: { stockId: { in: allTestStockIds }, source: "AUTO_ENGINE" },
  });
  assert(manualCount === 3, "3 manuel emir MANUAL kaynaklı olmalı.");
  assert(autoCount === 4, "4 otomatik emir AUTO_ENGINE kaynaklı olmalı.");
  check(
    "Order.source ayrımı: MANUAL vs AUTO_ENGINE",
    true,
    `manuel=${manualCount}, otomatik=${autoCount}`,
  );

  // --- İzolasyon kanıtı: mevcut pozisyonlar değişmedi.
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
  assert(isolationOk, "Mevcut pozisyonlar otomatik döngüden etkilenmemeli.");
  check(
    "İzolasyon: mevcut pozisyonlar değişmedi",
    true,
    `${existingPositions.length} mevcut pozisyon sabit kaldı`,
  );

  // ============================================================
  // TEST 4 — Idempotency: aynı cycleId → yeni emir YOK (replay).
  // ============================================================
  // ATID pozisyonunu yeniden aç (doğrudan DB — placeOrder kullanmadan,
  // böylece yeni emir kaydı oluşmaz; replay testi saf kalır).
  await prisma.portfolio.update({
    where: { stockId: stockIdBySymbol["ATID"] },
    data: {
      quantity: 100,
      avgCost: new Prisma.Decimal(100),
      totalCost: new Prisma.Decimal(10_000),
    },
  });

  const balanceBeforeIdem = await prisma.account.findUnique({
    where: { id: account.id },
    select: { balance: true },
  });
  assert(balanceBeforeIdem !== null, "Test hesabı bulunamadı.");
  const autoOrdersBeforeIdem = await prisma.order.count({
    where: { stockId: { in: allTestStockIds }, source: "AUTO_ENGINE" },
  });

  // İkinci koşu AYNI cycleId ile: SL taraması ATID'yi tekrar görür ve
  // placeOrder'a aynı clientRequestId ("auto-{MAIN_CYCLE_ID}-ATID-SELL")
  // gider → idempotent replay: mevcut emir döner, yeni işlem YOK.
  const idemMock = new MockLlmProvider([
    '{"action":"BUY","confidence":0.9,"reasoning":"İkinci koşu — pozisyon limiti dolu, lot kalmadı."}',
    '{"action":"BUY","confidence":0.3,"reasoning":"İkinci koşu — eşik altı güven."}',
    '{"action":"HOLD","confidence":0.9,"reasoning":"İkinci koşu — beklemede."}',
  ]);
  const idemResult = await runAutoTradeCycle({
    cycleId: MAIN_CYCLE_ID,
    llmProvider: idemMock,
  });
  assert(!idemResult.summary.skipped, "İkinci koşu skipped olmamalı.");

  const atidAutoOrders = await prisma.order.count({
    where: { stockId: stockIdBySymbol["ATID"], source: "AUTO_ENGINE" },
  });
  assert(atidAutoOrders === 1, "ATID için otomatik emir 1'de kalmalı (replay).");
  const atidPosAfter = await prisma.portfolio.findUnique({
    where: { stockId: stockIdBySymbol["ATID"] },
  });
  assert(
    atidPosAfter !== null && atidPosAfter.quantity.equals(100),
    "ATID pozisyonu replay'de satılmamalı (100 lot kalmalı).",
  );

  const autoOrdersAfterIdem = await prisma.order.count({
    where: { stockId: { in: allTestStockIds }, source: "AUTO_ENGINE" },
  });
  assert(
    autoOrdersAfterIdem === autoOrdersBeforeIdem,
    "Aynı cycleId koşusu yeni otomatik emir üretmemeli.",
  );

  const balanceAfterIdem = await prisma.account.findUnique({
    where: { id: account.id },
    select: { balance: true },
  });
  assert(
    balanceAfterIdem !== null &&
      balanceAfterIdem.balance.equals(balanceBeforeIdem.balance),
    "Replay koşusu bakiyeyi değiştirmemeli.",
  );
  check(
    "Idempotency: aynı cycleId → yeni emir/pozisyon/bakiye değişimi yok",
    true,
    `otomatik emir=${autoOrdersAfterIdem} (sabit), ATID lot=100, bakiye sabit`,
  );

  // ============================================================
  // TEST 5 — listRecentAutoTradeRuns: son döngüler özetle listelenir.
  // ============================================================
  const recentRuns = await listRecentAutoTradeRuns(5);
  assert(recentRuns.length >= 4, "En az 4 test döngüsü listelenmeli.");
  // Not: idempotency koşusu da AYNI cycleId ile yeni JobRun açtığı için
  // arama jobRunId üzerinden yapılır (cycleId iki kayıtta da vardır).
  const mainRunInView = recentRuns.find((r) => r.id === mainResult.jobRunId);
  assert(mainRunInView !== undefined, "Ana döngü son kayıtlarda görünmeli.");
  assert(
    mainRunInView.summary !== null && mainRunInView.summary.cycleId === MAIN_CYCLE_ID,
    "Liste görünümü cycleId taşımalı.",
  );
  assert(
    mainRunInView.summary !== null && mainRunInView.summary.ordersFilled === 4,
    "Liste görünümü özet istatistikleri taşımalı.",
  );
  const idemRunInView = recentRuns.find((r) => r.id === idemResult.jobRunId);
  assert(
    idemRunInView !== undefined && idemRunInView.summary !== null &&
      idemRunInView.summary.ordersPlaced === 1,
    "İdempotency koşusu kaydı listede görünmeli (replay emri sayılır).",
  );
  check(
    "listRecentAutoTradeRuns: son döngüler özetle listelenir",
    true,
    `${recentRuns.length} kayıt; ana döngü ordersFilled=${mainRunInView?.summary?.ordersFilled ?? "?"}`,
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
