/**
 * Toplu satış (bulk sell) uçtan uca doğrulama scripti.
 *
 * Kullanım: npx tsx scripts/verify-bulk-sell.ts
 *
 * Servis katmanını (trading-service.bulkSell) doğrudan DB üzerinde çalıştırır
 * ve şu akışları kanıtlar:
 *  1. 3 pozisyon oluştur → toplu sat (2 tam + 1 kısmi) → sonuç özeti doğru
 *     (succeeded/failed/totalRealizedPnl), pozisyonlar doğru azalır.
 *  2. Hata izolasyonu: yetersiz lot içeren bulk → o öğe failed, diğerleri
 *     succeeded; başarılı öğe işlenmeye devam eder.
 *  3. Boş items → Zod bulkSellSchema reddi (API katmanı 422 döner).
 *  4. LIVE guard: liveModeConfirmedAt damgası yoksa bulk sat reddedilir
 *     (TradingError LIVE_MODE_NOT_CONFIRMED, HTTP 403); damga varken
 *     confirmLive=true olmadan da reddedilir (403).
 *  5. Idempotency: bulk öğeleri placeOrder üzerinden geçtiği için her öğeye
 *     benzersiz clientRequestId üretilir (orderId/clientRequestId unique).
 *
 * Not: Script kendi PAPER hesabını ve kendi sembollerini (TSTA/TSTB/TSTC)
 * oluşturur; mevcut verileri bozmaz. Sonunda oluşturduğu kayıtları temizler
 * ve AdminSettings.tradingMode + risk limitlerini orijinal değerlerine döndürür.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { bulkSell, TradingError } from "../src/server/services/trading-service";
import { getPortfolio } from "../src/server/services/portfolio-service";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

/** Koşul yanlışsa hata fırlatır — assertion signature ile tip daraltma sağlar. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** İzole test sembolleri — symbolSchema (3–6 BÜYÜK HARF) uyumlu. */
const TEST_SYMBOLS = ["TSTA", "TSTB", "TSTC"] as const;

async function cleanupTestSymbols(): Promise<void> {
  for (const symbol of TEST_SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol } });
    if (stock) {
      await prisma.order.deleteMany({ where: { stockId: stock.id } });
      await prisma.portfolio.deleteMany({ where: { stockId: stock.id } });
      await prisma.stock.delete({ where: { id: stock.id } });
    }
  }
}

async function main(): Promise<void> {
  console.log("=== TOPLU SATIŞ (BULK SELL) DOĞRULAMA ===\n");

  // --- AdminSettings orijinal değerlerini sakla (sonunda geri yüklenecek).
  const originalSettings = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
    select: {
      tradingMode: true,
      liveModeConfirmedAt: true,
      maxPositionValue: true,
      maxOpenPositions: true,
      dailyOrderBudget: true,
    },
  });
  assert(originalSettings !== null, "AdminSettings singleton kaydı bulunamadı.");

  // --- Test ortamı: izole semboller + izole PAPER hesabı.
  // Önceki (yarıda kalmış) koşuların artıklarını temizle.
  await cleanupTestSymbols();
  const staleAccounts = await prisma.account.findMany({
    where: { accountType: "PAPER", createdAt: { lt: new Date("2001-01-01T00:00:00.000Z") } },
    select: { id: true },
  });
  for (const stale of staleAccounts) {
    await prisma.accountTransaction.deleteMany({ where: { accountId: stale.id } });
    await prisma.account.delete({ where: { id: stale.id } });
  }

  // Test sembolleri: TSTA @10, TSTB @20, TSTC @5.
  const stocks = await Promise.all([
    prisma.stock.create({
      data: { symbol: "TSTA", name: "Test A", sector: "Test", lastPrice: 10, isActive: false },
    }),
    prisma.stock.create({
      data: { symbol: "TSTB", name: "Test B", sector: "Test", lastPrice: 20, isActive: false },
    }),
    prisma.stock.create({
      data: { symbol: "TSTC", name: "Test C", sector: "Test", lastPrice: 5, isActive: false },
    }),
  ]);

  // İzole PAPER hesabı — portfolio-service en eski PAPER hesabını seçtiği için
  // createdAt geriye çekilir (verify-trading.ts deseni).
  const account = await prisma.account.create({
    data: { accountType: "PAPER", currency: "TRY", balance: 50_000, totalBalance: 50_000 },
  });
  await prisma.account.update({
    where: { id: account.id },
    data: { createdAt: new Date("2000-01-01T00:00:00.000Z") },
  });

  // Risk limitlerini test için gevşet (3 yeni sembol + bütçe rahat açılsın).
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: {
      tradingMode: "PAPER",
      maxPositionValue: 1_000_000_000,
      dailyOrderBudget: 1_000_000_000,
      maxOpenPositions: 50,
    },
  });

  // --- 3 pozisyon oluştur: TSTA 100 lot, TSTB 50 lot, TSTC 30 lot.
  const buySpecs = [
    { symbol: "TSTA", quantity: 100 },
    { symbol: "TSTB", quantity: 50 },
    { symbol: "TSTC", quantity: 30 },
  ];
  for (const spec of buySpecs) {
    const buy = await import("../src/server/services/trading-service").then((m) =>
      m.placeOrder({
        side: "BUY",
        symbol: spec.symbol,
        quantity: spec.quantity,
        clientRequestId: crypto.randomUUID(),
      }),
    );
    assert(buy.order.status === "FILLED", `ALIM gerçekleşmeli: ${spec.symbol}`);
  }

  const portfolioBefore = await getPortfolio();
  assert(
    portfolioBefore.summary.accountId === account.id,
    "Test hesabı portfolio-service tarafından seçilmedi.",
  );
  // getPositions() hesap-agnostiktir (tüm PAPER pozisyonlarını listeler);
  // bu yüzden yalnızca izole test sembolleri sayılır — seed verisi karışmaz.
  const testSymbols = TEST_SYMBOLS as readonly string[];
  const testPositionsBefore = portfolioBefore.positions.filter((p) =>
    testSymbols.includes(p.symbol),
  );
  assert(
    testPositionsBefore.length === 3,
    `3 test pozisyonu oluşmalı, gelen: ${testPositionsBefore.length}`,
  );
  check(
    "3 pozisyon oluşturuldu",
    true,
    testPositionsBefore.map((p) => `${p.symbol}:${p.quantity}`).join(", "),
  );

  // ============================================================
  // 1) TOPLU SAT: TSTA 100 (tam) + TSTB 50 (tam) + TSTC 10 (kısmi).
  //    Beklenen: succeeded=3, failed=0; TSTA/TSTB pozisyonları kapanır,
  //    TSTC 20 lot kalır; totalRealizedPnl = Σ realizedPnl.
  // ============================================================
  const bulkResult = await bulkSell([
    { symbol: "TSTA", quantity: 100 },
    { symbol: "TSTB", quantity: 50 },
    { symbol: "TSTC", quantity: 10 },
  ]);

  assert(bulkResult.succeeded.length === 3, "3 öğe başarılı olmalı.");
  assert(bulkResult.failed.length === 0, "Başarısız öğe olmamalı.");
  check(
    "Toplu sat: 2 tam + 1 kısmi",
    true,
    `succeeded=${bulkResult.succeeded.length}, failed=${bulkResult.failed.length}`,
  );

  // K/Z tutarlılığı: totalRealizedPnl = succeeded öğelerinin toplamı.
  const sumOfParts = bulkResult.succeeded.reduce(
    (acc, s) => (s.realizedPnl !== null ? acc.add(new Prisma.Decimal(s.realizedPnl)) : acc),
    new Prisma.Decimal(0),
  );
  assert(
    new Prisma.Decimal(bulkResult.totalRealizedPnl).equals(sumOfParts),
    `totalRealizedPnl (${bulkResult.totalRealizedPnl}) = Σ realizedPnl (${sumOfParts.toString()}) olmalı.`,
  );
  check(
    "totalRealizedPnl tutarlı",
    true,
    `toplam=${bulkResult.totalRealizedPnl} TL (Σ=${sumOfParts.toString()})`,
  );

  // Pozisyon kontrolleri: TSTA/TSTB kapandı, TSTC 20 lot kaldı.
  const portfolioAfterBulk = await getPortfolio();
  const tsta = portfolioAfterBulk.positions.find((p) => p.symbol === "TSTA");
  const tstb = portfolioAfterBulk.positions.find((p) => p.symbol === "TSTB");
  const tstc = portfolioAfterBulk.positions.find((p) => p.symbol === "TSTC");
  assert(tsta === undefined, "TSTA pozisyonu tam satıldı, listede olmamalı.");
  assert(tstb === undefined, "TSTB pozisyonu tam satıldı, listede olmamalı.");
  assert(
    tstc !== undefined && Number(tstc.quantity) === 20,
    `TSTC 20 lot kalmalı, gelen: ${tstc?.quantity ?? "yok"}`,
  );
  check(
    "Pozisyon azaltma doğru",
    true,
    `TSTA kapandı, TSTB kapandı, TSTC kalan=${tstc?.quantity ?? "yok"}`,
  );

  // ============================================================
  // 2) HATA İZOLASYONU: TSTA (pozisyon yok → INSUFFICIENT_POSITION) +
  //    TSTC 20 (geçerli) → TSTA failed, TSTC succeeded.
  // ============================================================
  const isolated = await bulkSell([
    { symbol: "TSTA", quantity: 5 },
    { symbol: "TSTC", quantity: 20 },
  ]);
  assert(isolated.failed.length === 1, "1 öğe başarısız olmalı (TSTA).");
  assert(isolated.succeeded.length === 1, "1 öğe başarılı olmalı (TSTC).");
  assert(isolated.failed[0]?.symbol === "TSTA", "Başarısız öğe TSTA olmalı.");
  assert(isolated.succeeded[0]?.symbol === "TSTC", "Başarılı öğe TSTC olmalı.");
  check(
    "Hata izolasyonu",
    true,
    `failed=[${isolated.failed.map((f) => `${f.symbol}: ${f.error}`.slice(0, 60)).join("; ")}], succeeded=[${isolated.succeeded.map((s) => s.symbol).join(", ")}]`,
  );

  // TSTC tamamen kapandı mı?
  const portfolioAfterIsolated = await getPortfolio();
  const tstcAfter = portfolioAfterIsolated.positions.find((p) => p.symbol === "TSTC");
  assert(
    tstcAfter === undefined,
    "TSTC 20 lot satıldı, pozisyon kapanmalı.",
  );
  check("Kısmi→tam satış zinciri", true, "TSTC pozisyonu tamamen kapandı");

  // ============================================================
  // 3) BOŞ ITEMS → Zod reddi (API katmanı 422 döner).
  // ============================================================
  const { bulkSellSchema } = await import("../src/lib/validators/trading");
  const emptyParse = bulkSellSchema.safeParse({ items: [] });
  assert(!emptyParse.success, "Boş items Zod tarafından reddedilmeli.");
  check(
    "Boş items → 422 (Zod reddi)",
    true,
    emptyParse.success ? "şema geçti (HATA)" : "şema reddetti (doğru)",
  );

  // ============================================================
  // 4) LIVE GUARD: liveModeConfirmedAt yoksa bulk sat reddedilir (403).
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "LIVE", liveModeConfirmedAt: null },
  });
  let liveRejected = false;
  let liveMessage = "";
  try {
    await bulkSell([{ symbol: "TSTC", quantity: 1 }]);
  } catch (error: unknown) {
    if (error instanceof TradingError && error.code === "LIVE_MODE_NOT_CONFIRMED") {
      liveRejected = true;
      liveMessage = error.message;
    } else {
      throw error;
    }
  }
  assert(
    liveRejected,
    "liveModeConfirmedAt yokken bulk sat TradingError(LIVE_MODE_NOT_CONFIRMED) fırlatmalı.",
  );
  check("LIVE guard: damga yok → 403", true, liveMessage.slice(0, 90));

  // Damga var ama confirmLive=true yoksa da reddedilmeli (403).
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { liveModeConfirmedAt: new Date() },
  });
  let confirmRejected = false;
  let confirmMessage = "";
  try {
    await bulkSell([{ symbol: "TSTC", quantity: 1 }]);
  } catch (error: unknown) {
    if (error instanceof TradingError && error.code === "LIVE_MODE_NOT_CONFIRMED") {
      confirmRejected = true;
      confirmMessage = error.message;
    } else {
      throw error;
    }
  }
  assert(
    confirmRejected,
    "confirmLive=true olmadan LIVE modda bulk sat reddedilmeli.",
  );
  check("LIVE guard: confirmLive yok → 403", true, confirmMessage.slice(0, 90));

  // ============================================================
  // 5) IDEMPOTENCY: bulk öğeleri placeOrder üzerinden geçtiği için her
  //    öğeye benzersiz clientRequestId üretilir; emir kayıtları unique.
  // ============================================================
  // PAPER moduna dön ve 2 pozisyon daha aç, sonra toplu sat; emirlerin
  // clientRequestId'lerinin benzersizliğini DB üzerinden doğrula.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { tradingMode: "PAPER" },
  });
  for (const spec of [
    { symbol: "TSTA", quantity: 10 },
    { symbol: "TSTB", quantity: 10 },
  ]) {
    const buy = await import("../src/server/services/trading-service").then((m) =>
      m.placeOrder({
        side: "BUY",
        symbol: spec.symbol,
        quantity: spec.quantity,
        clientRequestId: crypto.randomUUID(),
      }),
    );
    assert(buy.order.status === "FILLED", `ALIM gerçekleşmeli: ${spec.symbol}`);
  }
  const idemResult = await bulkSell([
    { symbol: "TSTA", quantity: 10 },
    { symbol: "TSTB", quantity: 10 },
  ]);
  assert(idemResult.succeeded.length === 2, "2 öğe başarılı olmalı.");
  const orderIds = idemResult.succeeded.map((s) => s.orderId);
  assert(
    new Set(orderIds).size === orderIds.length,
    "orderId'ler benzersiz olmalı (idempotency).",
  );
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, clientRequestId: true },
  });
  const requestIds = orders.map((o) => o.clientRequestId);
  assert(
    new Set(requestIds).size === requestIds.length,
    "clientRequestId'ler benzersiz üretilmiş olmalı.",
  );
  check(
    "Idempotency: benzersiz clientRequestId'ler",
    true,
    `${orderIds.length} emir, ${new Set(requestIds).size} benzersiz clientRequestId`,
  );

  // ============================================================
  // Özet + temizlik.
  // ============================================================
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SONUÇ: ${passed} başarılı, ${failed} başarısız ===`);

  // Temizlik: test verilerini geri al + AdminSettings'i orijinal değerlere döndür.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: {
      tradingMode: originalSettings.tradingMode,
      liveModeConfirmedAt: originalSettings.liveModeConfirmedAt,
      maxPositionValue: originalSettings.maxPositionValue,
      maxOpenPositions: originalSettings.maxOpenPositions,
      dailyOrderBudget: originalSettings.dailyOrderBudget,
    },
  });
  await prisma.accountTransaction.deleteMany({ where: { accountId: account.id } });
  await prisma.account.delete({ where: { id: account.id } });
  await cleanupTestSymbols();
  console.log("✓ Test verileri temizlendi (hesap, emirler, pozisyonlar, semboller, ayarlar).");

  if (failed > 0) process.exit(1);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("\n✗ DOĞRULAMA HATASI:", error);
    // Hata durumunda da ayarları güvenli şekilde PAPER'a döndürmeyi dene.
    try {
      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { tradingMode: "PAPER" },
      });
    } catch {
      // Yoksay — ana hata zaten raporlandı.
    }
    await prisma.$disconnect();
    process.exit(1);
  });
