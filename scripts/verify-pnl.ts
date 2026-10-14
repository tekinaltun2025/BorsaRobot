// K/Z analitiği servisi doğrulama — izole test verisiyle.
// Test sonrası temizlik yapar; kullanıcının gerçek verilerine dokunmaz.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getPnlOverview,
  resetPnl,
  getPnlResetAt,
} from "@/server/services/pnl-service";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name} — ${detail}`);
  } else {
    failed += 1;
    console.error(`✗ ${name} — ${detail}`);
  }
}

async function main(): Promise<void> {
  console.log("=== K/Z ANALİTİĞİ DOĞRULAMA ===\n");

  // --- Kullanıcı verilerini koru: mevcut reset damgası + emir sayısı.
  const userResetAt = await getPnlResetAt();
  const userOrderCount = await prisma.order.count();

  // --- Baseline: test öncesi overview (kullanıcının gerçek emirleri dahil).
  // Kontroller delta mantığıyla çalışır — kullanıcı verisinden bağımsızdır.
  // Not: Dev server çalışırken scheduler yeni emir ekleyebilir; bu script
  // server kapalıyken çalıştırılmalıdır.
  const baseline = await getPnlOverview();

  // --- İzole test sembolleri.
  const TEST_SYMBOLS = ["PNLTST1", "PNLTST2"];
  const stocks = await Promise.all(
    TEST_SYMBOLS.map((symbol, i) =>
      prisma.stock.upsert({
        where: { symbol },
        update: {},
        create: {
          symbol,
          name: `K/Z Test Hisse ${i + 1}`,
          lastPrice: new Prisma.Decimal(100),
        },
      }),
    ),
  );
  const [stock1, stock2] = stocks;
  if (!stock1 || !stock2) throw new Error("Test hisseleri oluşturulamadı");

  // --- Test emirleri: 3 kârlı, 2 zararlı, 2 farklı gün.
  const day1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const day2 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const testOrders: { id: string }[] = [];

  async function createTestOrder(input: {
    symbol: string;
    stockId: string;
    pnl: string;
    at: Date;
  }): Promise<void> {
    const order = await prisma.order.create({
      data: {
        clientRequestId: `pnl-verify-${crypto.randomUUID()}`,
        side: "SELL",
        assetType: "STOCK",
        stockId: input.stockId,
        symbol: input.symbol,
        quantity: new Prisma.Decimal(10),
        currency: "TRY",
        filledPrice: new Prisma.Decimal(100),
        filledValue: new Prisma.Decimal(1000),
        commission: new Prisma.Decimal(1),
        status: "FILLED",
        realizedPnl: new Prisma.Decimal(input.pnl),
        createdAt: input.at,
        updatedAt: input.at,
      },
    });
    testOrders.push({ id: order.id });
  }

  // Gün 1: +500 (T1), -200 (T2), +300 (T1) → gün toplamı +600
  await createTestOrder({ symbol: "PNLTST1", stockId: stock1.id, pnl: "500", at: day1 });
  await createTestOrder({ symbol: "PNLTST2", stockId: stock2.id, pnl: "-200", at: day1 });
  await createTestOrder({ symbol: "PNLTST1", stockId: stock1.id, pnl: "300", at: day1 });
  // Gün 2: +150 (T2), -50 (T1) → gün toplamı +100
  await createTestOrder({ symbol: "PNLTST2", stockId: stock2.id, pnl: "150", at: day2 });
  await createTestOrder({ symbol: "PNLTST1", stockId: stock1.id, pnl: "-50", at: day2 });

  try {
    // 1) Sıfırlama yok → tüm test emirleri hesaba katılır.
    let overview = await getPnlOverview();
    const testEvents = overview.events.filter((e) =>
      e.symbol.startsWith("PNLTST"),
    );
    check(
      "Sıfırlama yok: tüm emirler hesaba katılır",
      testEvents.length === 5,
      `PNLTST olay sayısı=${testEvents.length} (beklenen 5)`,
    );

    // 2) Günlük bucket: gün1=baseline+600, gün2=baseline+100 (delta mantığı).
    const baseDay1 = baseline.daily.find((d) => d.date === utcDay(day1));
    const baseDay2 = baseline.daily.find((d) => d.date === utcDay(day2));
    const expectedDay1 = (baseDay1?.pnl ?? 0) + 600;
    const expectedDay2 = (baseDay2?.pnl ?? 0) + 100;
    const testDaily = overview.daily.filter(
      (d) => d.date === utcDay(day1) || d.date === utcDay(day2),
    );
    const day1Point = testDaily.find((d) => d.date === utcDay(day1));
    const day2Point = testDaily.find((d) => d.date === utcDay(day2));
    check(
      "Günlük bucket doğru",
      testDaily.length === 2 &&
        day1Point?.pnl === expectedDay1 &&
        day2Point?.pnl === expectedDay2,
      `gün1=${day1Point?.pnl} (beklenen ${expectedDay1}), gün2=${day2Point?.pnl} (beklenen ${expectedDay2})`,
    );

    // 3) Kümülatif: day1 = baseline(day1'e kadar) + 600; day2 = day1 + gün2 pnl
    // (day1 ve day2 ardışık UTC günleri — arada gün olamaz).
    const baseCumDay1 = cumulativeUpTo(baseline.daily, utcDay(day1));
    const expectedCumDay1 = baseCumDay1 + 600;
    const cumDay1 = day1Point?.cumulative ?? -1;
    const cumDay2 = day2Point?.cumulative ?? -2;
    check(
      "Kümülatif eğri doğru",
      cumDay1 === expectedCumDay1 &&
        cumDay2 === cumDay1 + (day2Point?.pnl ?? 0),
      `kümülatif gün1=${cumDay1} (beklenen ${expectedCumDay1}), gün2=${cumDay2}`,
    );

    // 4) Hisse kırılımı: T1=+750 (3 işlem), T2=-50 (2 işlem), azalan sıralı.
    const t1 = overview.bySymbol.find((s) => s.symbol === "PNLTST1");
    const t2 = overview.bySymbol.find((s) => s.symbol === "PNLTST2");
    check(
      "Hisse kırılımı doğru",
      t1?.realizedPnl === "750" &&
        t1?.tradeCount === 3 &&
        t2?.realizedPnl === "-50" &&
        t2?.tradeCount === 2,
      `T1=${t1?.realizedPnl} (${t1?.tradeCount} işlem), T2=${t2?.realizedPnl} (${t2?.tradeCount} işlem)`,
    );
    const t1Index = overview.bySymbol.findIndex((s) => s.symbol === "PNLTST1");
    const t2Index = overview.bySymbol.findIndex((s) => s.symbol === "PNLTST2");
    check(
      "Hisse kırılımı azalan sıralı",
      t1Index < t2Index,
      `T1 sıra=${t1Index}, T2 sıra=${t2Index}`,
    );

    // 5) Toplamlar: baseline + test katkısı (Decimal — tam hassasiyet).
    const expectedProfit = new Prisma.Decimal(baseline.totalProfit).plus(950);
    const expectedLoss = new Prisma.Decimal(baseline.totalLoss).plus(-250);
    check(
      "Kâr/zarar toplamları doğru",
      expectedProfit.equals(overview.totalProfit) &&
        expectedLoss.equals(overview.totalLoss),
      `kâr=${overview.totalProfit} (beklenen ${expectedProfit.toString()}), zarar=${overview.totalLoss} (beklenen ${expectedLoss.toString()})`,
    );

    // 6) Sıfırlama: damga ilerletilir, eski emirler düşer.
    const resetResult = await resetPnl();
    const newResetAt = await getPnlResetAt();
    check(
      "Sıfırlama damgası yazılır",
      newResetAt !== null && resetResult.resetAt === newResetAt.toISOString(),
      `resetAt=${resetResult.resetAt}`,
    );

    overview = await getPnlOverview();
    const testEventsAfter = overview.events.filter((e) =>
      e.symbol.startsWith("PNLTST"),
    );
    check(
      "Sıfırlama sonrası eski emirler düşer",
      testEventsAfter.length === 0,
      `PNLTST olay sayısı=${testEventsAfter.length} (beklenen 0)`,
    );

    // 7) Sıfırlama sonrası yeni emir hesaba katılır.
    await createTestOrder({
      symbol: "PNLTST1",
      stockId: stock1.id,
      pnl: "77.5",
      at: new Date(),
    });
    overview = await getPnlOverview();
    const afterResetEvents = overview.events.filter((e) =>
      e.symbol.startsWith("PNLTST"),
    );
    check(
      "Sıfırlama sonrası yeni emir hesaba katılır",
      afterResetEvents.length === 1 &&
        afterResetEvents[0]?.realizedPnl === "77.5",
      `olay=${afterResetEvents.length}, K/Z=${afterResetEvents[0]?.realizedPnl}`,
    );

    // 8) resetAt görünümü dolu.
    check(
      "resetAt görünümde mevcut",
      overview.resetAt !== null,
      `resetAt=${overview.resetAt}`,
    );
  } finally {
    // --- Temizlik: test emirleri + hisseler; kullanıcı reset damgası geri.
    await prisma.order.deleteMany({
      where: { symbol: { in: TEST_SYMBOLS } },
    });
    await prisma.stock.deleteMany({
      where: { symbol: { in: TEST_SYMBOLS } },
    });
    if (userResetAt) {
      await prisma.pnlReset.upsert({
        where: { id: "singleton" },
        update: { resetAt: userResetAt },
        create: { id: "singleton", resetAt: userResetAt },
      });
    } else {
      await prisma.pnlReset.deleteMany({});
    }
    const finalOrderCount = await prisma.order.count();
    check(
      "Temizlik: kullanıcı verileri korundu",
      finalOrderCount === userOrderCount,
      `emir sayısı=${finalOrderCount} (beklenen ${userOrderCount})`,
    );
  }

  console.log(`\n--- ÖZET ---`);
  console.log(`${passed}/${passed + failed} doğrulama başarılı.`);
  if (failed > 0) process.exitCode = 1;
}

/** Date → UTC gün anahtarı (YYYY-MM-DD). */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Günlük listede verilen güne kadarki (dahil) son kümülatif değeri. */
function cumulativeUpTo(
  daily: { date: string; cumulative: number }[],
  dayKey: string,
): number {
  let value = 0;
  for (const point of daily) {
    if (point.date > dayKey) break;
    value = point.cumulative;
  }
  return value;
}

void main().catch((error) => {
  console.error("Beklenmeyen hata:", error);
  process.exitCode = 1;
});
